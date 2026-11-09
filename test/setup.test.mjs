import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { EXIT, KeypromptError } from '../src/errors.mjs'
import { assertTemplateName, exampleNames, readExampleNames, setupReport } from '../src/setup.mjs'

test('an example file gives its names in order, once each, and nothing after = (S-42)', () => {
  const text = [
    '# Stripe',
    'STRIPE_SECRET_KEY=dummy-value-one',
    '',
    'export OPENAI_API_KEY = "dummy-value-two" # a comment',
    '  PORT=3000  ',
    'STRIPE_SECRET_KEY=dummy-value-three',
    'EMPTY=',
    "QUOTED='dummy-value-four'",
  ].join('\r\n')
  const found = exampleNames(text)
  assert.deepEqual(found, { names: ['STRIPE_SECRET_KEY', 'OPENAI_API_KEY', 'PORT', 'EMPTY', 'QUOTED'], ignoredLines: [] })
  assert.ok(!JSON.stringify(found).includes('dummy'))
})

test('lines that are not a NAME=... line with a keyprompt name are reported by number only (S-42)', () => {
  const found = exampleNames(['GOOD=1', 'lower_case=dummy-a', 'just some words', 'KEY: dummy-b', '=dummy-c', 'ALSO_GOOD='].join('\n'))
  assert.deepEqual(found, { names: ['GOOD', 'ALSO_GOOD'], ignoredLines: [2, 3, 4, 5] })
})

test('a quoted value over several lines is passed over, so its lines are never taken for names (S-42)', () => {
  const text = [
    'PRIVATE_KEY="-----BEGIN KEY-----',
    'LOOKS_LIKE_A_NAME=dummy-inside-one',
    'escaped \\" quote, still inside',
    '-----END KEY-----"',
    'AFTER=1',
    "SINGLE='start",
    'INSIDE_TOO=dummy-inside-two',
    "end'",
    'TICKS=`start',
    'INSIDE_THREE=x`',
    'LAST=',
  ].join('\n')
  assert.deepEqual(exampleNames(text), { names: ['PRIVATE_KEY', 'AFTER', 'SINGLE', 'TICKS', 'LAST'], ignoredLines: [] })
})

test("setup reads only a file whose name says it is a template; .env and .env.local are refused (S-42)", () => {
  for (const ok of ['.env.example', '.env.sample', '.env.template', '.env.schema', '.env.dist', 'example.env', '.env.local.example', join('config', '.env-template'), 'ENV_SAMPLE']) {
    assert.doesNotThrow(() => assertTemplateName(ok), ok)
  }
  // One fixed sentence for every refused file, so the path the agent typed is never repeated.
  const messages = new Set()
  for (const refused of ['.env', '.env.local', '.env.production', 'secrets.env', '.envrc', join('examples', '.env'), 'counterexample.env']) {
    assert.throws(
      () => assertTemplateName(refused),
      (error) => error instanceof KeypromptError && error.exitCode === EXIT.USAGE && messages.add(error.message) !== undefined,
      refused,
    )
  }
  assert.equal(messages.size, 1)
  assert.match([...messages][0], /^setup reads names only from an example file, never from a file that may hold real values/)
})

test('a missing, oversized or nameless example file is a usage error that does not repeat the path (S-42)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-setup-'))
  const missing = join(dir, 'dummy-path-42.env.example')
  await assert.rejects(readExampleNames(missing), (error) => error instanceof KeypromptError && error.exitCode === EXIT.USAGE && !error.message.includes('dummy-path-42'))
  const big = join(dir, 'big.env.example')
  writeFileSync(big, 'A=1\n'.repeat(300_000))
  await assert.rejects(readExampleNames(big), /larger than 1 MB/)
  const none = join(dir, 'none.env.example')
  writeFileSync(none, '# only a comment\nlower=1\n')
  await assert.rejects(readExampleNames(none), /lists no names/)
})

test('the setup report names what was saved, left empty, skipped and left over, and the run line, never a value (S-42)', () => {
  const fields = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
  const report = setupReport({
    names: ['S', 'A', 'B', 'C', 'R'],
    fields,
    values: new Map([['A', 'dummy-a'], ['C', 'dummy-c']]),
    skipped: ['S'],
    remaining: ['R'],
    ignoredLines: [4, 9],
    storeLabel: 'Test Store',
  })
  assert.equal(
    report,
    [
      'Saved A and C in the Test Store. The values were not shown here.',
      'Left empty, so still not saved: B.',
      'Already saved, so not asked: S.',
      "Not asked yet, because one card holds at most 12: R. Run keyprompt setup again: it asks for the first 12 names still missing, in the file's order.",
      'Lines 4 and 9 of the example file were not read: keyprompt reads lines like NAME=..., where NAME uses capital letters, digits and _.',
      'Use them with: keyprompt run S,A,C -- <command>',
      '',
    ].join('\n'),
  )
  assert.equal(
    setupReport({ names: ['S'], fields: [], values: new Map(), skipped: ['S'], remaining: [], ignoredLines: [], storeLabel: 'Test Store' }),
    'Nothing to ask: every name in the example file is saved already.\nAlready saved, so not asked: S.\nUse it with: keyprompt run S -- <command>\n',
  )
})
