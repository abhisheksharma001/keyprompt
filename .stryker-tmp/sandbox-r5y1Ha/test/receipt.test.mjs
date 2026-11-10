// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MASKING_NOTE, RECEIPT_WORDS, receiptFor } from '../src/receipt.mjs'

test('the receipt says what the PRD says, word for word', () => {
  // Windows checks the file out with CRLF line endings.
  const prd = readFileSync(new URL('../docs/prd/card-v2.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  // The paragraph under "### The receipt" quotes the five lines and the masking sentence, in that order.
  const paragraph = prd.slice(prd.indexOf('### The receipt')).split('\n\n')[1]
  const quoted = [...paragraph.matchAll(/"([^"]+)"/g)].map((m) => m[1])
  assert.equal(quoted.length, 6, paragraph)
  assert.deepEqual(
    quoted.slice(0, 5),
    Object.values(RECEIPT_WORDS).map((words) => words.split('{store}').join('macOS Keychain')),
  )
  assert.equal(quoted[5], MASKING_NOTE)
})

test('receiptFor tells saved, handed over, kept and empty apart, and carries no value', () => {
  const fields = [{ name: 'A' }, { name: 'B', optional: true }, { name: 'C', saved: true }]
  const values = new Map([['A', 'sk-secret-value']])
  assert.deepEqual(receiptFor(fields, values, true), [
    { name: 'A', outcome: 'saved' },
    { name: 'B', outcome: 'empty' },
    { name: 'C', outcome: 'kept' },
  ])
  assert.deepEqual(
    receiptFor(fields, values, false).map((r) => r.outcome),
    ['handed', 'empty', 'kept'],
  )
  assert.ok(!JSON.stringify(receiptFor(fields, values, true)).includes('sk-secret-value'))
})

test('every outcome the server can send has words, and the words have no spare outcome', () => {
  const fields = [{ name: 'A' }, { name: 'B', optional: true }, { name: 'C', saved: true }]
  const sent = new Set([...receiptFor(fields, new Map([['A', 'x']]), true), ...receiptFor(fields, new Map([['A', 'x']]), false)].map((r) => r.outcome))
  // "later" is never sent: the page knows a Later keeps nothing.
  assert.deepEqual([...sent].sort(), Object.keys(RECEIPT_WORDS).filter((k) => k !== 'later').sort())
})
