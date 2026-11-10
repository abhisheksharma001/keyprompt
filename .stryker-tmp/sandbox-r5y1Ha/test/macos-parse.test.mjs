// @ts-nocheck
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addCommand, macosStore, parsePasswordLine } from '../src/store/macos.mjs'

// Formats captured from `security find-generic-password -g` on macOS.
test('reads the plain quoted form, including a hex-looking value and an inner quote', () => {
  assert.equal(parsePasswordLine('keychain: "x"\npassword: "deadbeef"\n'), 'deadbeef')
  assert.equal(parsePasswordLine('password: "quote"inside"\n'), 'quote"inside')
})

test('decodes the 0x form exactly (backslash, tab, non-ASCII)', () => {
  assert.equal(parsePasswordLine('password: 0x6261636B5C736C617368  "back\\134slash"\n'), 'back\\slash')
  assert.equal(parsePasswordLine('password: 0x7461620968657265  "tab\\011here"\n'), 'tab\there')
  assert.equal(parsePasswordLine('password: 0x756E69636F64C3A9  "unicod\\303\\251"\n'), 'unicodé')
})

test('decodes line breaks from the 0x form (macOS 27.0 prints them as \\012 and \\015)', () => {
  assert.equal(parsePasswordLine('password: 0x6C696E65310A6C696E6532  "line1\\012line2"\n'), 'line1\nline2')
  assert.equal(parsePasswordLine('password: 0x610D0A62  "a\\015\\012b"\n'), 'a\r\nb')
})

test('fails loudly on an unexpected format instead of guessing', () => {
  assert.throws(() => parsePasswordLine('nothing useful\n'), /unexpected format/)
})

test('a value with a line break is sent as hex, so the command stays one line', () => {
  assert.equal(addCommand('A', 'l1\nl2'), 'add-generic-password -U -s keyprompt -a A -l "keyprompt: A" -X 6c310a6c32\n')
  const values = ['a\nb', 'a\r\nb', 'a\rb', '-----BEGIN KEY-----\nabc\n-----END KEY-----\n', 'x\nadd-generic-password -s keyprompt -a B -w x']
  for (const value of values) {
    const command = addCommand('A', value)
    assert.equal(command.indexOf('\n'), command.length - 1, JSON.stringify(value))
    assert.equal(command.indexOf('\r'), -1, JSON.stringify(value))
  }
})

test('a one-line value keeps the quoted form', () => {
  assert.equal(addCommand('A', 'sk-1'), 'add-generic-password -U -s keyprompt -a A -l "keyprompt: A" -w "sk-1"\n')
  assert.equal(addCommand('A', 'q"x\\y'), 'add-generic-password -U -s keyprompt -a A -l "keyprompt: A" -w "q\\"x\\\\y"\n')
})

test('a NUL is refused: an environment variable cannot hold one', () => {
  assert.throws(() => addCommand('A', 'a\0b'), /A contains a NUL character/)
})

test('a command longer than one security line is refused, so no tail of a value can run as a command', () => {
  // 4,094 bytes is the longest line `security -i` reads whole.
  const longest = addCommand('A', 'x'.repeat(macosStore.maxValueLength))
  assert.equal(Buffer.byteLength(longest), 4094 + 1)
  assert.throws(() => addCommand('A', 'x'.repeat(macosStore.maxValueLength + 1)), /^KeypromptError: A needs 4030 bytes; the macOS Keychain backend takes at most 4029\.$/)
  // Quotes and backslashes are escaped, so they count twice.
  assert.throws(() => addCommand('A', `"${'x'.repeat(4028)}`), /A needs 4030 bytes; the macOS Keychain backend takes at most 4029\./)
  // The shape B-5 was proved with: a tail that spells a command of its own.
  assert.throws(() => addCommand('KEY', `${'x'.repeat(4000)} add-generic-password -s keyprompt -a OTHER -w x`), /takes at most/)
})

test('a value with line breaks takes twice the room, and the message gives the real numbers', () => {
  const fits = `a\n${'x'.repeat(2011)}` // 2,013 bytes, the most for the name PEM
  assert.equal(Buffer.byteLength(addCommand('PEM', fits)), 4093 + 1)
  assert.throws(
    () => addCommand('PEM', `${fits}x`),
    /^KeypromptError: PEM needs 2014 bytes; the macOS Keychain backend takes at most 2013 for a value with line breaks\.$/,
  )
})
