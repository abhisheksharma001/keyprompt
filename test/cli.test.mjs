import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { laterForRun, parseArgs, setReport } from '../src/cli.mjs'
import { getStore } from '../src/store/index.mjs'

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
  assert.equal(cli(['set']).status, 2) // no name
  assert.equal(cli(['set', 'A:bogus']).status, 2) // unknown hint
  assert.equal(cli(['run', 'A:bogus', '--', 'echo']).status, 2) // unknown hint on run
  assert.equal(cli(['run', 'A:optional']).status, 2) // hints are fine, the command is missing
})

test('set reports saved, replaced and empty names, never values', () => {
  const label = 'macOS Keychain'
  assert.equal(
    setReport([{ name: 'A' }], new Map([['A', 'sk-1']]), label),
    'Saved A in the macOS Keychain. The value was not shown here.\nUse it with: keyprompt run A -- <command>\n',
  )
  assert.equal(
    setReport([{ name: 'A', saved: true }], new Map([['A', 'sk-1']]), label),
    'Replaced A in the macOS Keychain. The value was not shown here.\nUse it with: keyprompt run A -- <command>\n',
  )
  const fields = [{ name: 'A' }, { name: 'B', saved: true }, { name: 'C', saved: true }, { name: 'D', optional: true }]
  const report = setReport(
    fields,
    new Map([
      ['A', 'sk-1'],
      ['B', 'sk-2'],
    ]),
    label,
  )
  assert.equal(
    report,
    'Saved A and B in the macOS Keychain (replaced B). The values were not shown here.\n' +
      'Left empty: C and D. Nothing was changed for them.\n' +
      'Use them with: keyprompt run A,B -- <command>\n',
  )
  assert.ok(!report.includes('sk-'))
})

test('Later on run: exit 6, names the boxes and the command, never its arguments', () => {
  const one = laterForRun([{ name: 'A' }], 'npm')
  assert.equal(one.exitCode, 6)
  assert.equal(
    one.message,
    'The person chose Later for A. Nothing was saved and npm did not run. Carry on with work that does not need it; ask again only when you are about to use it.',
  )
  assert.equal(
    laterForRun([{ name: 'A' }, { name: 'B' }], 'npm').message,
    'The person chose Later for A and B. Nothing was saved and npm did not run. Carry on with work that does not need these; ask again only when you are about to use them.',
  )
})

// Reads the real OS password store, so it is opt-in like the store tests. The
// fake browser is a script run by its #! line, which Windows cannot do.
const realCard = process.env.KEYPROMPT_STORE_TEST === '1' && process.platform !== 'win32'

test('clicking Later: set and run exit 6, nothing is saved, and run does not start the command', { skip: !realCard }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-later-'))
  const browser = join(dir, 'later.mjs')
  writeFileSync(
    browser,
    `#!${process.execPath}
import { request } from 'node:http'
const url = new URL(process.argv[2])
const headers = { Origin: url.origin, 'Content-Type': 'application/json' }
request({ hostname: url.hostname, port: url.port, path: url.pathname + '/later', method: 'POST', headers }).end('{}')
`,
  )
  chmodSync(browser, 0o755)
  const name = `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`
  const marker = join(dir, 'ran')
  const env = { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: browser }
  const keyprompt = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, timeout: 15000 })
  try {
    const run = keyprompt(['run', name, '--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`])
    assert.equal(run.status, 6, run.stderr)
    assert.ok(run.stderr.includes(`keyprompt: The person chose Later for ${name}. Nothing was saved and ${process.execPath} did not run.`), run.stderr)
    assert.equal(existsSync(marker), false)

    const set = keyprompt(['set', name])
    assert.equal(set.status, 6, set.stderr)
    assert.ok(set.stderr.includes(`keyprompt: The person chose Later for ${name}. Nothing was saved.\n`), set.stderr)
    assert.equal(set.stdout, '')

    assert.equal(keyprompt(['has', name]).status, 3)
    assert.equal(existsSync(join(dir, 'catalog.json')), false)
  } finally {
    await getStore().remove(name).catch(() => {})
  }
})

test('list on a fresh machine says nothing is saved', () => {
  const r = cli(['list'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /No secrets saved/)
})
