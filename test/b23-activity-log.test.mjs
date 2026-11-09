import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { activityEntry, activityPath, activityReport, MAX_ENTRIES, readActivity, recordActivity, releaseLock } from '../src/activity.mjs'

const ACTIVITY_URL = new URL('../src/activity.mjs', import.meta.url).href

/** Runs `body` with KEYPROMPT_HOME set to a new folder, then puts the old value back and removes the folder. */
async function inHome(body) {
  const before = process.env.KEYPROMPT_HOME
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-b23-'))
  process.env.KEYPROMPT_HOME = home
  try {
    return await body(home)
  } finally {
    if (before === undefined) delete process.env.KEYPROMPT_HOME
    else process.env.KEYPROMPT_HOME = before
    rmSync(home, { recursive: true, force: true })
  }
}

const line = (/** @type {string} */ name) => JSON.stringify(activityEntry({ event: 'saved', command: 'set', names: [name], exitCode: 0, time: new Date('2026-01-01T00:00:00Z') }))

test('B-23: 20 keyprompt processes writing to a full log at once keep all 20 lines', async () => {
  await inHome(async (home) => {
    writeFileSync(activityPath(), `${Array.from({ length: MAX_ENTRIES }, (_, i) => line(`OLD_${i}`)).join('\n')}\n`)
    const writer = join(home, 'writer.mjs')
    writeFileSync(writer, `import { activityEntry, recordActivity } from ${JSON.stringify(ACTIVITY_URL)}
await recordActivity(activityEntry({ event: 'saved', command: 'set', names: [process.argv[2]], exitCode: 0 }))
`)
    const names = Array.from({ length: 20 }, (_, i) => `NEW_${i}`)
    await Promise.all(
      names.map(
        (name) =>
          new Promise((done, fail) => {
            const child = spawn(process.execPath, [writer, name], { env: { ...process.env, KEYPROMPT_HOME: home }, stdio: 'ignore' })
            child.on('error', fail)
            child.on('exit', done)
          }),
      ),
    )
    const entries = await readActivity()
    assert.equal(entries.length, MAX_ENTRIES)
    const kept = new Set(entries.flatMap((e) => e.names))
    assert.deepEqual(names.filter((name) => !kept.has(name)), [], 'every new line is kept')
    assert.equal(existsSync(`${activityPath()}.lock`), false, 'the lock is gone afterwards')
  })
})

test('B-23: keyprompt log shows control characters and bidi marks in a folder or program as ?', () => {
  const entry = {
    time: '2026-11-09T12:00:00.000Z',
    event: 'run',
    command: 'run',
    names: ['A_KEY'],
    exitCode: 0,
    program: 'evil\u202Etxt.exe',
    folder: '/work/a\u001b[1A\u001b[2Kfake\u0007\u009b\u061c\u2028\u200b\ufeff',
  }
  const report = activityReport([entry], 1, '/p/activity.jsonl')
  assert.doesNotMatch(report.replaceAll('\n', ''), /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/)
  assert.match(report, /Gave A_KEY to evil\?txt\.exe, which exited with 0, in \/work\/a\?\[1A\?\[2Kfake\?{6}\n/)
})

test('B-23: a lock left over from a crashed process is cleared, and the line is written', async () => {
  await inHome(async () => {
    const lock = `${activityPath()}.lock`
    writeFileSync(lock, '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    await recordActivity(activityEntry({ event: 'saved', command: 'set', names: ['AFTER_CRASH'], exitCode: 0 }))
    assert.deepEqual((await readActivity()).map((e) => e.names[0]), ['AFTER_CRASH'])
    assert.equal(existsSync(lock), false)
  })
})

test('B-23: while another writer holds the lock, a writer waits about 2 seconds, then appends its line without trimming', async () => {
  await inHome(async () => {
    writeFileSync(activityPath(), `${Array.from({ length: MAX_ENTRIES }, (_, i) => line(`OLD_${i}`)).join('\n')}\n`)
    const lock = `${activityPath()}.lock`
    writeFileSync(lock, 'another-writer')
    const started = Date.now()
    await recordActivity(activityEntry({ event: 'saved', command: 'set', names: ['WAITED'], exitCode: 0 }))
    const waited = Date.now() - started
    assert.ok(waited >= 1500 && waited < 6000, `waited ${waited} ms`)
    const entries = await readActivity()
    assert.equal(entries.length, MAX_ENTRIES + 1, 'appended, not trimmed')
    assert.deepEqual(entries.at(-1).names, ['WAITED'])
    assert.equal(readFileSync(lock, 'utf8'), 'another-writer', "another writer's lock is left alone")
  })
})

test('B-23: a writer removes its lock when it is done', async () => {
  await inHome(async () => {
    await recordActivity(activityEntry({ event: 'saved', command: 'set', names: ['FIRST'], exitCode: 0 }))
    assert.equal(existsSync(`${activityPath()}.lock`), false, 'its own lock is removed')
  })
})

test('B-23: releasing the lock leaves it alone when another writer holds it now', async () => {
  await inHome(async () => {
    const lock = `${activityPath()}.lock`
    // A holder paused past the stale limit, whose lock was cleared and taken by another writer.
    writeFileSync(lock, 'the-next-writer')
    await releaseLock(lock, 'the-paused-writer')
    assert.equal(readFileSync(lock, 'utf8'), 'the-next-writer')
    await releaseLock(lock, 'the-next-writer')
    assert.equal(existsSync(lock), false)
  })
})

test('B-23: a keyprompt folder that cannot be written costs no wait', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  await inHome(async (home) => {
    chmodSync(home, 0o500)
    try {
      const started = Date.now()
      await recordActivity(activityEntry({ event: 'saved', command: 'set', names: ['A_KEY'], exitCode: 0 }))
      assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`)
    } finally {
      chmodSync(home, 0o700)
    }
  })
})

test('B-23: a lock path that is not a file stops the waiting, and the line is still appended', async () => {
  await inHome(async () => {
    mkdirSync(`${activityPath()}.lock`)
    const started = Date.now()
    await recordActivity(activityEntry({ event: 'saved', command: 'set', names: ['A_KEY'], exitCode: 0 }))
    assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`)
    assert.deepEqual((await readActivity()).map((e) => e.names[0]), ['A_KEY'])
  })
})

test('B-23: keyprompt log --json writes DEL, C1 and invisible characters as \\u escapes, and parses back unchanged', async () => {
  await inHome(async (home) => {
    const folder = '/work/x\u007f\u009b\u202e\u200b\u{E0041}y'
    writeFileSync(activityPath(), `${JSON.stringify({ time: '2026-11-09T12:00:00.000Z', event: 'saved', command: 'set', names: ['A_KEY'], exitCode: 0, folder })}\n`)
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/keyprompt.mjs', import.meta.url)), 'log', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, KEYPROMPT_HOME: home },
    })
    assert.equal(r.status, 0, r.stderr)
    assert.doesNotMatch(r.stdout, /[\u007f-\u009f\p{Cf}]/u)
    assert.equal(JSON.parse(r.stdout).entries[0].folder, folder)
  })
})
