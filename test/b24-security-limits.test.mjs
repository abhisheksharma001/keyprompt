import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (/** @type {string} */ path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// B-24: limits belong in SECURITY.md (invariant 9), so each limit of the activity log and of keyprompt mcp is stated there.
test('B-24: SECURITY.md states the limits of the activity log and of keyprompt mcp', () => {
  const security = read('../SECURITY.md')
  assert.match(security, /activity log is a record, not proof/i)
  assert.match(security, /anything running as you can edit or delete it/)
  assert.match(security, /folder paths? .*can name a client/)
  assert.match(security, /written when the command ends/)
  assert.match(security, /stopped for over 10 seconds/)
  assert.match(security, /"who is asking" is the MCP client's own name/)
  assert.match(security, /keyprompt mcp` only asks for keys and checks them/)
})

test('B-24: the README lists every activity log event, and says what a cancelled MCP request does', () => {
  const readme = read('../README.md')
  assert.match(readme, /`event` is `saved`, `run`, `deleted`, `deferred`, `cancelled`, `timed_out` or `withdrawn`/)
  assert.match(readme, /cancels the call or its connection closes, the card closes/)
})
