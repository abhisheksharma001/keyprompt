import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { getStore } from '../src/store/index.mjs'
import { addCommand } from '../src/store/macos.mjs'

// Writes to the real OS password store. Opt-in: KEYPROMPT_STORE_TEST=1.
const enabled = process.env.KEYPROMPT_STORE_TEST === '1'
const onMac = enabled && process.platform === 'darwin'

const VALUES = [
  'sk-proj-abc123XYZ',
  'deadbeefdeadbeef',
  'with space and $HOME and ;|&',
  'quote"inside',
  "single'quote",
  'back\\slash',
  'unicodé ключ 🙂',
  'x'.repeat(1000),
]

const FAKE_PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAZmFrZSBrZXkgZm9yIGEg',
  'dGVzdCBvbmx5LCBub3QgYSByZWFsIGtleQ==',
  '-----END PRIVATE KEY-----',
  '',
].join('\n')

// Line breaks work on macOS since S-7. S-8 runs them on every OS.
const MULTILINE = ['line1\nline2', FAKE_PEM, 'a\r\nb']

const testName = () => `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`

test('round-trips values through the OS password store byte for byte', { skip: !enabled }, async () => {
  const store = getStore()
  const name = testName()
  const values = process.platform === 'darwin' ? [...VALUES, ...MULTILINE] : VALUES
  try {
    assert.equal(await store.read(name), null)
    for (const value of values) {
      await store.write(name, value)
      assert.equal(await store.read(name), value, `round trip of ${JSON.stringify(value.slice(0, 20))}`)
    }
    assert.equal(await store.remove(name), true)
    assert.equal(await store.read(name), null)
    assert.equal(await store.remove(name), false)
  } finally {
    await store.remove(name).catch(() => {})
  }
})

/** The most bytes the macOS backend says it takes for this name and kind of value. */
function room(name, value) {
  try {
    addCommand(name, value)
  } catch (error) {
    return Number(/at most (\d+)/.exec(String(error))?.[1])
  }
  throw new Error('expected the value to be too long')
}

test('on macOS the second line of a value is stored as data, never run', { skip: !onMac }, async () => {
  const store = getStore()
  const name = testName()
  const other = testName()
  const value = `first\nadd-generic-password -s keyprompt -a ${other} -w x`
  try {
    await store.write(name, value)
    assert.equal(await store.read(name), value)
    assert.equal(await store.read(other), null)
  } finally {
    await store.remove(name).catch(() => {})
    await store.remove(other).catch(() => {})
  }
})

test('on macOS the longest value that fits is saved, and one byte more is refused before anything runs', { skip: !onMac }, async () => {
  const store = getStore()
  const name = testName()
  const other = testName()
  try {
    const oneLine = room(name, 'x'.repeat(5000))
    const withBreaks = room(name, 'x\n'.repeat(3000))
    const longest = `\n${'x'.repeat(withBreaks - 1)}`
    for (const value of ['x'.repeat(oneLine), longest]) {
      await store.write(name, value)
      assert.equal(await store.read(name), value, `round trip of ${Buffer.byteLength(value)} bytes`)
    }
    // B-5: `security -i` cuts a line after 4,095 bytes and runs the rest as a
    // command of its own. This tail starts exactly at the cut, so it would add
    // the item `other` if the length check were missing.
    const tail = ` add-generic-password -s keyprompt -a ${other} -w x`
    await assert.rejects(store.write(name, `${'x'.repeat(oneLine + 2)}${tail}`), /takes at most/)
    await assert.rejects(store.write(name, `${longest}x`), /takes at most \d+ for a value with line breaks/)
    assert.equal(await store.read(name), longest)
    assert.equal(await store.read(other), null)
  } finally {
    await store.remove(name).catch(() => {})
    await store.remove(other).catch(() => {})
  }
})
