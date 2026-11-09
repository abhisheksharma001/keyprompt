import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { catalogDir } from './catalog.mjs'
import { KeypromptError } from './errors.mjs'
import { NAME_PATTERN } from './names.mjs'
import { joinNames } from './save.mjs'

/**
 * A names-only record of what keyprompt did with each name (S-43, D-20): when
 * a value was saved, handed to a command, deleted, or not given because the
 * person chose Later, cancelled or let the card time out, or an MCP client
 * withdrew its request. A line never holds a
 * value, a reason, an environment, a command's arguments or its output; only
 * the program's name and the folder it ran in.
 *
 * @typedef {'saved' | 'run' | 'deleted' | 'deferred' | 'cancelled' | 'timed_out' | 'withdrawn'} ActivityEvent
 * @typedef {{ time: string, event: ActivityEvent, command: string, names: string[], exitCode: number, program?: string, folder: string }} ActivityEntry
 */

/** The file keeps this many lines, the newest ones. */
export const MAX_ENTRIES = 1000

/** `keyprompt log` shows this many, the newest ones. */
export const SHOWN_ENTRIES = 50

const EVENTS = new Set(['saved', 'run', 'deleted', 'deferred', 'cancelled', 'timed_out', 'withdrawn'])
const COMMANDS = new Set(['set', 'setup', 'run', 'delete', 'mcp'])

export function activityPath() {
  return join(catalogDir(), 'activity.jsonl')
}

/** How long a writer waits for its turn to trim (B-23). Its line is appended either way. */
export const LOCK_WAIT_MS = 2000

/** A lock older than this is left over from a process that crashed or stopped while holding it. */
export const STALE_LOCK_MS = 10_000

/**
 * Errors that mean "someone else has the lock". On Windows a lock file being
 * deleted gives EPERM or EACCES; elsewhere those mean the folder cannot be
 * written, and waiting would only slow every command (S-54 senior review).
 */
const BUSY = new Set(process.platform === 'win32' ? ['EEXIST', 'EPERM', 'EACCES'] : ['EEXIST'])

/**
 * Take the trimming lock: a file made with an exclusive create, holding this
 * writer's random token. A lock older than STALE_LOCK_MS is removed, but only
 * if its token has not changed, so a waiter never removes a lock another
 * writer has just taken. Resolves false when the turn does not come within
 * LOCK_WAIT_MS.
 * @param {string} lock
 * @param {string} token
 * @returns {Promise<boolean>}
 */
async function takeLock(lock, token) {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const handle = await open(lock, 'wx', 0o600)
      try {
        await handle.writeFile(token)
      } catch (error) {
        // A lock without its token (a full disk, say) would make every writer wait: remove it.
        await handle.close()
        await rm(lock, { force: true })
        throw error
      }
      await handle.close()
      return true
    } catch (error) {
      if (!BUSY.has(/** @type {NodeJS.ErrnoException} */ (error).code ?? '')) throw error
    }
    try {
      const info = await stat(lock)
      // Something that is not a lock file (a folder, say) never goes away: stop waiting for it.
      if (!info.isFile()) return false
      const seen = await readFile(lock, 'utf8')
      const { mtimeMs } = info
      // Still the same lock, and old: its holder is gone, or stopped. (Waiters that judged the same stale lock in the same instant can overlap.)
      if (Date.now() - mtimeMs > STALE_LOCK_MS && (await readFile(lock, 'utf8')) === seen) {
        await rm(lock, { force: true })
        continue
      }
    } catch {
      // The holder just let it go: try again.
    }
    if (Date.now() >= deadline) return false
    await new Promise((done) => setTimeout(done, 15 + Math.floor(Math.random() * 20)))
  }
}

/**
 * Whether the lock still holds this writer's token.
 * @param {string} lock
 * @param {string} token
 */
async function stillHeld(lock, token) {
  try {
    return (await readFile(lock, 'utf8')) === token
  } catch {
    return false
  }
}

/**
 * Remove the lock only if it is still this writer's: a holder that was
 * paused past STALE_LOCK_MS must not remove the next holder's lock.
 * @param {string} lock
 * @param {string} token
 */
export async function releaseLock(lock, token) {
  if (await stillHeld(lock, token)) await rm(lock, { force: true })
}

/**
 * The program's own name, without its folder: `python` for `/usr/bin/python`,
 * `node.exe` for `C:\Program Files\nodejs\node.exe`. Its arguments are never
 * kept: they can hold another secret or a client's data.
 * @param {string} command
 */
export function programName(command) {
  return command.split(/[\\/]/).pop() || command
}

/**
 * @param {{ event: ActivityEvent, command: string, names: string[], exitCode: number, program?: string, time?: Date }} what
 * @returns {ActivityEntry}
 */
export function activityEntry({ event, command, names, exitCode, program, time = new Date() }) {
  return {
    time: time.toISOString(),
    event,
    command,
    names,
    exitCode,
    ...(program === undefined ? {} : { program: programName(program) }),
    folder: process.cwd(),
  }
}

/**
 * Add one line, then drop the oldest beyond MAX_ENTRIES. The log is a record
 * for the person, never a reason for a command to fail, so nothing here
 * throws: a log that cannot be written is left as it is.
 *
 * A short append is safe without a lock (the file is opened for appending),
 * so every writer appends its line. Only the trim, which rewrites the file,
 * needs a turn: writers take turns through `activity.jsonl.lock`, so a trim
 * does not drop another writer's new line (B-23). Two cases remain: a writer
 * that does not get its turn within LOCK_WAIT_MS skips the trim, and its line
 * is then at risk if it lands in the middle of another writer's trim; and a
 * writer stopped for over STALE_LOCK_MS in the middle of a trim (a laptop
 * asleep, a suspended process) has its lock cleared as stale, and its trim
 * can then drop lines written meanwhile. It checks its token just before
 * the rename, which narrows that case but cannot close it.
 * @param {ActivityEntry} entry
 */
export async function recordActivity(entry) {
  try {
    await mkdir(catalogDir(), { recursive: true, mode: 0o700 })
    const lock = `${activityPath()}.lock`
    const token = randomBytes(12).toString('hex')
    const locked = await takeLock(lock, token).catch(() => false)
    try {
      await appendFile(activityPath(), `${JSON.stringify(entry)}\n`, { mode: 0o600 })
      if (!locked) return
      const lines = (await readFile(activityPath(), 'utf8')).split('\n').filter((line) => line.length > 0)
      if (lines.length <= MAX_ENTRIES) return
      const tmp = `${activityPath()}.${process.pid}.${token}.tmp`
      await writeFile(tmp, `${lines.slice(-MAX_ENTRIES).join('\n')}\n`, { mode: 0o600 })
      try {
        // Lost the lock while stopped (it was cleared as stale): another writer may have written since, so do not overwrite.
        if (!(await stillHeld(lock, token))) {
          await rm(tmp, { force: true })
          return
        }
        await rename(tmp, activityPath())
      } catch (error) {
        // Never leave the temporary copy behind (EPERM on Windows while another program has the file open).
        await rm(tmp, { force: true })
        throw error
      }
    } finally {
      if (locked) await releaseLock(lock, token)
    }
  } catch {
    // Deliberately silent (D-20): the action itself worked.
  }
}

/**
 * Only keyprompt writes the file, but a line that is not one of its own (an
 * edit by hand, a cut-off write) is left out rather than shown.
 * @param {unknown} entry
 * @returns {entry is ActivityEntry}
 */
function isEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
  const e = /** @type {Record<string, unknown>} */ (entry)
  return (
    typeof e.time === 'string' &&
    !Number.isNaN(Date.parse(e.time)) &&
    typeof e.event === 'string' &&
    EVENTS.has(e.event) &&
    typeof e.command === 'string' &&
    COMMANDS.has(e.command) &&
    Array.isArray(e.names) &&
    e.names.every((name) => typeof name === 'string' && NAME_PATTERN.test(name)) &&
    Number.isInteger(e.exitCode) &&
    (e.program === undefined || typeof e.program === 'string') &&
    typeof e.folder === 'string'
  )
}

/**
 * Every readable line, oldest first. No file yet is an empty log.
 * @returns {Promise<ActivityEntry[]>}
 */
export async function readActivity() {
  let text
  try {
    text = await readFile(activityPath(), 'utf8')
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code
    if (code === 'ENOENT') return []
    const plain = typeof code === 'string' && /^[A-Z0-9_]{1,20}$/.test(code) ? ` (${code})` : ''
    throw new KeypromptError(`Could not read the activity log${plain}. It is ${activityPath()}.`, {
      jsonMessage: `Could not read the activity log${plain}.`,
    })
  }
  /** @type {ActivityEntry[]} */
  const entries = []
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    try {
      const entry = JSON.parse(line)
      if (isEntry(entry)) entries.push(entry)
    } catch {
      // Not a line keyprompt wrote whole; left out.
    }
  }
  return entries
}

/**
 * Control characters (C0, DEL, C1), format characters (bidirectional-text
 * marks, zero-width characters, tag characters, the soft hyphen) and line or
 * paragraph separators shown as `?`,
 * so a folder or program name cannot move the cursor or reorder the line it
 * is printed on (B-23).
 * @param {string} text
 */
function printable(text) {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?')
}

/** @param {Date} date */
function localTime(date) {
  const two = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** @param {ActivityEntry} entry */
function describe(entry) {
  const names = joinNames(entry.names)
  switch (entry.event) {
    case 'saved':
      return `Saved ${names} (${entry.command})`
    case 'run':
      return `Gave ${names} to ${entry.program === undefined ? 'a command' : printable(entry.program)}, which exited with ${entry.exitCode}`
    case 'deleted':
      return `Deleted ${names}`
    case 'deferred':
      return `The person chose Later for ${names} (${entry.command})`
    case 'cancelled':
      return `The person cancelled the card for ${names} (${entry.command})`
    case 'timed_out':
      return `Nobody filled in the card for ${names} (${entry.command})`
    case 'withdrawn':
      return `The agent withdrew the card for ${names} (${entry.command})`
  }
}

/**
 * What `keyprompt log` prints: one line per entry, in local time, oldest of
 * the shown ones first.
 * @param {ActivityEntry[]} shown
 * @param {number} total How many readable lines the file has.
 * @param {string} path
 */
export function activityReport(shown, total, path) {
  if (shown.length === 0) return `Nothing in the activity log yet. It is kept in ${path}.\n`
  const lines = shown.map((entry) => `${localTime(new Date(entry.time))}  ${describe(entry)}, in ${printable(entry.folder)}`)
  const which = total > shown.length ? `the newest ${shown.length} of ${total} lines` : `all ${total} ${total === 1 ? 'line' : 'lines'}`
  lines.push(`Shown: ${which}. The log is ${path}; it keeps the newest ${MAX_ENTRIES} and never a value.`)
  return `${lines.join('\n')}\n`
}
