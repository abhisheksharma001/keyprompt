import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { demoRequest, laterForRun, parseArgs, setReport } from '../src/cli.mjs'
import { EXIT } from '../src/errors.mjs'
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
  for (const word of ['set', 'run', 'has', 'list', 'delete', 'demo', 'install-skill', 'no command that prints a secret']) {
    assert.ok(r.stdout.includes(word), word)
  }
})

test('help shows the FIELD grammar and every exit code', () => {
  const r = cli(['--help'])
  assert.equal(r.status, 0)
  for (const word of ['FIELD', ':visible', ':multiline', ':optional', 'Later']) {
    assert.ok(r.stdout.includes(word), word)
  }
  const codes = r.stdout.split('Exit codes:')[1].split('Options:')[0]
  for (const code of Object.values(EXIT)) {
    assert.match(codes, new RegExp(`(^|\\s)${code} [a-z]`), `exit code ${code}`)
  }
})

test('the README lists every exit code, and the skill explains Later (exit 6)', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const skill = readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8')
  for (const code of Object.values(EXIT)) {
    assert.match(readme, new RegExp(`^\\| \`${code}\` \\|`, 'm'), `README exit code ${code}`)
  }
  assert.match(skill, /exit 6/)
  assert.match(skill, /Later/)
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
  assert.equal(cli(['demo', 'NAME']).status, 2) // demo takes no arguments
  assert.equal(cli(['demo', '--', 'echo']).status, 2)
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

test('the demo card has three sample boxes, says it saves nothing, and its submit touches nothing', async () => {
  const request = demoRequest()
  assert.deepEqual(
    request.fields.map((f) => [f.name, f.visible, f.multiline, f.optional]),
    [
      ['DEMO_API_KEY', false, false, false],
      ['DEMO_ACCOUNT_ID', true, false, false],
      ['DEMO_PRIVATE_KEY', false, true, true],
    ],
  )
  assert.equal(request.reason, 'A demo of the keyprompt card. Nothing you type here is saved.')
  assert.equal(request.requester, 'keyprompt demo')
  assert.equal(request.storeLabel, 'nowhere (demo)')
  assert.equal(request.demo, true)
  assert.equal(request.allowSessionOnly, false)
  // Anything onSubmit did with what it was given would throw.
  const poisoned = new Proxy({}, { get: () => { throw new Error('onSubmit touched the values') }, has: () => { throw new Error('touched') } })
  assert.equal(await request.onSubmit(poisoned, true), undefined)
})

// Touches no store, so it needs no opt-in. The fake browser is a script run by
// its #! line, which Windows cannot do.
test('demo: submit, Later and Cancel all end with exit 0, and no store or catalog is used', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-demo-'))
  // The CLI under test thinks it runs on a system with no password store, so
  // any call to getStore() would fail it.
  const preload = join(dir, 'no-store.mjs')
  writeFileSync(preload, "Object.defineProperty(process, 'platform', { value: 'freebsd' })\n")
  const browser = join(dir, 'click.mjs')
  writeFileSync(
    browser,
    `#!${process.execPath}
import { writeFileSync } from 'node:fs'
import { request } from 'node:http'
const url = new URL(process.argv[2])
const action = process.env.KP_DEMO_ACTION
const body = action === 'submit' ? { values: { DEMO_API_KEY: 'sk-demo', DEMO_ACCOUNT_ID: 'acct' }, remember: true } : {}
const headers = { Origin: url.origin, 'Content-Type': 'application/json' }
request({ hostname: url.hostname, port: url.port, path: url.pathname + '/' + action, method: 'POST', headers }, (res) => {
  writeFileSync(process.env.KP_DEMO_ANSWER, String(res.statusCode))
  res.resume()
}).end(JSON.stringify(body))
`,
  )
  chmodSync(browser, 0o755)
  const keyprompt = (args, extra = {}) =>
    spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: browser, ...extra },
      timeout: 15000,
    })

  // The pretend system works: asking its store for anything fails.
  const control = keyprompt(['has', 'DEMO_API_KEY'])
  assert.equal(control.status, 1)
  assert.match(control.stderr, /does not support freebsd/)

  for (const action of ['submit', 'later', 'cancel']) {
    const answer = join(dir, `answer-${action}`)
    const r = keyprompt(['demo'], { KP_DEMO_ACTION: action, KP_DEMO_ANSWER: answer })
    assert.equal(r.status, 0, `${action}: ${r.stderr}`)
    assert.equal(r.stdout, 'Demo finished. Nothing was saved.\n', action)
    assert.ok(r.stderr.includes('opened the demo card'), r.stderr)
    assert.equal(readFileSync(answer, 'utf8'), '200', action)
  }
  assert.equal(existsSync(join(dir, 'catalog.json')), false)
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

test('the masking sentence is on the card for run, and not for run --no-redact or set', { skip: !realCard }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-mask-'))
  const browser = join(dir, 'look.mjs')
  // Reads the card page, records whether it holds the masking sentence, then cancels.
  writeFileSync(
    browser,
    `#!${process.execPath}
import { writeFileSync } from 'node:fs'
import { request } from 'node:http'
const url = new URL(process.argv[2])
const get = request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { Host: url.host } }, (res) => {
  const chunks = []
  res.on('data', (c) => chunks.push(c))
  res.on('end', () => {
    writeFileSync(process.env.KP_PAGE_SAYS, String(Buffer.concat(chunks).toString('utf8').includes('id="masking"')))
    const headers = { Origin: url.origin, 'Content-Type': 'application/json' }
    request({ hostname: url.hostname, port: url.port, path: url.pathname + '/cancel', method: 'POST', headers }).end('{}')
  })
})
get.end()
`,
  )
  chmodSync(browser, 0o755)
  const name = `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`
  const says = (args) => {
    const file = join(dir, `says-${randomBytes(3).toString('hex')}`)
    const r = spawnSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: browser, KP_PAGE_SAYS: file },
      timeout: 15000,
    })
    assert.equal(r.status, 4, r.stderr)
    return readFileSync(file, 'utf8')
  }
  try {
    assert.equal(says(['run', name, '--', process.execPath, '-e', '0']), 'true')
    assert.equal(says(['run', name, '--no-redact', '--', process.execPath, '-e', '0']), 'false')
    assert.equal(says(['set', name]), 'false')
  } finally {
    await getStore().remove(name).catch(() => {})
  }
})

test('list on a fresh machine says nothing is saved', () => {
  const r = cli(['list'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /No secrets saved/)
})
