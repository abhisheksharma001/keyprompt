import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { renderCard } from '../src/card-page.mjs'
import { readCatalog, recordSavedMany } from '../src/catalog.mjs'
import {
  catalogNotUpdated,
  catalogNotUpdatedAfterDelete,
  demoRequest,
  laterForRun,
  outputIsTerminal,
  parseArgs,
  removeAndRecord,
  runCardLine,
  saveAndRecord,
  secretsInCommand,
  setReport,
  UNEXPECTED_JSON_MESSAGE,
  valueInCommandError,
} from '../src/cli.mjs'
import { EXIT, KeypromptError } from '../src/errors.mjs'
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

test('the headline claims nothing the code does not do (B-1, B-2)', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  // A command the agent writes can print a transformed copy, so no text may say the agent never sees a key.
  for (const path of ['../README.md', '../package.json']) {
    assert.doesNotMatch(read(path), /without (ever )?seeing|not see them|never sees?\b/i, path)
  }
  // SECURITY.md says what the OS store and masking do not stop.
  const security = read('../SECURITY.md')
  assert.match(security, /read a saved key straight from the OS store/)
  assert.match(security, /find-generic-password/)
  assert.match(security, /--no-redact/)
  // The protections table says "keyprompt command", not "command": a command the agent writes can print the key.
  assert.match(security, /no keyprompt command that outputs a saved value/)
})

test('the README shows pictures that exist and documents demo, and the CHANGELOG has the package version (S-16, S-17)', () => {
  const root = new URL('../', import.meta.url)
  const readme = readFileSync(new URL('README.md', root), 'utf8')
  const pictures = [...readme.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1])
  assert.ok(pictures.length >= 2)
  // The npm page does not reliably resolve paths inside the repo, so each picture is a full link pinned to a commit (S-17).
  const pinned = /^https:\/\/raw\.githubusercontent\.com\/abhisheksharma001\/keyprompt\/[0-9a-f]{40}\/(docs\/[\w.-]+)$/
  for (const src of pictures) {
    const m = pinned.exec(src)
    assert.ok(m, `README picture is not a pinned full link: ${src}`)
    assert.ok(existsSync(new URL(m[1], root)), `README picture ${m[1]}`)
  }
  // Links inside the repo break on the npm page the same way.
  assert.doesNotMatch(readme, /\]\((?!https?:|#)[^)]+\)/, 'README has a link to a path inside the repo')
  // Install from npm, not from GitHub (S-17).
  for (const text of [readme, readFileSync(new URL('skill/SKILL.md', root), 'utf8')]) {
    assert.doesNotMatch(text, /github:abhisheksharma001/)
  }
  // B-10: the old screenshot's alt text said it, and the card no longer does.
  assert.doesNotMatch(readme, /never shown to your agent/)
  assert.match(readme, /^\| `keyprompt demo` \|/m)
  const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8')
  assert.match(changelog, new RegExp(`^## ${version.replaceAll('.', '\\.')} `, 'm'), `CHANGELOG has no section for ${version}`)
})

// B-15: after S-30 the demo card's button said "Save" while the README's descriptions still said "Save all 3".
// A test cannot see a picture, but it can hold its description to the buttons the demo card really renders.
test("the README's picture descriptions name the buttons the demo card really has (B-15, S-32)", () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const alts = [...readme.matchAll(/<img [^>]*alt="([^"]+)"/g)].map((m) => m[1])
  assert.equal(alts.length, 2)
  const page = renderCard({ ...demoRequest(), expiresAt: Date.now() + 60_000, nonce: 'n' })
  const label = (id) => page.match(new RegExp(`id="${id}"[^>]*>([^<]+)<`))[1]
  const [later, cancel, save] = [label('later'), label('cancel'), label('save')]
  assert.ok(alts[0].includes(`the buttons ${later}, ${cancel} and ${save}.`), alts[0])
  assert.ok(alts[1].includes(`after pressing ${save}:`), alts[1])
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

test('--no-redact needs a terminal: from a pipe, run exits 2 before reading a key, opening a card or starting the command (B-11)', () => {
  assert.equal(outputIsTerminal({ isTTY: true }, { isTTY: true }), true)
  assert.equal(outputIsTerminal({ isTTY: true }, {}), false)
  assert.equal(outputIsTerminal({}, { isTTY: true }), false)
  assert.equal(outputIsTerminal({}, {}), false)

  // spawnSync pipes stdout and stderr, as an agent's shell tool does. The browser does not
  // exist, so if the check let this through, no real browser would open and run would end with another exit code.
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-noredact-'))
  const marker = join(dir, 'ran')
  const r = spawnSync(
    process.execPath,
    [BIN, 'run', 'KEYPROMPT_NO_REDACT_TEST', '--no-redact', '--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
    { encoding: 'utf8', env: { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: join(dir, 'no-such-browser') }, timeout: 15000 },
  )
  assert.equal(r.status, 2, r.stderr)
  assert.equal(
    r.stderr,
    "keyprompt: --no-redact works only when keyprompt's output goes straight to a terminal, and here it does not. Run the command again without --no-redact; masking stays on.\n",
  )
  assert.equal(r.stdout, '')
  assert.equal(existsSync(marker), false)
})

test('a value spelled out in the command is found, in any word, once it is 8 or more characters (S-19)', () => {
  const secrets = new Map([
    ['TOKEN', 'sk-live-0123456789'],
    ['OTHER', 'zzz-another-value'],
  ])
  assert.deepEqual(secretsInCommand(secrets, ['echo', 'sk-live-0123456789']), ['TOKEN'])
  // Inside a longer word, as a header or a URL would hold it.
  assert.deepEqual(secretsInCommand(secrets, ['curl', '-H', 'Authorization: Bearer sk-live-0123456789']), ['TOKEN'])
  assert.deepEqual(secretsInCommand(secrets, ['curl', 'https://x.test/?k=zzz-another-value&a=1']), ['OTHER'])
  // The program itself is a word too.
  assert.deepEqual(secretsInCommand(secrets, ['sk-live-0123456789']), ['TOKEN'])
  // Names come back in the order `run` was given them, each once.
  assert.deepEqual(secretsInCommand(secrets, ['echo', 'zzz-another-value', 'sk-live-0123456789', 'sk-live-0123456789']), ['TOKEN', 'OTHER'])
  // A different value, or only part of one, is not a copy.
  assert.deepEqual(secretsInCommand(secrets, ['echo', 'sk-live-012345678', '$TOKEN', 'TOKEN']), [])
  assert.deepEqual(secretsInCommand(secrets, []), [])
  assert.deepEqual(secretsInCommand(new Map(), ['echo', 'anything']), [])

  // Eight characters count, seven do not; characters, not bytes or UTF-16 units.
  assert.deepEqual(secretsInCommand(new Map([['K', 'abcdefgh']]), ['echo', 'abcdefgh']), ['K'])
  assert.deepEqual(secretsInCommand(new Map([['K', 'abcdefg']]), ['echo', 'abcdefg']), [])
  assert.deepEqual(secretsInCommand(new Map([['K', 'abcdef🙂']]), ['echo', 'abcdef🙂']), []) // 7 characters, 4-byte emoji
  assert.deepEqual(secretsInCommand(new Map([['K', 'пароль12']]), ['echo', 'пароль12']), ['K']) // 8 characters, 14 bytes
  // A line break inside a value (a PEM key) is part of the value.
  const pem = '-----BEGIN KEY-----\nabc\n-----END KEY-----'
  assert.deepEqual(secretsInCommand(new Map([['PEM', pem]]), ['echo', pem]), ['PEM'])
})

test('the refusal names the boxes and never the value, with exit 2 (S-19)', () => {
  const one = valueInCommandError(['TOKEN'])
  assert.equal(one.exitCode, 2)
  assert.equal(
    one.message,
    'The value of TOKEN appears in the command itself, so keyprompt did not start it. Leave it out: the command gets it in its environment as $TOKEN (see keyprompt --help).',
  )
  const two = valueInCommandError(['A', 'B'])
  assert.equal(two.exitCode, 2)
  assert.equal(
    two.message,
    'The values of A and B appear in the command itself, so keyprompt did not start it. Leave them out: the command gets each one in its environment under its own name (see keyprompt --help).',
  )
})

// Writes a random value to the real OS store, so it is opt-in like the store tests.
test('run exits 2 without starting the command when a saved value is in it, and says nothing of the value (S-19)', { skip: process.env.KEYPROMPT_STORE_TEST !== '1' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-pasted-'))
  const name = `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`
  const value = randomBytes(12).toString('hex')
  const marker = join(dir, 'ran')
  const write = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`
  const keyprompt = (...command) =>
    spawnSync(process.execPath, [BIN, 'run', name, '--', process.execPath, '-e', write, ...command], {
      encoding: 'utf8',
      env: { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: join(dir, 'no-such-browser') },
      timeout: 15000,
    })
  const store = getStore()
  await store.write(name, value)
  try {
    const refused = keyprompt(`token=${value}`)
    assert.equal(refused.status, 2, refused.stderr)
    assert.equal(refused.stderr, `keyprompt: ${valueInCommandError([name]).message}\n`)
    assert.equal(refused.stdout, '')
    assert.ok(!refused.stdout.includes(value) && !refused.stderr.includes(value))
    assert.equal(existsSync(marker), false, 'the command must not start')

    // The same run without the value in it starts normally, so the refusal above is the check and nothing else.
    const allowed = keyprompt('token=$NOT_THE_VALUE')
    assert.equal(allowed.status, 0, allowed.stderr)
    assert.equal(readFileSync(marker, 'utf8'), 'ran')
  } finally {
    await store.remove(name).catch(() => {})
  }
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

/** A store that keeps values in a Map. `failWrite` makes every write throw, `failRemove` every remove. */
function mapStore({ failWrite = false, failRemove = false } = {}) {
  const items = new Map()
  return {
    items,
    id: 'fake',
    label: 'test store',
    maxValueLength: 100,
    async read(name) {
      return items.has(name) ? items.get(name) : null
    },
    async write(name, value) {
      if (failWrite) throw new KeypromptError(`Could not save ${name} to the test store.`)
      items.set(name, value)
    },
    async remove(name) {
      if (failRemove) throw new KeypromptError(`Could not delete ${name} from the test store.`)
      return items.delete(name)
    },
  }
}

/** Runs `body` with KEYPROMPT_HOME set to `home`, then puts the old value back. */
async function withHome(home, body) {
  const before = process.env.KEYPROMPT_HOME
  process.env.KEYPROMPT_HOME = home
  try {
    return await body()
  } finally {
    if (before === undefined) delete process.env.KEYPROMPT_HOME
    else process.env.KEYPROMPT_HOME = before
  }
}

test('a list of names that cannot be updated does not fail a save that worked, and the agent is told (B-3, S-26)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b3-'))
  // A file where the folder should be: the catalog can be neither read nor written.
  const notAFolder = join(dir, 'not-a-folder')
  writeFileSync(notAFolder, 'x')
  const store = mapStore()
  const values = new Map([
    ['A', 'sk-aaaaaaaa'],
    ['B', 'sk-bbbbbbbb'],
  ])
  const note = await withHome(notAFolder, () => saveAndRecord(store, values, 'send a test SMS'))
  assert.deepEqual([...store.items], [...values], 'every value is saved')
  assert.match(
    note,
    /^keyprompt: Saved A and B in the test store, but could not update the list of names \([A-Z]+\), so "keyprompt list" may not show them\. The save itself worked\. The list is /,
  )
  assert.ok(note.endsWith(`${join(notAFolder, 'catalog.json')}.\n`), note)
  assert.ok(!note.includes('sk-'), 'no value in the line')
})

test('a catalog.json that is not JSON is the same case, and is left as it was (B-3, S-26)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b3-'))
  writeFileSync(join(dir, 'catalog.json'), '{not json')
  const store = mapStore()
  const note = await withHome(dir, () => saveAndRecord(store, new Map([['A', 'sk-aaaaaaaa']]), undefined))
  assert.deepEqual([...store.items], [['A', 'sk-aaaaaaaa']])
  // A parse error has no code, so the line has none.
  assert.equal(
    note,
    `keyprompt: Saved A in the test store, but could not update the list of names, so "keyprompt list" may not show it. The save itself worked. The list is ${join(dir, 'catalog.json')}.\n`,
  )
  assert.equal(readFileSync(join(dir, 'catalog.json'), 'utf8'), '{not json')
})

test('when the list is fine a save says nothing extra; when the store fails the save still fails and the list is not touched (S-26)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b3-'))
  await withHome(dir, async () => {
    assert.equal(await saveAndRecord(mapStore(), new Map([['A', 'sk-aaaaaaaa']]), 'send a test SMS'), undefined)
    assert.equal((await readCatalog()).A.reason, 'send a test SMS')
  })
  const other = mkdtempSync(join(tmpdir(), 'keyprompt-b3-'))
  await withHome(other, async () => {
    await assert.rejects(saveAndRecord(mapStore({ failWrite: true }), new Map([['A', 'sk-aaaaaaaa']]), undefined), (error) => {
      assert.ok(error instanceof KeypromptError)
      assert.match(error.message, /Nothing was changed\.$/)
      return true
    })
    assert.equal(existsSync(join(other, 'catalog.json')), false)
  })
})

test('the line repeats an error code only when it is a plain one, never an error text (S-26)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-b3-'))
  const line = (error, names = ['A']) => withHome(home, () => catalogNotUpdated(names, 'test store', error))
  const withCode = (code) => Object.assign(new Error('the text of the error'), { code })
  const where = join(home, 'catalog.json')
  assert.ok((await line(withCode('ENOSPC'))).includes('update the list of names (ENOSPC), so'))
  for (const odd of [withCode('no space left sk-12345678'), withCode(28), withCode(undefined), new Error('x'), 'a string', null]) {
    const text = await line(odd)
    assert.equal(
      text,
      `keyprompt: Saved A in the test store, but could not update the list of names, so "keyprompt list" may not show it. The save itself worked. The list is ${where}.\n`,
    )
  }
  assert.ok(!(await line(withCode('ENOSPC'))).includes('the text of the error'))
})

test('a list of names that cannot be read does not fail a delete that worked, and the agent is told (B-13, S-27)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b13-'))
  // A folder where catalog.json should be: reading it fails (EISDIR) on every OS.
  mkdirSync(join(dir, 'catalog.json'))
  const store = mapStore()
  store.items.set('A', 'sk-aaaaaaaa')
  store.items.set('B', 'sk-bbbbbbbb')
  const result = await withHome(dir, () => removeAndRecord(store, 'A'))
  assert.equal(result.removed, true)
  assert.deepEqual([...store.items], [['B', 'sk-bbbbbbbb']], 'the value is gone, the other one is not touched')
  assert.match(result.note, /^keyprompt: Could not update the list of names \([A-Z]+\), so "keyprompt list" may still show A\. The list is /)
  assert.ok(result.note.endsWith(`${join(dir, 'catalog.json')}.\n`), result.note)
  assert.ok(!result.note.includes('sk-'), 'no value in the line')
  assert.equal(statSync(join(dir, 'catalog.json')).isDirectory(), true, 'left as it was')
})

test('a catalog.json that is not JSON is the same case, also for a name that was never saved, and is left as it was (B-13, S-27)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b13-'))
  writeFileSync(join(dir, 'catalog.json'), '{not json')
  const store = mapStore()
  store.items.set('A', 'sk-aaaaaaaa')
  const never = await withHome(dir, () => removeAndRecord(store, 'GONE'))
  assert.equal(never.removed, false)
  assert.deepEqual([...store.items], [['A', 'sk-aaaaaaaa']])
  // A parse error has no code, so the line has none. It says nothing about the value.
  assert.equal(
    never.note,
    `keyprompt: Could not update the list of names, so "keyprompt list" may still show GONE. The list is ${join(dir, 'catalog.json')}.\n`,
  )
  const saved = await withHome(dir, () => removeAndRecord(store, 'A'))
  assert.equal(saved.removed, true)
  assert.equal(store.items.size, 0)
  assert.equal(saved.note, never.note.replace('GONE', 'A'))
  assert.equal(readFileSync(join(dir, 'catalog.json'), 'utf8'), '{not json')
})

test('when the list is fine a delete says nothing extra and takes the name off it; when the store fails the delete still fails and the list is not touched (S-27)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b13-'))
  await withHome(dir, async () => {
    await recordSavedMany(['A', 'B'], { store: 'fake' })
    const store = mapStore()
    store.items.set('A', 'sk-aaaaaaaa')
    assert.deepEqual(await removeAndRecord(store, 'A'), { removed: true, note: undefined })
    assert.deepEqual(Object.keys(await readCatalog()), ['B'])
    assert.deepEqual(await removeAndRecord(store, 'A'), { removed: false, note: undefined })

    await assert.rejects(removeAndRecord(mapStore({ failRemove: true }), 'B'), (error) => {
      assert.ok(error instanceof KeypromptError)
      assert.equal(error.message, 'Could not delete B from the test store.')
      return true
    })
    assert.deepEqual(Object.keys(await readCatalog()), ['B'], 'B is still on the list: the store did not say it is gone')
  })
})

test('the delete line repeats an error code only when it is a plain one, never an error text (S-27)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-b13-'))
  const line = (error) => withHome(home, () => catalogNotUpdatedAfterDelete('A', error))
  const withCode = (code) => Object.assign(new Error('the text of the error'), { code })
  const where = join(home, 'catalog.json')
  assert.ok((await line(withCode('ENOSPC'))).includes('update the list of names (ENOSPC), so'))
  for (const odd of [withCode('no space left sk-12345678'), withCode(28), withCode(undefined), new Error('x'), 'a string', null]) {
    assert.equal(await line(odd), `keyprompt: Could not update the list of names, so "keyprompt list" may still show A. The list is ${where}.\n`)
  }
  assert.ok(!(await line(withCode('ENOSPC'))).includes('the text of the error'))
})

test('what run tells the agent about its card: names only, and when every box was left empty, that the command gets no value for them (B-4, S-28)', () => {
  const fields = [{ name: 'A', optional: true }, { name: 'B', optional: true }]
  const lines = [
    [fields, { remembered: false, values: new Map() }, 'keyprompt: A and B were left empty on the card, so keyprompt gives the command no value for them.\n'],
    [[fields[0]], { remembered: false, values: new Map() }, 'keyprompt: A was left empty on the card, so keyprompt gives the command no value for it.\n'],
    [fields, { remembered: true, values: new Map([['B', 'secret-b']]) }, 'keyprompt: B saved in the macOS Keychain.\n'],
    [fields, { remembered: false, values: new Map([['A', 'secret-a'], ['B', 'secret-b']]) }, 'keyprompt: A and B received for this run only.\n'],
  ]
  for (const [asked, answer, line] of lines) assert.equal(runCardLine(asked, answer, 'macOS Keychain'), line)
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

test('set with a list of names that cannot be updated: the card says Saved, set exits 0 and tells the agent, and the value is saved (B-3, S-26)', { skip: !realCard }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b3-'))
  const name = `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`
  const value = `dummy-${randomBytes(8).toString('hex')}`
  const answer = join(dir, 'answer')
  const browser = join(dir, 'save.mjs')
  // Presses Save, records the status the card answered, and cancels if it was not a 200 (a person would give up).
  writeFileSync(
    browser,
    `#!${process.execPath}
import { writeFileSync } from 'node:fs'
import { request } from 'node:http'
const url = new URL(process.argv[2])
const headers = { Origin: url.origin, 'Content-Type': 'application/json' }
const post = (action, body, done) =>
  request({ hostname: url.hostname, port: url.port, path: url.pathname + '/' + action, method: 'POST', headers }, (res) => {
    res.resume()
    res.on('end', () => done(res.statusCode))
  }).end(JSON.stringify(body))
post('submit', { values: { ${name}: ${JSON.stringify(value)} }, remember: true }, (status) => {
  writeFileSync(${JSON.stringify(answer)}, String(status))
  if (status !== 200) post('cancel', {}, () => {})
})
`,
  )
  chmodSync(browser, 0o755)
  // A file where the folder should be, and a catalog.json that is not JSON.
  const notAFolder = join(dir, 'not-a-folder')
  writeFileSync(notAFolder, 'x')
  const corrupt = join(dir, 'corrupt')
  mkdirSync(corrupt)
  writeFileSync(join(corrupt, 'catalog.json'), '{not json')
  try {
    for (const home of [notAFolder, corrupt]) {
      const env = { ...process.env, KEYPROMPT_HOME: home, KEYPROMPT_BROWSER: browser }
      const keyprompt = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, timeout: 15000 })
      const set = keyprompt(['set', name])
      assert.equal(set.status, 0, set.stderr)
      assert.equal(readFileSync(answer, 'utf8'), '200', 'the card answered Saved')
      assert.equal(set.stdout, setReport([{ name }], new Map([[name, value]]), getStore().label))
      assert.ok(set.stderr.includes(`keyprompt: Saved ${name} in the ${getStore().label}, but could not update the list of names`), set.stderr)
      assert.ok(set.stderr.includes(`The list is ${join(home, 'catalog.json')}.\n`), set.stderr)
      assert.ok(!set.stdout.includes(value) && !set.stderr.includes(value), 'no value is printed')
      assert.equal(keyprompt(['has', name]).status, 0, 'the value is saved')
      await getStore().remove(name)
    }
  } finally {
    await getStore().remove(name).catch(() => {})
  }
})

// Writes a random value to the real OS store, so it is opt-in like the store tests. No card is involved.
test('delete with a list of names that cannot be read: the value is deleted, the exit code is the usual one, and stderr says the list was not updated (B-13, S-27)', { skip: process.env.KEYPROMPT_STORE_TEST !== '1' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-b13-'))
  mkdirSync(join(home, 'catalog.json'))
  const name = `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`
  const value = randomBytes(12).toString('hex')
  const env = { ...process.env, KEYPROMPT_HOME: home }
  const keyprompt = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, timeout: 15000 })
  const store = getStore()
  const note = new RegExp(`^keyprompt: Could not update the list of names \\([A-Z]+\\), so "keyprompt list" may still show ${name}\\. The list is .+catalog\\.json\\.\\n$`)
  await store.write(name, value)
  try {
    assert.equal(keyprompt(['has', name]).status, 0, 'saved before')
    const deleted = keyprompt(['delete', name])
    assert.equal(deleted.status, 0, deleted.stderr)
    assert.equal(deleted.stdout, `Deleted ${name} from the ${store.label}.\n`)
    assert.match(deleted.stderr, note)
    assert.ok(!deleted.stdout.includes(value) && !deleted.stderr.includes(value), 'no value is printed')
    assert.equal(keyprompt(['has', name]).status, 3, 'the value is gone')

    const again = keyprompt(['delete', name])
    assert.equal(again.status, 3, again.stderr)
    assert.equal(again.stdout, `${name} was not saved.\n`)
    assert.match(again.stderr, note)
  } finally {
    await store.remove(name).catch(() => {})
  }
})

test('run with every missing name optional: Save with every box empty starts the command without them, saves nothing and tells the agent; set still refuses (B-4, S-28)', { skip: !realCard }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b4-'))
  const answer = join(dir, 'answer')
  const browser = join(dir, 'empty.mjs')
  // Presses Save with the values in KP_VALUES, records the status the card answered, and cancels if it was not a 200.
  writeFileSync(
    browser,
    `#!${process.execPath}
import { writeFileSync } from 'node:fs'
import { request } from 'node:http'
const url = new URL(process.argv[2])
const headers = { Origin: url.origin, 'Content-Type': 'application/json' }
const post = (action, body, done) =>
  request({ hostname: url.hostname, port: url.port, path: url.pathname + '/' + action, method: 'POST', headers }, (res) => {
    res.resume()
    res.on('end', () => done(res.statusCode))
  }).end(JSON.stringify(body))
post('submit', { values: JSON.parse(process.env.KP_VALUES), remember: true }, (status) => {
  writeFileSync(${JSON.stringify(answer)}, String(status))
  if (status !== 200) post('cancel', {}, () => {})
})
`,
  )
  chmodSync(browser, 0o755)
  const [a, b] = [0, 1].map(() => `KEYPROMPT_TEST_${randomBytes(4).toString('hex').toUpperCase()}`)
  const marker = join(dir, 'env')
  const keyprompt = (args, values) =>
    spawnSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: browser, KP_VALUES: JSON.stringify(values) },
      timeout: 15000,
    })
  try {
    const seen = `require('fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify([${JSON.stringify(a)} in process.env, ${JSON.stringify(b)} in process.env]))`
    const run = keyprompt(['run', `${a}:optional,${b}:optional:multiline`, '--', process.execPath, '-e', seen], { [a]: '', [b]: ' \n ' })
    assert.equal(readFileSync(answer, 'utf8'), '200', 'the card took the empty Save')
    assert.equal(run.status, 0, run.stderr)
    assert.equal(readFileSync(marker, 'utf8'), '[false,false]', 'the command ran without either name')
    assert.ok(run.stderr.includes(`keyprompt: ${a} and ${b} were left empty on the card, so keyprompt gives the command no value for them.\n`), run.stderr)
    assert.equal(keyprompt(['has', a], {}).status, 3)
    assert.equal(keyprompt(['has', b], {}).status, 3)
    assert.equal(existsSync(join(dir, 'catalog.json')), false, 'nothing went on the list of names')

    const set = keyprompt(['set', `${a}:optional`], { [a]: '' })
    assert.equal(readFileSync(answer, 'utf8'), '400', 'set still needs one value')
    assert.equal(set.status, 4, set.stderr)
  } finally {
    await getStore().remove(a).catch(() => {})
    await getStore().remove(b).catch(() => {})
  }
})

// From a pipe, run --no-redact stops before any card opens (S-24), so it is not tried here;
// test/card-server.test.mjs covers a card whose output is not masked.
test('the masking sentence is on the card for run, and not for set', { skip: !realCard }, async () => {
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

// Test-only preload replaces the store in the subprocess. Production has no
// fake-store switch; no real credential is read or written by these tests.
function jsonCliFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-json-'))
  const preload = join(dir, 'store.mjs')
  const storeUrl = new URL('../src/store/index.mjs', import.meta.url).href
  const errorsUrl = new URL('../src/errors.mjs', import.meta.url).href
  writeFileSync(preload, `
import { getStore } from ${JSON.stringify(storeUrl)}
import { KeypromptError, helperError } from ${JSON.stringify(errorsUrl)}
const store = getStore()
const values = new Map(Object.entries(JSON.parse(process.env.KP_JSON_VALUES || '{}')))
store.read = async (name) => {
  if (process.env.KP_JSON_ERROR) {
    const code = Number(process.env.KP_JSON_CODE || 1)
    // Like the Linux and Windows stores: keyprompt's sentence, then the helper's first line (B-19).
    if (code === 1) throw helperError('Could not read ' + name + ' from the test store', process.env.KP_JSON_ERROR)
    throw new KeypromptError(process.env.KP_JSON_ERROR, { exitCode: code })
  }
  return values.get(name) ?? null
}
store.write = async (name, value) => { values.set(name, value) }
store.remove = async (name) => {
  if (process.env.KP_JSON_ERROR) throw new Error(process.env.KP_JSON_ERROR)
  return values.delete(name)
}
`)
  return {
    dir,
    run(args, extra = {}, cwd = undefined) {
      return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, BIN, ...args], {
        encoding: 'utf8', timeout: 15000, cwd,
        env: { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: join(dir, 'no-browser'), ...extra },
      })
    },
  }
}

function jsonAnswer(result, exitCode) {
  assert.equal(result.status, exitCode, result.stderr)
  assert.equal(result.stdout.trim().split('\n').length, 1, result.stdout)
  const answer = JSON.parse(result.stdout)
  assert.equal(answer.exitCode, exitCode)
  return answer
}

test('JSON has, list and delete report names and real outcomes, never store values or catalog metadata (S-41)', () => {
  const f = jsonCliFixture()
  const value = 'dummy-sensitive-value-41'
  const env = { KP_JSON_VALUES: JSON.stringify({ TOKEN: value }) }
  assert.deepEqual(jsonAnswer(f.run(['has', 'TOKEN', '--json'], env), 0), {
    command: 'has', status: 'saved', names: ['TOKEN'], exitCode: 0,
  })
  assert.deepEqual(jsonAnswer(f.run(['--json', 'has', 'ABSENT']), 3), {
    command: 'has', status: 'missing', names: ['ABSENT'], exitCode: 3,
  })
  assert.deepEqual(jsonAnswer(f.run(['list', '--json']), 0).names, [])
  writeFileSync(join(f.dir, 'catalog.json'), JSON.stringify({
    Z: { reason: value, updatedAt: value, store: value, value },
    A: { reason: value, updatedAt: value, store: value },
  }))
  assert.deepEqual(jsonAnswer(f.run(['list', '--json']), 0), {
    command: 'list', status: 'listed', names: ['A', 'Z'], exitCode: 0,
  })
  assert.deepEqual(jsonAnswer(f.run(['delete', 'TOKEN', '--json'], env), 0), {
    command: 'delete', status: 'deleted', names: ['TOKEN'], exitCode: 0, warnings: [],
  })
  assert.deepEqual(jsonAnswer(f.run(['delete', 'ABSENT', '--json']), 3), {
    command: 'delete', status: 'missing', names: ['ABSENT'], exitCode: 3, warnings: [],
  })
  const text = f.run(['has', 'TOKEN'], env)
  assert.match(text.stdout, /^TOKEN is saved in the /)
  assert.equal(text.stderr, '')
})

test('JSON failures never echo a helper error, invalid argument, unknown verb or corrupt catalog (S-41)', () => {
  const f = jsonCliFixture()
  const sensitive = 'dummy-sensitive-error-41'
  for (const args of [
    ['has', sensitive, '--json'], ['set', `TOKEN:${sensitive}`, '--json'],
    ['has', 'TOKEN', `--${sensitive}`, '--json'], [sensitive, '--json'],
    ['set', 'TOKEN', '--reason', '--json'], ['--json'], ['list', sensitive, '--json'],
  ]) {
    const r = f.run(args)
    const answer = jsonAnswer(r, 2)
    assert.equal(answer.status, 'invalid_usage')
    assert.ok(typeof answer.message === 'string' && answer.message.length > 0, r.stdout)
    assert.ok(!r.stdout.includes(sensitive), r.stdout)
    assert.equal(r.stderr, '')
  }
  for (const [verb, message] of [['has', 'Could not read TOKEN from the test store.'], ['delete', UNEXPECTED_JSON_MESSAGE]]) {
    const r = f.run([verb, 'TOKEN', '--json'], { KP_JSON_ERROR: sensitive })
    assert.deepEqual(jsonAnswer(r, 1), { command: verb, status: 'error', names: ['TOKEN'], exitCode: 1, message })
    assert.equal(r.stderr, '')
    assert.ok(!r.stdout.includes(sensitive))
  }
  writeFileSync(join(f.dir, 'catalog.json'), `{ ${sensitive}`)
  assert.deepEqual(jsonAnswer(f.run(['list', '--json']), 1), {
    command: 'list', status: 'error', names: [], exitCode: 1, message: UNEXPECTED_JSON_MESSAGE,
  })
  writeFileSync(join(f.dir, 'catalog.json'), JSON.stringify({ [sensitive]: {} }))
  const badCatalog = f.run(['list', '--json'])
  assert.deepEqual(jsonAnswer(badCatalog, 1), {
    command: 'list', status: 'error', names: [], exitCode: 1, message: 'The catalog contains an invalid name.',
  })
  assert.equal(badCatalog.stderr, '')
})

test("JSON cancellation, timeout and deferral keep their exit codes and carry keyprompt's message (S-41, B-19)", () => {
  const f = jsonCliFixture()
  for (const [code, status] of [[4, 'cancelled'], [5, 'timed_out'], [6, 'deferred']]) {
    const message = `Test outcome ${code}. Nothing was saved.`
    const r = f.run(['set', 'TOKEN', '--json'], { KP_JSON_ERROR: message, KP_JSON_CODE: String(code) })
    assert.deepEqual(jsonAnswer(r, code), { command: 'set', status, names: ['TOKEN'], exitCode: code, message })
    assert.equal(r.stderr, '')
  }
})

test("a JSON failure says why in keyprompt's own words: the text-mode sentence, without what was typed or what a helper printed (B-19)", () => {
  const f = jsonCliFixture()
  // keyprompt wrote every word: the JSON message is the sentence text mode prints after "keyprompt: ".
  for (const args of [['set'], ['has', 'A', 'B'], ['delete']]) {
    const text = f.run(args)
    assert.equal(text.status, 2)
    assert.match(text.stderr, /^keyprompt: /)
    assert.equal(jsonAnswer(f.run([...args, '--json']), 2).message, text.stderr.slice('keyprompt: '.length).trimEnd())
  }
  // Text mode repeats what was typed or what a helper printed; the JSON message leaves it out.
  const typed = 'dummy-typed-47'
  for (const [args, extra, code, message] of [
    [['has', typed], {}, 2, 'A name is not a valid secret name. Use an environment-variable style name: capital letters, digits and _, starting with a letter or _ (for example OPENAI_API_KEY).'],
    [['set', `TOKEN:${typed}`], {}, 2, 'Unknown hint on TOKEN. Use visible, multiline or optional.'],
    [['has', 'TOKEN', `--${typed}`], {}, 2, 'Unknown option. See keyprompt --help.'],
    [['has', 'TOKEN'], { KP_JSON_ERROR: typed }, 1, 'Could not read TOKEN from the test store.'],
    [['delete', 'TOKEN'], { KP_JSON_ERROR: typed }, 1, UNEXPECTED_JSON_MESSAGE],
  ]) {
    const text = f.run(args, extra)
    assert.equal(text.status, code)
    assert.ok(text.stderr.includes(typed), text.stderr)
    const r = f.run([...args, '--json'], extra)
    assert.equal(jsonAnswer(r, code).message, message)
    assert.ok(!r.stdout.includes(typed), r.stdout)
    assert.equal(r.stderr, '')
  }
})

test('JSON catalog warnings preserve the successful delete or missing outcome (S-41)', () => {
  const f = jsonCliFixture()
  writeFileSync(join(f.dir, 'catalog.json'), '{ broken')
  for (const [values, code, status] of [[{ TOKEN: 'dummy-41' }, 0, 'deleted'], [{}, 3, 'missing']]) {
    const r = f.run(['delete', 'TOKEN', '--json'], { KP_JSON_VALUES: JSON.stringify(values) })
    assert.deepEqual(jsonAnswer(r, code), { command: 'delete', status, names: ['TOKEN'], exitCode: code, warnings: ['catalog_not_updated'] })
    assert.equal(r.stderr, '')
  }
})

test('JSON option boundaries and unsupported commands are enforced before any side effect (S-41)', () => {
  const f = jsonCliFixture()
  for (const args of [
    ['run', 'TOKEN', '--json', '--', process.execPath, '-e', 'process.exit(99)'],
    ['install-guard', '--yes', '--json'], ['demo', '--json'],
    ['set', 'TOKEN', '--json', '--', 'echo'], ['has', 'TOKEN', '--json', '--', 'echo'],
  ]) {
    const r = f.run(args, { KP_JSON_ERROR: 'must-not-read-the-store' })
    assert.equal(jsonAnswer(r, 2).status, 'invalid_usage')
    assert.equal(r.stderr, '')
  }
  for (const flag of ['--reason', '--by']) {
    const r = f.run(['list', flag, '--json']) // invalid value, not a value token
    assert.equal(jsonAnswer(r, 2).status, 'invalid_usage')
    const parsed = parseArgs(['list', flag, 'literal--json'])
    assert.equal(parsed.json, false)
  }
  const childFlag = f.run(['run', 'TOKEN', '--', '--json'], { KP_JSON_ERROR: 'must-not-read-the-store' })
  assert.equal(childFlag.status, 1)
  assert.match(childFlag.stderr, /must-not-read-the-store/)
  assert.equal(childFlag.stdout, '')
})

test('JSON set distinguishes saved, replaced and empty boxes, and catalog-only failures (S-41)', { skip: process.platform === 'win32' }, () => {
  const f = jsonCliFixture()
  const browser = join(f.dir, 'save.mjs')
  writeFileSync(browser, `#!${process.execPath}
import { request } from 'node:http'
const url = new URL(process.argv[2])
const action = process.env.KP_JSON_ACTION || 'submit'
const body = action === 'submit' ? { values: { OLD: 'dummy-new-sensitive-41', NEW: 'dummy-other-sensitive-41' }, remember: true } : {}
request({ hostname: url.hostname, port: url.port, path: url.pathname + '/' + action, method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' } }, res => res.resume()).end(JSON.stringify(body))
`)
  chmodSync(browser, 0o755)
  const args = ['set', 'OLD', 'NEW', 'EMPTY:optional', '--json']
  const env = { KP_JSON_VALUES: '{"OLD":"dummy-old-sensitive-41"}', KEYPROMPT_BROWSER: browser }
  for (const broken of [false, true]) {
    if (broken) writeFileSync(join(f.dir, 'catalog.json'), '{ broken')
    const r = f.run(args, env)
    assert.deepEqual(jsonAnswer(r, 0), {
      command: 'set', status: 'saved', names: ['OLD', 'NEW'], exitCode: 0,
      replaced: ['OLD'], empty: ['EMPTY'], warnings: broken ? ['catalog_not_updated'] : [],
    })
    assert.ok(!r.stdout.includes('sensitive'), r.stdout)
    assert.ok(!r.stderr.includes('sensitive'), r.stderr)
  }
  for (const [action, code, status, message] of [
    ['cancel', 4, 'cancelled', 'The person closed the secret card without saving.'],
    ['later', 6, 'deferred', 'The person chose Later for OLD, NEW and EMPTY. Nothing was saved.'],
  ]) {
    const r = f.run(args, { ...env, KP_JSON_ACTION: action })
    assert.deepEqual(jsonAnswer(r, code), { command: 'set', status, names: ['OLD', 'NEW', 'EMPTY'], exitCode: code, message })
  }
})

/** A project folder holding these files, for setup. */
function project(f, files) {
  const dir = join(f.dir, `project-${randomBytes(3).toString('hex')}`)
  mkdirSync(dir)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

test('setup with nothing missing opens no card, asks for nothing and reports every name as saved, in text and JSON (S-42)', () => {
  const f = jsonCliFixture()
  const cwd = project(f, { '.env.example': '# keys\nA_KEY=dummy-example-value\nB_KEY=\n' })
  // KEYPROMPT_BROWSER points at nothing, so a card would fail the command.
  const env = { KP_JSON_VALUES: JSON.stringify({ A_KEY: 'dummy-sensitive-a', B_KEY: 'dummy-sensitive-b' }) }
  const text = f.run(['setup'], env, cwd)
  assert.equal(text.status, 0, text.stderr)
  assert.equal(
    text.stdout,
    'Nothing to ask: every name in the example file is saved already.\nAlready saved, so not asked: A_KEY and B_KEY.\nUse them with: keyprompt run A_KEY,B_KEY -- <command>\n',
  )
  assert.equal(text.stderr, '')
  const r = f.run(['setup', '--json'], env, cwd)
  assert.deepEqual(jsonAnswer(r, 0), {
    command: 'setup', status: 'saved', names: [], exitCode: 0,
    replaced: [], empty: [], warnings: [], skipped: ['A_KEY', 'B_KEY'], remaining: [], ignoredLines: [],
  })
  assert.ok(!r.stdout.includes('dummy'), r.stdout)
})

test('setup refuses .env and .env.local with exit 2 before it reads them or the store (S-42)', () => {
  const f = jsonCliFixture()
  const cwd = project(f, { '.env': 'A_KEY=dummy-sensitive-env\n', '.env.local': 'B_KEY=dummy-sensitive-local\n' })
  // Reading the store would fail with exit 1, so exit 2 shows it was not read.
  const env = { KP_JSON_ERROR: 'must-not-read-the-store' }
  for (const from of ['.env', '.env.local', join(cwd, '.env')]) {
    const text = f.run(['setup', '--from', from], env, cwd)
    assert.equal(text.status, 2, text.stderr)
    assert.match(text.stderr, /^keyprompt: setup reads names only from an example file, never from a file that may hold real values/)
    const r = f.run(['setup', '--json', '--from', from], env, cwd)
    assert.deepEqual(jsonAnswer(r, 2), {
      command: 'setup', status: 'invalid_usage', names: [], exitCode: 2, message: text.stderr.slice('keyprompt: '.length).trimEnd(),
    })
    for (const out of [text.stdout, text.stderr, r.stdout, r.stderr]) assert.ok(!/dummy|A_KEY|B_KEY|must-not/.test(out), out)
  }
})

test('setup usage: no .env.example, --from with another command or without a value, names after setup (S-42)', () => {
  const f = jsonCliFixture()
  const empty = project(f, {})
  const none = f.run(['setup'], {}, empty)
  assert.equal(none.status, 2)
  assert.equal(none.stderr, "keyprompt: There is no .env.example in this folder. Run keyprompt setup in the project's folder, or name its example file with --from FILE.\n")
  for (const [args, message] of [
    [['has', 'A_KEY', '--from', 'x.env.example'], '--from works only with setup.'],
    [['setup', '--from'], '--from needs a value.'],
    [['setup', 'A_KEY'], 'Usage: keyprompt setup [--from FILE] [--reason TEXT] [--by TEXT]'],
  ]) {
    const r = f.run(args, { KP_JSON_ERROR: 'must-not-read-the-store' }, empty)
    assert.equal(r.status, 2, r.stderr)
    assert.equal(r.stderr, `keyprompt: ${message}\n`)
  }
  // --from's value is never taken for the command, so the result names setup.
  const json = jsonAnswer(f.run(['--from', 'x.env.example', 'setup', '--json'], {}, empty), 2)
  assert.equal(json.command, 'setup')
  assert.equal(json.message, "There is no file at the path given with --from. Run keyprompt setup in the project's folder, or name its example file with --from FILE.")
})

test('setup asks on one card for the first 12 missing names in file order, never a saved one, and reports the rest; Later exits 6 (S-42)', { skip: process.platform === 'win32' }, () => {
  const f = jsonCliFixture()
  const missing = Array.from({ length: 14 }, (_, i) => `NAME_${String(i + 1).padStart(2, '0')}`)
  const lines = ['# saved already', 'SAVED_ONE=dummy-example-value', 'lower_case=dummy-example-value', ...missing.map((name) => `${name}=dummy-example-value`)]
  const cwd = project(f, { '.env.example': `${lines.join('\n')}\n` })
  const browser = join(f.dir, 'setup-card.mjs')
  // Records the card page, then presses Save with two values, or Later.
  writeFileSync(browser, `#!${process.execPath}
import { writeFileSync } from 'node:fs'
import { request } from 'node:http'
const url = new URL(process.argv[2])
request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { Host: url.host } }, (res) => {
  const chunks = []
  res.on('data', (c) => chunks.push(c))
  res.on('end', () => {
    writeFileSync(process.env.KP_PAGE, Buffer.concat(chunks))
    const action = process.env.KP_JSON_ACTION || 'submit'
    const body = action === 'submit' ? { values: { NAME_01: 'dummy-sensitive-01', NAME_05: 'dummy-sensitive-05' }, remember: true } : {}
    request({ hostname: url.hostname, port: url.port, path: url.pathname + '/' + action, method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' } }, (r) => r.resume()).end(JSON.stringify(body))
  })
}).end()
`)
  chmodSync(browser, 0o755)
  const page = join(f.dir, 'page.html')
  const env = { KP_JSON_VALUES: JSON.stringify({ SAVED_ONE: 'dummy-sensitive-saved' }), KEYPROMPT_BROWSER: browser, KP_PAGE: page }
  const onCard = missing.slice(0, 12)
  const empty = onCard.filter((name) => name !== 'NAME_01' && name !== 'NAME_05')

  const r = f.run(['setup', '--json'], env, cwd)
  assert.deepEqual(jsonAnswer(r, 0), {
    command: 'setup', status: 'saved', names: ['NAME_01', 'NAME_05'], exitCode: 0,
    replaced: [], empty, warnings: [], skipped: ['SAVED_ONE'], remaining: ['NAME_13', 'NAME_14'], ignoredLines: [3],
  })
  const html = readFileSync(page, 'utf8')
  for (const name of onCard) assert.ok(html.includes(name), name)
  for (const name of ['NAME_13', 'NAME_14', 'SAVED_ONE', 'lower_case', 'dummy']) assert.ok(!html.includes(name), name)
  for (const out of [r.stdout, r.stderr]) assert.ok(!out.includes('dummy'), out)

  const text = f.run(['setup'], env, cwd)
  assert.equal(text.status, 0, text.stderr)
  assert.equal(
    text.stdout,
    [
      `Saved NAME_01 and NAME_05 in the ${getStore().label}. The values were not shown here.`,
      `Left empty, so still not saved: ${empty.slice(0, -1).join(', ')} and NAME_12.`,
      'Already saved, so not asked: SAVED_ONE.',
      "Not asked yet, because one card holds at most 12: NAME_13 and NAME_14. Run keyprompt setup again: it asks for the first 12 names still missing, in the file's order.",
      'Line 3 of the example file was not read: keyprompt reads lines like NAME=..., where NAME uses capital letters, digits and _.',
      'Use them with: keyprompt run SAVED_ONE,NAME_01,NAME_05 -- <command>',
      '',
    ].join('\n'),
  )
  assert.ok(!text.stderr.includes('dummy'), text.stderr)

  const later = f.run(['setup', '--json'], { ...env, KP_JSON_ACTION: 'later' }, cwd)
  assert.deepEqual(jsonAnswer(later, 6), {
    command: 'setup', status: 'deferred', names: onCard, exitCode: 6,
    message: `The person chose Later for ${onCard.slice(0, -1).join(', ')} and NAME_12. Nothing was saved.`,
  })
})

/** The activity log's lines, as `keyprompt log --json` returns them. */
function logEntries(f, cwd) {
  const answer = jsonAnswer(f.run(['log', '--json'], {}, cwd), 0)
  assert.equal(answer.command, 'log')
  assert.equal(answer.status, 'listed')
  return answer
}

test('run and delete write one names-only line each, with the program but never its arguments; has, list and a delete of an unsaved name write none (S-43)', () => {
  const f = jsonCliFixture()
  const cwd = project(f, {})
  const env = { KP_JSON_VALUES: JSON.stringify({ TOKEN: 'dummy-sensitive-value-43' }) }
  assert.deepEqual(logEntries(f, cwd), { command: 'log', status: 'listed', names: [], exitCode: 0, entries: [] })
  const ran = f.run(['run', 'TOKEN', '--', process.execPath, '-e', 'process.exit(3)', 'dummy-sensitive-arg-43'], env, cwd)
  assert.equal(ran.status, 3, ran.stderr)
  for (const args of [['has', 'TOKEN'], ['list'], ['delete', 'ABSENT'], ['run', 'ABSENT:optional', '--', process.execPath, '-e', '']]) f.run(args, env, cwd)
  assert.equal(f.run(['delete', 'TOKEN'], env, cwd).status, 0)
  const answer = logEntries(f, cwd)
  const folder = realpathSync(cwd)
  assert.deepEqual(answer.names, ['TOKEN'])
  assert.deepEqual(answer.entries.map(({ time, ...rest }) => rest), [
    { event: 'run', command: 'run', names: ['TOKEN'], exitCode: 3, program: basename(process.execPath), folder },
    { event: 'deleted', command: 'delete', names: ['TOKEN'], exitCode: 0, folder },
  ])
  for (const entry of answer.entries) assert.ok(!Number.isNaN(Date.parse(entry.time)))
  const file = readFileSync(join(f.dir, 'activity.jsonl'), 'utf8')
  assert.ok(!file.includes('sensitive'), file)
  const text = f.run(['log'], {}, cwd)
  assert.equal(text.status, 0, text.stderr)
  assert.match(text.stdout, new RegExp(`  Gave TOKEN to ${basename(process.execPath).replace('.', '\\.')}, which exited with 3, in `))
  assert.match(text.stdout, /  Deleted TOKEN, in /)
  assert.match(text.stdout, /Shown: all 2 lines\. The log is .*activity\.jsonl; it keeps the newest 1000 and never a value\.\n$/)
  const usage = f.run(['log', 'TOKEN'], {}, cwd)
  assert.equal(usage.status, 2)
  assert.equal(usage.stderr, 'keyprompt: Usage: keyprompt log [--json]\n')
})

test('a save, Later and Cancel on a card each write one line naming the keyprompt command; values never reach the log (S-43)', { skip: process.platform === 'win32' }, () => {
  const f = jsonCliFixture()
  const cwd = project(f, { '.env.example': 'SETUP_KEY=\n' })
  const browser = join(f.dir, 'card.mjs')
  writeFileSync(browser, `#!${process.execPath}
import { request } from 'node:http'
const url = new URL(process.argv[2])
const action = process.env.KP_JSON_ACTION || 'submit'
const body = action === 'submit' ? { values: JSON.parse(process.env.KP_VALUES), remember: process.env.KP_REMEMBER !== 'no' } : {}
request({ hostname: url.hostname, port: url.port, path: url.pathname + '/' + action, method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' } }, res => res.resume()).end(JSON.stringify(body))
`)
  chmodSync(browser, 0o755)
  const env = { KEYPROMPT_BROWSER: browser, KP_VALUES: '{"NEW":"dummy-sensitive-new-43"}' }
  assert.equal(f.run(['set', 'NEW', 'EMPTY:optional'], env, cwd).status, 0)
  assert.equal(f.run(['setup'], { ...env, KP_VALUES: '{"SETUP_KEY":"dummy-sensitive-setup-43"}' }, cwd).status, 0)
  assert.equal(f.run(['set', 'NEW'], { ...env, KP_JSON_ACTION: 'later' }, cwd).status, 6)
  assert.equal(f.run(['run', 'NEW', '--', process.execPath, '-e', ''], { ...env, KP_JSON_ACTION: 'cancel' }, cwd).status, 4)
  // Remember unticked: nothing is saved, so only the run line is written.
  assert.equal(f.run(['run', 'NEW', '--', process.execPath, '-e', ''], { ...env, KP_REMEMBER: 'no' }, cwd).status, 0)
  const answer = logEntries(f, cwd)
  assert.deepEqual(answer.entries.map((e) => [e.event, e.command, e.names, e.exitCode]), [
    ['saved', 'set', ['NEW'], 0],
    ['saved', 'setup', ['SETUP_KEY'], 0],
    ['deferred', 'set', ['NEW'], 6],
    ['cancelled', 'run', ['NEW'], 4],
    ['run', 'run', ['NEW'], 0],
  ])
  assert.ok(!readFileSync(join(f.dir, 'activity.jsonl'), 'utf8').includes('sensitive'))
})

test('keyprompt mcp answers an MCP client with names-only results, writes only JSON-RPC to stdout and logs a save as mcp (S-45)', { skip: process.platform === 'win32' }, () => {
  const f = jsonCliFixture()
  const browser = join(f.dir, 'card.mjs')
  writeFileSync(browser, `#!${process.execPath}
import { request } from 'node:http'
const url = new URL(process.argv[2])
const body = { values: { NEW: 'dummy-sensitive-new-45' }, remember: true }
request({ hostname: url.hostname, port: url.port, path: url.pathname + '/submit', method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' } }, res => res.resume()).end(JSON.stringify(body))
`)
  chmodSync(browser, 0o755)
  const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params })
  const input = [
    rpc(1, 'server/discover', {}),
    rpc(2, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    rpc(3, 'tools/call', { name: 'check_secrets', arguments: { names: ['TOKEN', 'ABSENT'] } }),
    rpc(4, 'tools/call', { name: 'check_secrets', arguments: { names: ['dummy-sensitive-name-45'] } }),
    rpc(5, 'tools/call', { name: 'request_secret', arguments: { fields: ['NEW', 'EMPTY:optional'], reason: 'Run the tests' } }),
  ].join('\n')
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(join(f.dir, 'store.mjs')).href, BIN, 'mcp'], {
    input: `${input}\n`,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, KEYPROMPT_HOME: f.dir, KEYPROMPT_BROWSER: browser, KP_JSON_VALUES: JSON.stringify({ TOKEN: 'dummy-sensitive-value-45' }) },
  })
  assert.equal(r.status, 0, r.stderr)
  const answers = new Map(r.stdout.trim().split('\n').map((line) => {
    const message = JSON.parse(line)
    assert.equal(message.jsonrpc, '2.0')
    return [message.id, message]
  }))
  assert.deepEqual([...answers.keys()].sort(), [1, 2, 3, 4, 5])
  assert.equal(answers.get(1).error.code, -32601)
  assert.equal(answers.get(2).result.serverInfo.name, 'keyprompt')
  assert.deepEqual(answers.get(3).result.structuredContent, { command: 'has', status: 'missing', names: ['TOKEN', 'ABSENT'], exitCode: 3, saved: ['TOKEN'], missing: ['ABSENT'] })
  assert.equal(answers.get(3).result.isError, false)
  assert.equal(answers.get(4).result.isError, true)
  assert.equal(answers.get(4).result.structuredContent.status, 'invalid_usage')
  assert.deepEqual(answers.get(5).result.structuredContent, {
    command: 'set', status: 'saved', names: ['NEW'], exitCode: 0, replaced: [], empty: ['EMPTY'], warnings: [],
  })
  assert.ok(!r.stdout.includes('sensitive'), r.stdout)
  assert.ok(!r.stderr.includes('sensitive'), r.stderr)
  const log = readFileSync(join(f.dir, 'activity.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(log.map((e) => [e.event, e.command, e.names]), [['saved', 'mcp', ['NEW']]])
  const usage = f.run(['mcp', 'EXTRA'])
  assert.equal(usage.status, 2)
  assert.match(usage.stderr, /^keyprompt: Usage: keyprompt mcp/)
})
