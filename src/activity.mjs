import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
 * throws: a log that cannot be written is left as it is. Two keyprompt
 * processes trimming at the same moment can lose one line.
 * @param {ActivityEntry} entry
 */
export async function recordActivity(entry) {
  try {
    await mkdir(catalogDir(), { recursive: true, mode: 0o700 })
    await appendFile(activityPath(), `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    const lines = (await readFile(activityPath(), 'utf8')).split('\n').filter((line) => line.length > 0)
    if (lines.length <= MAX_ENTRIES) return
    const tmp = `${activityPath()}.${process.pid}.tmp`
    await writeFile(tmp, `${lines.slice(-MAX_ENTRIES).join('\n')}\n`, { mode: 0o600 })
    await rename(tmp, activityPath())
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
      return `Gave ${names} to ${entry.program ?? 'a command'}, which exited with ${entry.exitCode}`
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
  const lines = shown.map((entry) => `${localTime(new Date(entry.time))}  ${describe(entry)}, in ${entry.folder}`)
  const which = total > shown.length ? `the newest ${shown.length} of ${total} lines` : `all ${total} ${total === 1 ? 'line' : 'lines'}`
  lines.push(`Shown: ${which}. The log is ${path}; it keeps the newest ${MAX_ENTRIES} and never a value.`)
  return `${lines.join('\n')}\n`
}
