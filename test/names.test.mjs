import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertName, parseNames } from '../src/names.mjs'

test('accepts environment-variable style names', () => {
  for (const name of ['OPENAI_API_KEY', 'A', '_X', 'K2', 'STRIPE_SECRET_KEY_LIVE']) {
    assert.equal(assertName(name), name)
  }
})

test('rejects anything that is not an env-var name, with a usage error', () => {
  for (const name of ['openai_api_key', '1KEY', 'MY-KEY', 'A B', '', 'KEY;rm', 'X'.repeat(129), undefined]) {
    assert.throws(() => assertName(name), (error) => error.exitCode === 2)
  }
})

test('parses comma lists and separate arguments, deduplicated in order', () => {
  assert.deepEqual(parseNames(['A,B', 'C', 'A', ' D ,']), ['A', 'B', 'C', 'D'])
})
