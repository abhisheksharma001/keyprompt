import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  activityEntry,
  activityPath,
  activityReport,
  MAX_ENTRIES,
  programName,
  readActivity,
  recordActivity,
} from '../src/activity.mjs'

/** Runs `body` with KEYPROMPT_HOME set to a new folder, then puts the old value back. */
async function inHome(body) {
  const before = process.env.KEYPROMPT_HOME
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-activity-'))
  process.env.KEYPROMPT_HOME = home
  try {
    return await body(home)
  } finally {
    if (before === undefined) delete process.env.KEYPROMPT_HOME
    else process.env.KEYPROMPT_HOME = before
  }
}

test('a program is kept by its own name, never its folder or arguments (S-43)', () => {
  assert.equal(programName('python'), 'python')
  assert.equal(programName('/usr/local/bin/python3'), 'python3')
  assert.equal(programName('C:\\Program Files\\nodejs\\node.exe'), 'node.exe')
  const entry = activityEntry({ event: 'run', command: 'run', names: ['A_KEY'], exitCode: 3, program: '/usr/bin/env', time: new Date('2026-11-09T12:00:00Z') })
  assert.deepEqual(entry, { time: '2026-11-09T12:00:00.000Z', event: 'run', command: 'run', names: ['A_KEY'], exitCode: 3, program: 'env', folder: process.cwd() })
  assert.deepEqual(Object.keys(activityEntry({ event: 'saved', command: 'set', names: ['A_KEY'], exitCode: 0 })), ['time', 'event', 'command', 'names', 'exitCode', 'folder'])
})

test('the log keeps the newest 1000 lines, oldest first (S-43)', async () => {
  await inHome(async () => {
    const old = new Date('2026-01-01T00:00:00Z')
    const lines = []
    for (let i = 0; i < MAX_ENTRIES + 4; i++) lines.push(JSON.stringify(activityEntry({ event: 'saved', command: 'set', names: [`N_${i}`], exitCode: 0, time: old })))
    writeFileSync(activityPath(), `${lines.join('\n')}\n`)
    await recordActivity(activityEntry({ event: 'deleted', command: 'delete', names: ['LAST'], exitCode: 0 }))
    const entries = await readActivity()
    assert.equal(entries.length, MAX_ENTRIES)
    assert.deepEqual(entries[0].names, ['N_5'])
    assert.deepEqual(entries.at(-1).names, ['LAST'])
    assert.equal(readFileSync(activityPath(), 'utf8').split('\n').filter(Boolean).length, MAX_ENTRIES)
  })
})

test('a log that cannot be written never fails the action, and a line keyprompt did not write is left out (S-43)', async () => {
  await inHome(async (home) => {
    // KEYPROMPT_HOME is a file, so the folder cannot be made: recordActivity must still resolve.
    const blocked = join(home, 'not-a-folder')
    writeFileSync(blocked, '')
    process.env.KEYPROMPT_HOME = blocked
    await recordActivity(activityEntry({ event: 'saved', command: 'set', names: ['A_KEY'], exitCode: 0 }))
    process.env.KEYPROMPT_HOME = home
    assert.deepEqual(await readActivity(), [])
    await recordActivity(activityEntry({ event: 'saved', command: 'set', names: ['A_KEY'], exitCode: 0 }))
    appendFileSync(activityPath(), '{"time":"2026-11-09T12:00:00Z","event":"saved","command":"set","names":["lower"],"exitCode":0,"folder":"/x"}\nnot json\n{"cut":')
    const entries = await readActivity()
    assert.equal(entries.length, 1)
    assert.deepEqual(entries[0].names, ['A_KEY'])
  })
})

test('the report says what happened to each name, in local time, and where the log is (S-43)', () => {
  const at = '2026-11-09T12:34:00.000Z'
  const local = new Date(at)
  const two = (n) => String(n).padStart(2, '0')
  const when = `${local.getFullYear()}-${two(local.getMonth() + 1)}-${two(local.getDate())} ${two(local.getHours())}:${two(local.getMinutes())}`
  const base = { time: at, folder: '/work/app' }
  const shown = [
    { ...base, event: 'saved', command: 'setup', names: ['A_KEY', 'B_KEY'], exitCode: 0 },
    { ...base, event: 'run', command: 'run', names: ['A_KEY'], exitCode: 0, program: 'python' },
    { ...base, event: 'deleted', command: 'delete', names: ['B_KEY'], exitCode: 0 },
    { ...base, event: 'deferred', command: 'set', names: ['C_KEY'], exitCode: 6 },
    { ...base, event: 'cancelled', command: 'run', names: ['C_KEY'], exitCode: 4 },
    { ...base, event: 'timed_out', command: 'set', names: ['C_KEY'], exitCode: 5 },
  ]
  assert.equal(
    activityReport(shown, 70, '/home/me/.keyprompt/activity.jsonl'),
    [
      `${when}  Saved A_KEY and B_KEY (setup), in /work/app`,
      `${when}  Gave A_KEY to python, which exited with 0, in /work/app`,
      `${when}  Deleted B_KEY, in /work/app`,
      `${when}  The person chose Later for C_KEY (set), in /work/app`,
      `${when}  The person cancelled the card for C_KEY (run), in /work/app`,
      `${when}  Nobody filled in the card for C_KEY (set), in /work/app`,
      'Shown: the newest 6 of 70 lines. The log is /home/me/.keyprompt/activity.jsonl; it keeps the newest 1000 and never a value.',
      '',
    ].join('\n'),
  )
  assert.equal(activityReport([], 0, '/p/activity.jsonl'), 'Nothing in the activity log yet. It is kept in /p/activity.jsonl.\n')
  assert.match(activityReport(shown.slice(0, 1), 1, '/p'), /Shown: all 1 line\. /)
})
