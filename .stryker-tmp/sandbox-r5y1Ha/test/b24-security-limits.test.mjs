// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { LOCK_WAIT_MS, STALE_LOCK_MS } from '../src/activity.mjs'

const read = (/** @type {string} */ path) => readFileSync(new URL(path, import.meta.url), 'utf8')
/** Text with its line breaks folded, so a rewrap does not break a check. */
const flat = (/** @type {string} */ text) => text.replace(/\s+/g, ' ')

// B-24: limits belong in SECURITY.md (invariant 9), so each limit of the activity log and of keyprompt mcp is stated there.
test('B-24: SECURITY.md states the limits of the activity log and of keyprompt mcp, with the numbers the code uses', () => {
  const security = flat(read('../SECURITY.md'))
  assert.match(security, /activity log is a record, not proof/i)
  assert.match(security, /anything running as you can edit or delete it/)
  assert.match(security, /folder paths? [^.]*can name a client/)
  assert.match(security, /written when the command ends/)
  assert.match(security, /"who is asking" is the MCP client's own name/)
  assert.match(security, /keyprompt mcp` only asks for keys and checks them/)
  // The two time limits are the code's own, so changing one without the docs fails here.
  assert.ok(security.includes(`about ${LOCK_WAIT_MS / 1000} seconds`), `SECURITY.md names the ${LOCK_WAIT_MS / 1000}-second wait`)
  assert.ok(security.includes(`over ${STALE_LOCK_MS / 1000} seconds`), `SECURITY.md names the ${STALE_LOCK_MS / 1000}-second stale limit`)
})

test('B-24: the README lists every activity log event the code knows, and says what a cancelled MCP request does', () => {
  const readme = flat(read('../README.md'))
  // The events come from src/activity.mjs itself, so a new event without docs fails here.
  const source = read('../src/activity.mjs')
  const events = [...source.match(/const EVENTS = new Set\(\[([^\]]+)\]\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(events.length >= 7, events.join(','))
  const listed = readme.match(/`event` is ([^.]+)\./)[1]
  for (const event of events) assert.ok(listed.includes(`\`${event}\``), `the README lists ${event}`)
  assert.match(readme, /cancels the call or its connection closes, the card closes/)
})
