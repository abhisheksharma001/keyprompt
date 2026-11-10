// @ts-nocheck
import { realpathSync } from 'node:fs'
import { chmod, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { EXIT, KeypromptError } from './errors.mjs'

/**
 * Adds and removes the guard's two hook entries in Claude Code's user
 * settings (S-39, docs/prd/v0-3.md). Every other setting stays as it was.
 *
 * Claude Code facts this rests on (R-10, R-11, R-13; code.claude.com/docs,
 * read 2026-11-07): settings files are strict JSON; `CLAUDE_CONFIG_DIR`
 * moves the whole configuration directory; with `args`, `command` is spawned
 * directly with no shell; a hook that fails lets the action go ahead unless
 * `onFailure` is "block", which this installer leaves unset (D-17).
 */

/** Hook event name → the guard's own event argument. */
export const GUARD_EVENTS = /** @type {const} */ ({ PreToolUse: 'pre-tool-use', UserPromptSubmit: 'user-prompt-submit' })
const MATCHER = 'Bash|PowerShell'
/** Seconds. The default is 600, and one guard call takes about 0.1 s (S-38). */
const TIMEOUT = 10

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The user settings file Claude Code reads (R-11).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 */
export function settingsPath(env = process.env, home = homedir()) {
  const dir = env.CLAUDE_CONFIG_DIR
  if (!dir) return join(home, '.claude', 'settings.json')
  if (!isAbsolute(dir)) {
    throw new KeypromptError(
      `CLAUDE_CONFIG_DIR is set to a relative path (${dir}). Claude Code expects an absolute path there; set one and run this again.`,
      { exitCode: EXIT.USAGE },
    )
  }
  return join(dir, 'settings.json')
}

/**
 * The node to write into the hook. A link on PATH that points at this same
 * node (Homebrew's /opt/homebrew/bin/node) outlives an upgrade; the versioned
 * path node reports for itself does not (R-13).
 *
 * @param {string} [execPath]
 * @param {string} [pathEnv]
 * @param {NodeJS.Platform} [platform]
 */
export function nodeCommand(execPath = process.execPath, pathEnv = process.env.PATH ?? '', platform = process.platform) {
  let real
  try {
    real = realpathSync(execPath)
  } catch {
    return execPath
  }
  const name = platform === 'win32' ? 'node.exe' : 'node'
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue
    const candidate = join(dir, name)
    try {
      if (realpathSync(candidate) === real) return candidate
    } catch {
      // not there; try the next folder
    }
  }
  return execPath
}

/**
 * npx runs packages from a folder in npm's cache (`_npx/<hash>`), which npm
 * may delete at any time; a hook pointing there would stop working (R-13).
 *
 * @param {string} root keyprompt's own folder
 */
export function runsFromNpxCache(root) {
  return root.split(/[\\/]/).includes('_npx')
}

/**
 * @param {string} node absolute path of node
 * @param {string} bin absolute path of bin/keyprompt.mjs
 */
export function guardEntries(node, bin) {
  /** @param {string} event */
  const handler = (event) => ({ type: 'command', command: node, args: [bin, 'guard', event], timeout: TIMEOUT })
  return {
    PreToolUse: { matcher: MATCHER, hooks: [handler(GUARD_EVENTS.PreToolUse)] },
    UserPromptSubmit: { hooks: [handler(GUARD_EVENTS.UserPromptSubmit)] },
  }
}

/**
 * A handler this installer wrote: `args` is [.../keyprompt.mjs, 'guard', event].
 *
 * @param {unknown} handler
 */
export function isGuardHandler(handler) {
  if (!isObject(handler) || !Array.isArray(handler.args) || handler.args.length !== 3) return false
  const [bin, verb, event] = handler.args
  return typeof bin === 'string' && /keyprompt\.mjs$/.test(bin) && verb === 'guard' && Object.values(GUARD_EVENTS).includes(event)
}

/** @param {Record<string, any>} settings */
function checkShape(settings) {
  if (settings.hooks !== undefined && !isObject(settings.hooks)) {
    throw new KeypromptError('The settings file\'s "hooks" is not a JSON object, so keyprompt left the file alone.')
  }
  for (const event of Object.keys(GUARD_EVENTS)) {
    const groups = settings.hooks?.[event]
    if (groups !== undefined && !Array.isArray(groups)) {
      throw new KeypromptError(`The settings file's "hooks.${event}" is not a list, so keyprompt left the file alone.`)
    }
  }
}

/**
 * Remove the guard's handlers, and any matcher group, event list or `hooks`
 * object that only they kept alive. Nothing else changes.
 *
 * @param {Record<string, any>} settings
 * @returns {{ settings: Record<string, any>, removed: number }}
 */
export function removeGuard(settings) {
  checkShape(settings)
  const next = structuredClone(settings)
  let removed = 0
  if (!isObject(next.hooks)) return { settings: next, removed }
  for (const event of Object.keys(GUARD_EVENTS)) {
    const groups = next.hooks[event]
    if (!Array.isArray(groups)) continue
    const kept = []
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group)
        continue
      }
      const others = group.hooks.filter((handler) => !isGuardHandler(handler))
      removed += group.hooks.length - others.length
      if (others.length === group.hooks.length) kept.push(group)
      else if (others.length > 0) kept.push({ ...group, hooks: others })
    }
    if (kept.length > 0) next.hooks[event] = kept
    else if (groups.length > 0) delete next.hooks[event]
  }
  if (removed > 0 && Object.keys(next.hooks).length === 0) delete next.hooks
  return { settings: next, removed }
}

/**
 * Add the guard's entries after any earlier ones are removed, so a second run
 * replaces (for example with a new node path) instead of adding a copy.
 *
 * @param {Record<string, any>} settings
 * @param {ReturnType<typeof guardEntries>} entries
 */
export function addGuard(settings, entries) {
  const { settings: next } = removeGuard(settings)
  next.hooks ??= {}
  for (const [event, group] of Object.entries(entries)) {
    next.hooks[event] = [...(next.hooks[event] ?? []), group]
  }
  return next
}

/**
 * True when exactly these entries are already in place.
 *
 * @param {Record<string, any>} settings
 * @param {ReturnType<typeof guardEntries>} entries
 */
export function guardInstalled(settings, entries) {
  checkShape(settings)
  return Object.entries(entries).every(([event, expected]) => {
    /** @type {any[]} */
    const groups = (settings.hooks?.[event] ?? []).filter((/** @type {unknown} */ g) => isObject(g) && Array.isArray(g.hooks))
    const mine = groups.flatMap((g) => g.hooks.filter(isGuardHandler).map((/** @type {unknown} */ handler) => ({ matcher: g.matcher, handler })))
    return mine.length === 1 && mine[0].matcher === expected.matcher && JSON.stringify(mine[0].handler) === JSON.stringify(expected.hooks[0])
  })
}

/**
 * @param {string} path
 * @returns {Promise<Record<string, any>>} `{}` when the file does not exist or is empty
 */
export async function readSettings(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return {}
    throw error
  }
  if (text.trim() === '') return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new KeypromptError(`${path} is not valid JSON, so keyprompt left it alone. Fix it (Claude Code reports it as a Settings Error), then run this again.`)
  }
  if (!isObject(parsed)) throw new KeypromptError(`${path} does not hold a JSON object, so keyprompt left it alone.`)
  return parsed
}

/**
 * Write through a temporary file and a rename, so a crash never leaves half a
 * file. A symlinked settings file (a dotfiles setup) is written at its target,
 * so the link stays a link. The file keeps its permissions.
 *
 * @param {string} path
 * @param {Record<string, any>} settings
 */
export async function writeSettings(path, settings) {
  let target = path
  try {
    target = await realpath(path)
  } catch {
    // no file yet: create it at path
  }
  await mkdir(dirname(target), { recursive: true })
  /** @type {number | undefined} */
  let mode
  try {
    mode = (await stat(target)).mode & 0o777
  } catch {
    mode = undefined
  }
  const tmp = `${target}.keyprompt-${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`)
  if (mode !== undefined) await chmod(tmp, mode)
  await rename(tmp, target)
}
