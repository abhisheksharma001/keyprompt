// @ts-nocheck
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertName, parseFields, parseNames } from '../src/names.mjs'

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

test('parseFields reads hints and combines a repeated name', () => {
  assert.deepEqual(parseFields(['A:visible,B:multiline:optional', 'A']), [
    { name: 'A', visible: true, multiline: false, optional: false },
    { name: 'B', visible: false, multiline: true, optional: true },
  ])
})

test('parseFields: a bare name has no hints, each hint sets only its own flag', () => {
  assert.deepEqual(parseFields(['A']), [{ name: 'A', visible: false, multiline: false, optional: false }])
  assert.deepEqual(parseFields(['A:visible']), [{ name: 'A', visible: true, multiline: false, optional: false }])
  assert.deepEqual(parseFields(['A:multiline']), [{ name: 'A', visible: false, multiline: true, optional: false }])
  assert.deepEqual(parseFields(['A:optional']), [{ name: 'A', visible: false, multiline: false, optional: true }])
})

test('parseFields combines hints given on separate mentions, in any order', () => {
  assert.deepEqual(parseFields(['A:visible', 'A:optional,A:visible']), [
    { name: 'A', visible: true, multiline: false, optional: true },
  ])
})

test('parseFields rejects an unknown hint with a usage error that names it', () => {
  assert.throws(
    () => parseFields(['A:secret']),
    (error) =>
      error.exitCode === 2 && error.message === 'Unknown hint "secret" on A. Use visible, multiline or optional.',
  )
  // A hint is exact: wrong case and an empty hint are unknown too.
  for (const bad of ['A:Visible', 'A:', 'A::visible']) {
    assert.throws(() => parseFields([bad]), (error) => error.exitCode === 2 && /^Unknown hint/.test(error.message))
  }
})

test('parseFields: a bad name is still a usage error, with or without a hint', () => {
  for (const bad of ['a:visible', 'a', '1KEY:optional', 'MY-KEY:visible', ':visible']) {
    assert.throws(() => parseFields([bad]), (error) => error.exitCode === 2 && /not a valid secret name/.test(error.message))
  }
})

test('parseFields allows 12 distinct names and refuses a 13th', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `K${i + 1}`)
  assert.equal(parseFields([twelve.join(',')]).length, 12)
  // A repeated name is not a new value: 13 mentions of 12 names are fine.
  assert.equal(parseFields([twelve.join(','), 'K1']).length, 12)
  assert.throws(
    () => parseFields([[...twelve, 'K13'].join(',')]),
    (error) => error.exitCode === 2 && error.message === 'A card can ask for at most 12 values at once.',
  )
  // The limit counts names across separate arguments too.
  assert.throws(() => parseFields([...twelve, 'K13']), (error) => error.exitCode === 2)
})

test('parseNames keeps returning plain names, so hints do not change its result', () => {
  assert.deepEqual(parseNames(['A:visible,B:multiline', 'A']), ['A', 'B'])
})
