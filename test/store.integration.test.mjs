import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { getStore } from '../src/store/index.mjs'

// Writes to the real OS password store. Opt-in: KEYPROMPT_STORE_TEST=1.
const enabled = process.env.KEYPROMPT_STORE_TEST === '1'

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

test('round-trips values through the OS password store byte for byte', { skip: !enabled }, async () => {
  const store = getStore()
  const name = `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`
  try {
    assert.equal(await store.read(name), null)
    for (const value of VALUES) {
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

test('the macOS backend refuses a value with a line break instead of running it', { skip: !enabled || process.platform !== 'darwin' }, async () => {
  const store = getStore()
  const name = `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`
  await assert.rejects(store.write(name, 'first\ndelete-generic-password -s keyprompt'), /line break/)
  assert.equal(await store.read(name), null)
})
