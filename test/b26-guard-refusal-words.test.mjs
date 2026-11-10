import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { checkCommand, preToolUse } from '../src/guard.mjs'

// B-26 (docs/bugs.md), step S-65, decision D-24: when the guard refuses a command that only
// quotes a read as text (a commit message, a pull request body), its reason says what to do.
// Every command below is only ever passed to checkCommand / preToolUse as a string; none is run.

const SAVED = ['OPENAI_API_KEY']
const SKILL = readFileSync(fileURLToPath(new URL('../skill/SKILL.md', import.meta.url)), 'utf8')

const READ = 'security find-generic-password -s keyprompt -w'

/** Commands the guard refuses today. The set must stay exactly this. */
const REFUSED = {
  'a direct read': READ,
  'a commit message that quotes a read': `git commit -m "$(cat <<'EOF'\nfix: ${READ}\nEOF\n)"`,
  'a pull request body that quotes a read': `gh pr create --title t --body "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  'a read of every secret (macOS)': 'security dump-keychain -d',
}

/** Commands the guard lets through today. The set must stay exactly this. */
const ALLOWED = [
  'echo hello',
  'git commit -F msg.txt',
  'gh pr create --title t --body-file body.txt',
  'keyprompt run OPENAI_API_KEY -- sh -c \'curl -sS -H "Authorization: Bearer $OPENAI_API_KEY" https://api.example.com/me\'',
]

test('every refusal still names `keyprompt run NAME -- COMMAND` (B-26)', () => {
  for (const [what, command] of Object.entries(REFUSED)) {
    const found = checkCommand(command, SAVED)
    assert.ok(found, `should refuse ${what}`)
    assert.match(found.reason, /`keyprompt run NAME -- COMMAND`/, what)
  }
})

test('every refusal says what to do when the text only quotes a read (B-26, D-24)', () => {
  for (const [what, command] of Object.entries(REFUSED)) {
    const found = checkCommand(command, SAVED)
    assert.ok(found, `should refuse ${what}`)
    assert.match(found.reason, /only quotes such a read as text/, what)
    assert.match(found.reason, /`git commit -F FILE`/, what)
    assert.match(found.reason, /`gh pr create --body-file FILE`/, what)
  }
})

test('the hook output carries the same words (B-26)', () => {
  const command = REFUSED['a commit message that quotes a read']
  const out = preToolUse({ tool_name: 'Bash', tool_input: { command } }, SAVED)
  assert.equal(out?.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /`git commit -F FILE`/)
})

test('the skill’s guard section gives the same advice (B-26)', () => {
  const start = SKILL.indexOf('## If keyprompt\'s guard refuses a command')
  assert.ok(start >= 0, 'the guard section should exist')
  const section = SKILL.slice(start).split(/\n## /)[0]
  assert.match(section, /keyprompt run NAME -- COMMAND/)
  assert.match(section, /git commit -F FILE/)
  assert.match(section, /gh pr create --body-file FILE/)
})

test('the set of refused commands does not change (B-26)', () => {
  for (const [what, command] of Object.entries(REFUSED)) {
    assert.ok(checkCommand(command, SAVED), `should still refuse ${what}`)
  }
  for (const command of ALLOWED) {
    assert.equal(checkCommand(command, SAVED), null, `should still allow: ${command}`)
  }
})
