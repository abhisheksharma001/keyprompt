import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parseArgs } from '../src/cli.mjs'

const BIN = fileURLToPath(new URL('../bin/keyprompt.mjs', import.meta.url))

function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, KEYPROMPT_HOME: mkdtempSync(join(tmpdir(), 'keyprompt-test-')) },
  })
}

test('splits keyprompt options from the command after --', () => {
  const parsed = parseArgs(['run', 'A,B', '--reason', 'why', '--', 'npm', 'test', '--reason', 'x'])
  assert.deepEqual(parsed.positionals, ['run', 'A,B'])
  assert.equal(parsed.reason, 'why')
  assert.deepEqual(parsed.command, ['npm', 'test', '--reason', 'x'])
})

test('help lists the commands and says there is no getter', () => {
  const r = cli(['--help'])
  assert.equal(r.status, 0)
  for (const word of ['set', 'run', 'has', 'list', 'delete', 'install-skill', 'no command that prints a secret']) {
    assert.ok(r.stdout.includes(word), word)
  }
})

test('there is no get command', () => {
  const r = cli(['get', 'OPENAI_API_KEY'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Unknown command "get"/)
})

test('bad names and bad usage are usage errors (exit 2)', () => {
  assert.equal(cli(['set', 'lowercase']).status, 2)
  assert.equal(cli(['run', 'OK_NAME']).status, 2) // no command
  assert.equal(cli(['run', '--', 'echo']).status, 2) // no name
  assert.equal(cli(['set', 'A', '--bogus']).status, 2)
})

test('list on a fresh machine says nothing is saved', () => {
  const r = cli(['list'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /No secrets saved/)
})
