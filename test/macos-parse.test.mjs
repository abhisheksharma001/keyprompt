import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePasswordLine } from '../src/store/macos.mjs'

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

test('fails loudly on an unexpected format instead of guessing', () => {
  assert.throws(() => parsePasswordLine('nothing useful\n'), /unexpected format/)
})
