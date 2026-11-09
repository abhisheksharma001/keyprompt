import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { activityEntry, activityPath, activityReport, readActivity, recordActivity, SHOWN_ENTRIES } from './activity.mjs'
import { openInBrowser } from './browser.mjs'
import { CardWithdrawnError, requestSecretWithCard } from './card-server.mjs'
import { catalogPath, readCatalog, recordRemoved, recordSavedMany } from './catalog.mjs'
import { collectSecrets } from './collect.mjs'
import { EXIT, KeypromptError } from './errors.mjs'
import { preToolUse, userPromptSubmit } from './guard.mjs'
import {
  addGuard,
  guardEntries,
  guardInstalled,
  nodeCommand,
  readSettings,
  removeGuard,
  runsFromNpxCache,
  settingsPath,
  writeSettings,
} from './install-guard.mjs'
import { serveMcp } from './mcp.mjs'
import { assertName, MAX_FIELDS, parseFields, parseNames } from './names.mjs'
import { runWithSecrets } from './run.mjs'
import { assertFits, joinNames, saveAll } from './save.mjs'
import { readExampleNames, setupReport } from './setup.mjs'
import { getStore } from './store/index.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `keyprompt: give API keys to AI agents without pasting them into the chat.

Usage:
  keyprompt set FIELD [FIELD...] [--reason TEXT] [--by TEXT]
      Open one secure card in the browser for all the FIELDs. The person
      pastes the values; they are saved in the OS password store. Blocks until
      the card is saved, cancelled or put off with Later.

  keyprompt run FIELD[,FIELD...] [--reason TEXT] [--by TEXT] [--no-redact] -- COMMAND [ARGS...]
      Run COMMAND with each secret in its environment as $NAME. Secrets that
      are not saved yet open one card first. Exact copies of the values are
      masked in COMMAND's output as [keyprompt:NAME].

  keyprompt setup [--from FILE] [--reason TEXT] [--by TEXT]
      Read the names a project needs from its .env.example (or FILE) and open
      one card for the ones not saved yet. Every box may stay empty, but Save
      needs at least one value. Only the names are used; values in the file are
      ignored. One card asks for at most 12: the first ones missing, in the
      file's order.

  keyprompt has NAME        Exit 0 if NAME is saved, 3 if not. Never shows the value.
  keyprompt list            Saved names, reasons and dates. Never values.
  keyprompt delete NAME     Remove NAME from the password store.
  keyprompt log             The newest 50 lines of the activity log: when each name was
                            saved, given to which program, deleted or put off. Never values.
  keyprompt mcp             An MCP server on stdin and stdout, for MCP clients: tools to ask for
                            secrets on a card and to check which are saved. Never returns a value.
  keyprompt demo            Open a sample card to see how it looks. Nothing you type is saved.
  keyprompt install-skill   Teach Claude Code to use keyprompt (writes ~/.claude/skills/keyprompt).
  keyprompt install-guard [--yes]
                            Add keyprompt's guard to Claude Code's settings. Shows the
                            entries first and asks; --yes skips the question.
  keyprompt uninstall-guard Remove the guard again. Works only in your own terminal.
  keyprompt guard EVENT     Run by Claude Code hooks (EVENT is pre-tool-use or user-prompt-submit).
                            Reads the hook's JSON on stdin; never reads a saved value.

There is deliberately no command that prints a secret.

Names look like environment variables: OPENAI_API_KEY, STRIPE_SECRET_KEY.

A FIELD is a NAME, then any hints, each after a colon:
  :visible     Show what is typed, for an ID that is not secret.
  :multiline   A paste box that keeps line breaks (a PEM key, a JSON key file).
  :optional    May stay empty. With run, every box may stay empty when all are
               optional; the command then gets no value for them from keyprompt.
               set still needs at least one value.
Hints only change how a box looks on the card. Every value is still saved the
same way and masked in COMMAND's output. At most 12 FIELDs per card.
Example: keyprompt set TWILIO_ACCOUNT_SID:visible TWILIO_AUTH_TOKEN

Exit codes:
  0 ok                       4 the person cancelled the card, or said no
  1 failed (message shown)   5 nobody filled it in within 5 minutes
  2 bad usage                6 the person chose Later; nothing was saved
  3 not saved (has, delete)
  run exits with COMMAND's own code once COMMAND has started.

Options:
  --json          One names-only JSON result for set, has, list, delete, setup or log.
                  Failures are JSON too, with keyprompt's message; existing exit
                  codes stay the same.
  --reason TEXT   Shown on the card: why the secret is needed.
  --by TEXT       Shown on the card: who is asking (default: detected agent and folder).
  --from FILE     For setup: the example file to read instead of .env.example. Its
                  name must say it is one (example, sample, template, schema or
                  dist); .env and .env.local are refused.
  --no-redact     Pass COMMAND's output through untouched (for full-screen tools).
                  Works only when the output goes straight to a terminal.
`

/**
 * What install-guard is about to add, shown before it asks.
 *
 * @param {string} path
 * @param {ReturnType<typeof guardEntries>} entries
 */
export function installGuardPlan(path, entries) {
  const shown = JSON.stringify({ hooks: { PreToolUse: [entries.PreToolUse], UserPromptSubmit: [entries.UserPromptSubmit] } }, null, 2)
  return [
    `keyprompt install-guard adds these hook entries to ${path}:`,
    '',
    shown,
    '',
    'Before each Bash or PowerShell command, Claude Code runs the guard, which refuses the obvious direct reads of keyprompt secrets from the OS password store.',
    'Before each message, the guard warns when the message looks like it contains a key; it never blocks a message.',
    'The guard fails open: if it cannot run, Claude Code lets the command through and shows a hook error.',
    'Every other setting in the file stays as it is.',
    '',
  ].join('\n')
}

/**
 * Ask a yes/no question on the terminal. Anything but y or yes is no,
 * including Ctrl+D and Ctrl+C.
 *
 * @param {string} question
 */
async function confirm(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  // Closing the prompt alone leaves the question pending and the process would end with exit 0.
  const cancel = new AbortController()
  prompt.on('SIGINT', () => cancel.abort())
  prompt.on('close', () => cancel.abort())
  try {
    return /^y(es)?$/i.test((await prompt.question(question, { signal: cancel.signal })).trim())
  } catch {
    process.stdout.write('\n')
    return false
  } finally {
    prompt.close()
  }
}

const GUARD_EVENTS = new Set(['pre-tool-use', 'user-prompt-submit'])
/** A hook's JSON carries the whole command or message; anything larger is not a hook's input. */
const MAX_HOOK_INPUT = 8 * 1024 * 1024

/**
 * @param {NodeJS.ReadableStream} stream
 * @param {number} limit bytes
 * @returns {Promise<string>}
 */
export async function readStdin(stream, limit) {
  /** @type {Buffer[]} */
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new KeypromptError(`the guard got more than ${limit} bytes on stdin, which is not a hook's input.`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * The error never quotes the input: it can hold a command or a message with a key in it.
 *
 * @param {string} text
 * @returns {object}
 */
export function parseHookInput(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new KeypromptError("the guard expected a Claude Code hook's JSON object on stdin.")
  }
  return parsed
}

/**
 * Saved names (never values) for the guard. A catalog that cannot be read
 * leaves only the `keyprompt` service and label to match on.
 *
 * @returns {Promise<string[]>}
 */
async function savedNames() {
  try {
    return Object.keys(await readCatalog())
  } catch {
    return []
  }
}

/**
 * @param {string[]} argv
 * @returns {{ positionals: string[], command: string[], reason?: string, by?: string, from?: string, redact: boolean, yes: boolean, help: boolean, version: boolean, json: boolean }}
 */
export function parseArgs(argv) {
  const dash = argv.indexOf('--')
  const own = dash === -1 ? argv : argv.slice(0, dash)
  const command = dash === -1 ? [] : argv.slice(dash + 1)
  /** @type {ReturnType<typeof parseArgs>} */
  const parsed = { positionals: [], command, redact: true, yes: false, help: false, version: false, json: false }
  for (let i = 0; i < own.length; i++) {
    const arg = own[i]
    const takeValue = () => {
      const value = own[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new KeypromptError(`${arg} needs a value.`, { exitCode: EXIT.USAGE })
      }
      i++
      return value
    }
    if (arg === '--reason') parsed.reason = takeValue()
    else if (arg === '--by') parsed.by = takeValue()
    else if (arg === '--from') parsed.from = takeValue()
    else if (arg === '--no-redact') parsed.redact = false
    else if (arg === '--yes') parsed.yes = true
    else if (arg === '--json') parsed.json = true
    else if (arg === '--help' || arg === '-h') parsed.help = true
    else if (arg === '--version' || arg === '-v') parsed.version = true
    else if (arg.startsWith('--')) {
      throw new KeypromptError(`Unknown option ${arg}. See keyprompt --help.`, { exitCode: EXIT.USAGE, jsonMessage: 'Unknown option. See keyprompt --help.' })
    }
    else parsed.positionals.push(arg)
  }
  return parsed
}

const JSON_COMMANDS = new Set(['set', 'has', 'list', 'delete', 'setup', 'log'])

/**
 * Recognize output mode even when argument parsing fails. Option values and
 * the child's arguments cannot select it. Never reflect an unknown verb.
 * @param {string[]} argv
 */
function jsonRequest(argv) {
  let json = false
  let command = null
  let foundVerb = false
  for (let i = 0; i < argv.length && argv[i] !== '--'; i++) {
    const arg = argv[i]
    if (arg === '--reason' || arg === '--by' || arg === '--from') {
      if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++
    } else if (arg === '--json') json = true
    else if (!arg.startsWith('-') && !foundVerb) {
      foundVerb = true
      if (JSON_COMMANDS.has(arg)) command = arg
    }
  }
  return { json, command }
}

/** The message of a `--json` failure that keyprompt did not expect: its own text could carry anything. */
export const UNEXPECTED_JSON_MESSAGE =
  'keyprompt hit an unexpected error. Its text is left out of JSON results; run the same command without --json to see it.'

/**
 * Only validated names, an allowlisted outcome and keyprompt's own words reach
 * the JSON error. The message is the error's `jsonMessage`: the text-mode
 * sentence with any typed argument or helper output left out (B-19).
 * @param {string | null} command
 * @param {string[]} names
 * @param {unknown} error
 */
function jsonFailure(command, names, error) {
  const known = error instanceof KeypromptError
  const code = known ? error.exitCode : EXIT.ERROR
  const statuses = { 1: 'error', 2: 'invalid_usage', 3: 'missing', 4: 'cancelled', 5: 'timed_out', 6: 'deferred' }
  const exitCode = Object.hasOwn(statuses, code) ? code : EXIT.ERROR
  return { command, status: statuses[exitCode], names, exitCode, message: known ? error.jsonMessage : UNEXPECTED_JSON_MESSAGE }
}

/**
 * JSON with DEL, C1, format and separator characters written as `\u` escapes,
 * so a folder name in `log --json` cannot drive a terminal that shows it.
 * JSON already escapes C0; the parsed value is the same.
 * @param {object} result
 */
function writeJson(result) {
  const safe = JSON.stringify(result).replace(/[\u007f-\u009f\p{Cf}\u2028\u2029]/gu, (found) =>
    [...found].flatMap((c) => Array.from({ length: c.length }, (_, i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`)).join(''),
  )
  process.stdout.write(`${safe}\n`)
}

/**
 * `run --no-redact` hands COMMAND keyprompt's own stdout and stderr untouched.
 * That is for a full-screen program a person watches, so both must be a
 * terminal. Output going into a pipe or a file (an agent's shell tool, a log)
 * stays masked (B-11). Nothing may skip this check: anything that could, an
 * agent could set.
 * @param {{ isTTY?: boolean }} stdout
 * @param {{ isTTY?: boolean }} stderr
 */
export function outputIsTerminal(stdout, stderr) {
  return stdout.isTTY === true && stderr.isTTY === true
}

/**
 * A value this short ("test", "1234") turns up in ordinary command text by
 * chance, so refusing on it would be wrong more often than right. Counted in
 * characters (code points), as in src/redact.mjs.
 */
const MIN_PASTED_LENGTH = 8

/**
 * The names whose value is spelled out inside one of the command's own words.
 * A command written that way has put the value in the agent's transcript and
 * on the process list, which is what `run` is for avoiding (S-19). Only the
 * exact value is looked for; an encoded copy of it is not.
 * @param {Map<string, string>} secrets
 * @param {string[]} command The program and its arguments, as given after `--`.
 * @returns {string[]} Names only, in the order `run` was given them.
 */
export function secretsInCommand(secrets, command) {
  /** @type {string[]} */
  const found = []
  for (const [name, value] of secrets) {
    if ([...value].length < MIN_PASTED_LENGTH) continue
    if (command.some((word) => word.includes(value))) found.push(name)
  }
  return found
}

/**
 * What `run` tells the agent when it refuses because a value is in the command.
 * Names only, never the value or any part of it. Says "value", not "saved
 * value": one the person gave for this run only is refused the same way.
 * @param {string[]} names
 */
export function valueInCommandError(names) {
  const one = names.length === 1
  const what = one ? `The value of ${names[0]} appears` : `The values of ${joinNames(names)} appear`
  const how = one ? `the command gets it in its environment as $${names[0]}` : 'the command gets each one in its environment under its own name'
  return new KeypromptError(`${what} in the command itself, so keyprompt did not start it. Leave ${one ? 'it' : 'them'} out: ${how} (see keyprompt --help).`, {
    exitCode: EXIT.USAGE,
  })
}

/** Who is asking, for the card. Only a label; nothing trusts it. */
function requesterLabel(/** @type {string | undefined} */ by) {
  if (by) return by
  const agent = process.env.CLAUDECODE === '1' ? 'Claude Code' : 'a command'
  return `${agent} in ${basename(process.cwd()) || process.cwd()}`
}

/**
 * Ask for these fields on one card. With Remember (always, for `set`) the
 * filled-in values are saved all or none before the card reports success, so
 * a failed save shows on the card. `remember: false` hands them to this run only.
 * @param {import('./store/index.mjs').SecretStore} store
 * @param {import('./card-server.mjs').CardField[]} fields
 * @param {{ command: 'set' | 'setup' | 'run' | 'mcp', reason?: string, by?: string, replacing: boolean, allowSessionOnly: boolean, masked?: boolean, allowEmpty?: boolean, warnings?: string[], signal?: AbortSignal, onClosed?: () => void }} options
 *   `onClosed` runs the moment the card stops taking saves, before anything is logged.
 */
async function askWithCard(store, fields, options) {
  // Every caller checks this first; a card with no boxes would say things that are not true (B-20).
  if (fields.length === 0) throw new KeypromptError('keyprompt was asked to open a card with no boxes, so it did not.')
  // Withdrawn before any card opened: nothing to say and nothing to log.
  if (options.signal?.aborted) throw new CardWithdrawnError()
  const names = fields.map((f) => f.name)
  process.stderr.write(`keyprompt: opened a secure card in the browser for ${joinNames(names)}. Waiting for it to be filled in...\n`)
  /** @type {Awaited<ReturnType<typeof openCard>>} */
  let answer
  try {
    answer = await openCard(store, fields, options)
  } catch (error) {
    options.onClosed?.()
    // A cancel by the MCP client is not the person's Cancel: the log says who ended the card (B-21).
    const closed = error instanceof CardWithdrawnError ? 'withdrawn' : error instanceof KeypromptError ? CARD_CLOSED[error.exitCode] : undefined
    if (closed) await recordActivity(activityEntry({ event: closed, command: options.command, names, exitCode: error.exitCode }))
    throw error
  }
  options.onClosed?.()
  const saved = names.filter((name) => answer.values.has(name))
  if (answer.remembered && saved.length > 0) {
    await recordActivity(activityEntry({ event: 'saved', command: options.command, names: saved, exitCode: EXIT.OK }))
  }
  return answer
}

/** The activity-log event for a card that ended without a save (S-43). */
const CARD_CLOSED = /** @type {Record<number, import('./activity.mjs').ActivityEvent>} */ ({
  [EXIT.CANCELLED]: 'cancelled',
  [EXIT.TIMED_OUT]: 'timed_out',
  [EXIT.DEFERRED]: 'deferred',
})

/**
 * @param {import('./store/index.mjs').SecretStore} store
 * @param {import('./card-server.mjs').CardField[]} fields
 * @param {Parameters<typeof askWithCard>[2]} options
 */
function openCard(store, fields, options) {
  return requestSecretWithCard({
    fields,
    reason: options.reason,
    requester: requesterLabel(options.by),
    storeLabel: store.label,
    replacing: options.replacing,
    allowSessionOnly: options.allowSessionOnly,
    masked: options.masked,
    allowEmpty: options.allowEmpty,
    signal: options.signal,
    open: openInBrowser,
    onSubmit: async (values, remember) => {
      if (!remember) {
        assertFits(store, values)
        return
      }
      const note = await saveAndRecord(store, values, options.reason)
      if (note) {
        if (options.warnings) options.warnings.push('catalog_not_updated')
        else process.stderr.write(note)
      }
    },
  })
}

/**
 * What the card's Save does with Remember on: every value goes to the store
 * (all or none), then the names go on the list `keyprompt list` shows. Once the
 * store write is done the values are saved, so a failure of the list (a full
 * disk, a folder that cannot be written, a catalog.json that is not JSON) must
 * not fail the save: the card would say "Could not save" about values that are
 * saved, and the agent would be told they were not (B-3). It returns a line
 * for the agent instead.
 * @param {import('./store/index.mjs').SecretStore} store
 * @param {Map<string, string>} values
 * @param {string | undefined} reason
 * @returns {Promise<string | undefined>} A line for stderr when the list could not be updated.
 */
export async function saveAndRecord(store, values, reason) {
  await saveAll(store, values)
  const names = [...values.keys()]
  try {
    await recordSavedMany(names, { reason, store: store.id })
  } catch (error) {
    return catalogNotUpdated(names, store.label, error)
  }
  return undefined
}

/**
 * The stderr line for values that are saved while the list of names is not
 * updated. Only the error's code (ENOSPC, EACCES) is repeated, never its text,
 * which could carry anything.
 * @param {string[]} names
 * @param {string} storeLabel
 * @param {unknown} error
 */
export function catalogNotUpdated(names, storeLabel, error) {
  const them = names.length === 1 ? 'it' : 'them'
  return (
    `keyprompt: Saved ${joinNames(names)} in the ${storeLabel}, but could not update the list of names${plainCode(error)}, so "keyprompt list" may not show ${them}. ` +
    `The save itself worked. The list is ${catalogPath()}.\n`
  )
}

/**
 * What `delete` does: take the value out of the store, then the name off the
 * list `keyprompt list` shows. Once the store has answered, the value is gone
 * (or was never there), so a failure of the list must not turn that into an
 * error: the agent would be told a delete failed that worked (B-13). A failure
 * of the store itself still throws, and then the list is not touched.
 * @param {import('./store/index.mjs').SecretStore} store
 * @param {string} name
 * @returns {Promise<{ removed: boolean, note: string | undefined }>} `note` is a line for stderr when the list could not be updated.
 */
export async function removeAndRecord(store, name) {
  const removed = await store.remove(name)
  try {
    await recordRemoved(name)
  } catch (error) {
    return { removed, note: catalogNotUpdatedAfterDelete(name, error) }
  }
  return { removed, note: undefined }
}

/**
 * The stderr line for a delete whose list of names could not be updated. It
 * says nothing about the value: stdout and the exit code already do, and the
 * name may never have been saved. Only a plain error code is repeated.
 * @param {string} name
 * @param {unknown} error
 */
export function catalogNotUpdatedAfterDelete(name, error) {
  return `keyprompt: Could not update the list of names${plainCode(error)}, so "keyprompt list" may still show ${name}. The list is ${catalogPath()}.\n`
}

/**
 * ` (ENOSPC)` for an error that has a plain code, otherwise nothing. The
 * error's text is never repeated: it could carry anything.
 * @param {unknown} error
 */
function plainCode(error) {
  const found = error instanceof Error ? /** @type {NodeJS.ErrnoException} */ (error).code : undefined
  return typeof found === 'string' && /^[A-Z0-9_]{1,20}$/.test(found) ? ` (${found})` : ''
}

/**
 * What `set` tells the agent: names only, never values.
 * @param {import('./card-server.mjs').CardField[]} fields
 * @param {Map<string, string>} values The filled-in values, all saved.
 * @param {string} storeLabel
 */
export function setReport(fields, values, storeLabel) {
  const saved = fields.filter((f) => values.has(f.name)).map((f) => f.name)
  const replaced = fields.filter((f) => f.saved && values.has(f.name)).map((f) => f.name)
  const empty = fields.filter((f) => !values.has(f.name)).map((f) => f.name)
  const one = saved.length === 1
  const what =
    replaced.length === saved.length
      ? `Replaced ${joinNames(saved)} in the ${storeLabel}.`
      : `Saved ${joinNames(saved)} in the ${storeLabel}${replaced.length > 0 ? ` (replaced ${joinNames(replaced)})` : ''}.`
  const lines = [`${what} ${one ? 'The value was' : 'The values were'} not shown here.`]
  if (empty.length > 0) {
    lines.push(`Left empty: ${joinNames(empty)}. Nothing was changed for ${empty.length === 1 ? 'it' : 'them'}.`)
  }
  lines.push(`Use ${one ? 'it' : 'them'} with: keyprompt run ${saved.join(',')} -- <command>`)
  return `${lines.join('\n')}\n`
}

/**
 * What `run` tells the agent when the person chose Later: the command was not
 * started, and the agent should carry on without these names for now. Only the
 * command's name is shown, never its arguments.
 * @param {import('./card-server.mjs').CardField[]} fields The names on the card.
 * @param {string} command
 */
export function laterForRun(fields, command) {
  const one = fields.length === 1
  return new KeypromptError(
    `The person chose Later for ${joinNames(fields.map((f) => f.name))}. Nothing was saved and ${command} did not run. ` +
      `Carry on with work that does not need ${one ? 'it' : 'these'}; ask again only when you are about to use ${one ? 'it' : 'them'}.`,
    { exitCode: EXIT.DEFERRED },
  )
}

/**
 * What `run` tells the agent once its card was saved: the names that came from
 * it and where they went, or, when every box was left empty, that the command
 * gets no value for them from keyprompt (B-4). Names only, never values. It
 * does not say "not set": the command still gets the agent's own environment.
 * @param {import('./card-server.mjs').CardField[]} fields The names on the card.
 * @param {{ remembered: boolean, values: Map<string, string> }} answer
 * @param {string} storeLabel
 */
export function runCardLine(fields, answer, storeLabel) {
  const given = fields.filter((f) => answer.values.has(f.name)).map((f) => f.name)
  if (given.length === 0) {
    const one = fields.length === 1
    return `keyprompt: ${joinNames(fields.map((f) => f.name))} ${one ? 'was' : 'were'} left empty on the card, so keyprompt gives the command no value for ${one ? 'it' : 'them'}.\n`
  }
  return `keyprompt: ${joinNames(given)} ${answer.remembered ? `saved in the ${storeLabel}` : 'received for this run only'}.\n`
}

/**
 * The card `keyprompt demo` opens: sample boxes and no store. Its submit keeps
 * nothing, and the page says it is a demo. The `demo` command never calls
 * `getStore()` or the catalog.
 * @returns {Omit<import('./card-server.mjs').CardRequest, 'open'>}
 */
export function demoRequest() {
  return {
    fields: parseFields(['DEMO_API_KEY', 'DEMO_ACCOUNT_ID:visible', 'DEMO_PRIVATE_KEY:multiline:optional']),
    reason: 'A demo of the keyprompt card. Nothing you type here is saved.',
    requester: 'keyprompt demo',
    storeLabel: 'nowhere (demo)',
    replacing: false,
    allowSessionOnly: false,
    demo: true,
    onSubmit: async () => {},
  }
}

/**
 * What `set` does, shared with the `request_secret` MCP tool: read which
 * fields are saved, then ask for all of them on one card.
 * @param {ReturnType<typeof parseFields>} parsed
 * @param {{ command: 'set' | 'mcp', reason?: string, by?: string, warnings?: string[], signal?: AbortSignal, onClosed?: () => void }} options
 */
async function askToSet(parsed, options) {
  const store = getStore()
  /** @type {import('./card-server.mjs').CardField[]} */
  const fields = []
  for (const field of parsed) fields.push({ ...field, saved: (await store.read(field.name)) !== null })
  const { values } = await askWithCard(store, fields, {
    command: options.command,
    reason: options.reason,
    by: options.by,
    replacing: fields.every((f) => f.saved),
    allowSessionOnly: false,
    warnings: options.warnings,
    signal: options.signal,
    onClosed: options.onClosed,
  })
  return { store, fields, values }
}

/**
 * The names-only result of a save, as `set --json` prints it.
 * @param {import('./card-server.mjs').CardField[]} fields
 * @param {Map<string, string>} values
 * @param {string[]} warnings
 */
function setResult(fields, values, warnings) {
  return {
    command: 'set',
    status: 'saved',
    names: fields.filter((f) => values.has(f.name)).map((f) => f.name),
    exitCode: EXIT.OK,
    replaced: fields.filter((f) => f.saved && values.has(f.name)).map((f) => f.name),
    empty: fields.filter((f) => !values.has(f.name)).map((f) => f.name),
    warnings,
  }
}

/** A list of 1 to 12 strings from an MCP tool's arguments, or a usage error that does not repeat them. */
function toolList(/** @type {unknown} */ args, /** @type {string} */ key) {
  const list = args && typeof args === 'object' ? /** @type {Record<string, unknown>} */ (args)[key] : undefined
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_FIELDS || !list.every((item) => typeof item === 'string')) {
    throw new KeypromptError(`${key} must be a list of 1 to ${MAX_FIELDS} names.`, { exitCode: EXIT.USAGE })
  }
  return /** @type {string[]} */ (list)
}

/**
 * The fields or names an MCP tool was given, parsed. A list that parses to
 * nothing (`[" "]`, `[","]`) is refused here, before anything else is
 * checked or opened (B-20). The message never repeats the list.
 * @template T
 * @param {unknown} args
 * @param {string} key
 * @param {(parts: string[]) => T[]} parse
 * @returns {T[]}
 */
function toolNames(args, key, parse) {
  const parsed = parse(toolList(args, key))
  if (parsed.length === 0) throw new KeypromptError(`${key} must name at least one secret, for example ["OPENAI_API_KEY"].`, { exitCode: EXIT.USAGE })
  return parsed
}

/** The card's "who is asking" for an MCP client: its own name, as the agent's words. */
function mcpRequester(/** @type {import('./mcp.mjs').ClientInfo} */ client) {
  const name = client.title || client.name
  return name ? `${name.slice(0, 60)} (MCP) in ${basename(process.cwd()) || process.cwd()}` : undefined
}

/**
 * The two tools `keyprompt mcp` offers. Both answer with keyprompt's names-only
 * JSON results; neither ever returns a value. Only one card is open at a time.
 * @returns {import('./mcp.mjs').Tools}
 */
export function mcpTools() {
  /** The call whose card is open, or null. A token, so a cancelled call never frees a later call's card. */
  let cardOwner = /** @type {object | null} */ (null)
  /**
   * @param {string} command
   * @param {string[]} names
   * @param {unknown} error
   */
  const failed = (command, names, error) => {
    const result = jsonFailure(command, names, error)
    // Cancel, a timeout and Later are answers from the person, not errors.
    return { result, isError: ![EXIT.CANCELLED, EXIT.TIMED_OUT, EXIT.DEFERRED].includes(result.exitCode) }
  }
  return {
    async request_secret(args, client, signal) {
      /** @type {string[]} */
      let names = []
      try {
        const parsed = toolNames(args, 'fields', parseFields)
        names = parsed.map((f) => f.name)
        const reason = args && typeof args === 'object' ? /** @type {Record<string, unknown>} */ (args).reason : undefined
        if (reason !== undefined && typeof reason !== 'string') throw new KeypromptError('reason must be text.', { exitCode: EXIT.USAGE })
        if (cardOwner !== null) throw new KeypromptError('A card is already open. Wait for its answer before asking again.', { exitCode: EXIT.USAGE })
        const owner = {}
        cardOwner = owner
        // Freed the moment the card stops taking saves (after a save under way, on a cancel), not after the log is written, so the next call may open its own card (B-21).
        const release = () => {
          if (cardOwner === owner) cardOwner = null
        }
        try {
          const warnings = []
          const { fields, values } = await askToSet(parsed, { command: 'mcp', reason, by: mcpRequester(client), warnings, signal, onClosed: release })
          return { result: setResult(fields, values, warnings), isError: false }
        } finally {
          release()
        }
      } catch (error) {
        return failed('set', names, error)
      }
    },
    async check_secrets(args) {
      /** @type {string[]} */
      let names = []
      try {
        names = toolNames(args, 'names', parseNames)
        const store = getStore()
        /** @type {string[]} */
        const saved = []
        /** @type {string[]} */
        const missing = []
        for (const name of names) ((await store.read(name)) === null ? missing : saved).push(name)
        return { result: { command: 'has', status: missing.length === 0 ? 'saved' : 'missing', names, exitCode: missing.length === 0 ? EXIT.OK : EXIT.NOT_FOUND, saved, missing }, isError: false }
      } catch (error) {
        return failed('has', names, error)
      }
    },
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const request = jsonRequest(argv)
  /** The names a JSON failure reports: validated ones only. setup fills them in once its card opens. */
  const failure = { names: /** @type {string[]} */ ([]) }
  try {
    const args = parseArgs(argv)
    if (request.json && !request.command) {
      throw new KeypromptError('--json works only with set, has, list, delete, setup and log.', { exitCode: EXIT.USAGE })
    }
    if (args.json && args.command.length > 0) throw new KeypromptError('These JSON commands do not take a child command.', { exitCode: EXIT.USAGE })
    // Invalid names never get reflected in an error result.
    if (request.json && !['list', 'setup', 'log'].includes(request.command)) failure.names = parseFields(args.positionals.slice(1)).map((f) => f.name)
    return await mainParsed(args, failure)
  } catch (error) {
    if (!request.json) throw error
    const result = jsonFailure(request.command, failure.names, error)
    writeJson(result)
    return result.exitCode
  }
}

/**
 * @param {ReturnType<typeof parseArgs>} args
 * @param {{ names: string[] }} failure
 */
async function mainParsed(args, failure) {
  const [verb, ...rest] = args.positionals

  if (args.version) {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
    process.stdout.write(`${pkg.version}\n`)
    return EXIT.OK
  }
  if (args.help || verb === undefined || verb === 'help') {
    process.stdout.write(HELP)
    return verb === undefined && !args.help ? EXIT.USAGE : EXIT.OK
  }

  if (args.yes && verb !== 'install-guard') {
    throw new KeypromptError('--yes works only with install-guard.', { exitCode: EXIT.USAGE })
  }
  if (args.from !== undefined && verb !== 'setup') {
    throw new KeypromptError('--from works only with setup.', { exitCode: EXIT.USAGE })
  }

  if (verb === 'set') {
    const parsed = parseFields(rest)
    if (parsed.length === 0) throw new KeypromptError('Usage: keyprompt set NAME [NAME...] [--reason TEXT]', { exitCode: EXIT.USAGE })
    const warnings = []
    const { store, fields, values } = await askToSet(parsed, { command: 'set', reason: args.reason, by: args.by, warnings: args.json ? warnings : undefined })
    if (args.json) writeJson(setResult(fields, values, warnings))
    else process.stdout.write(setReport(fields, values, store.label))
    return EXIT.OK
  }

  if (verb === 'mcp') {
    if (rest.length > 0 || args.command.length > 0 || args.reason !== undefined || args.by !== undefined) {
      throw new KeypromptError('Usage: keyprompt mcp (an MCP client starts it and talks to it on stdin and stdout)', { exitCode: EXIT.USAGE })
    }
    if (process.stdin.isTTY) {
      process.stderr.write("keyprompt: keyprompt mcp speaks MCP on stdin and stdout. Add it to your agent's MCP servers instead of running it here (Ctrl+C to stop).\n")
    }
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
    await serveMcp({ input: process.stdin, output: process.stdout, version: pkg.version, tools: mcpTools() })
    return EXIT.OK
  }

  if (verb === 'setup') {
    if (rest.length > 0 || args.command.length > 0) {
      throw new KeypromptError('Usage: keyprompt setup [--from FILE] [--reason TEXT] [--by TEXT]', { exitCode: EXIT.USAGE })
    }
    const { names, ignoredLines } = await readExampleNames(args.from)
    const store = getStore()
    /** @type {string[]} */
    const skipped = []
    /** @type {string[]} */
    const missing = []
    for (const name of names) ((await store.read(name)) === null ? missing : skipped).push(name)
    /** @type {import('./card-server.mjs').CardField[]} */
    const fields = missing.slice(0, MAX_FIELDS).map((name) => ({ name, visible: false, multiline: false, optional: true, saved: false }))
    const remaining = missing.slice(MAX_FIELDS)
    /** @type {string[]} */
    const warnings = []
    /** @type {Map<string, string>} */
    let values = new Map()
    if (fields.length > 0) {
      failure.names = fields.map((f) => f.name)
      ;({ values } = await askWithCard(store, fields, {
        command: 'setup',
        reason: args.reason,
        by: args.by,
        replacing: false,
        allowSessionOnly: false,
        warnings: args.json ? warnings : undefined,
      }))
    }
    if (args.json) {
      writeJson({
        command: verb,
        status: 'saved',
        names: fields.filter((f) => values.has(f.name)).map((f) => f.name),
        exitCode: EXIT.OK,
        replaced: [],
        empty: fields.filter((f) => !values.has(f.name)).map((f) => f.name),
        warnings,
        skipped,
        remaining,
        ignoredLines,
      })
    } else process.stdout.write(setupReport({ names, fields, values, skipped, remaining, ignoredLines, storeLabel: store.label }))
    return EXIT.OK
  }

  if (verb === 'run') {
    const fields = parseFields(rest)
    if (fields.length === 0 || args.command.length === 0) {
      throw new KeypromptError('Usage: keyprompt run NAME[,NAME...] -- COMMAND [ARGS...]', { exitCode: EXIT.USAGE })
    }
    // Before the store is read or a card opens, so a refused run touches nothing.
    if (!args.redact && !outputIsTerminal(process.stdout, process.stderr)) {
      throw new KeypromptError(
        "--no-redact works only when keyprompt's output goes straight to a terminal, and here it does not. Run the command again without --no-redact; masking stays on.",
        { exitCode: EXIT.USAGE },
      )
    }
    const store = getStore()
    const [command, ...commandArgs] = args.command
    const secrets = await collectSecrets(store, fields, async ({ fields: missing, allowSessionOnly }) => {
      // allowEmpty: when every missing name is optional, Save with every box empty carries on to the command without them (B-4).
      const options = { command: /** @type {const} */ ('run'), reason: args.reason, by: args.by, replacing: false, allowSessionOnly, masked: args.redact, allowEmpty: true }
      const asked = await askWithCard(store, missing, options).catch((error) => {
        if (error instanceof KeypromptError && error.exitCode === EXIT.DEFERRED) throw laterForRun(missing, command)
        throw error
      })
      process.stderr.write(runCardLine(missing, asked, store.label))
      return asked
    })
    // After the values are known and before the command starts, so a refused run starts nothing.
    const inCommand = secretsInCommand(secrets, args.command)
    if (inCommand.length > 0) throw valueInCommandError(inCommand)
    const started = new Date()
    const exitCode = await runWithSecrets(command, commandArgs, secrets, { redact: args.redact })
    // Written once the command has ended, so it carries the exit code; the time is when the names were handed over.
    if (secrets.size > 0) {
      await recordActivity(activityEntry({ event: 'run', command: 'run', names: [...secrets.keys()], exitCode, program: command, time: started }))
    }
    return exitCode
  }

  if (verb === 'demo') {
    if (rest.length > 0 || args.command.length > 0) throw new KeypromptError('Usage: keyprompt demo', { exitCode: EXIT.USAGE })
    process.stderr.write('keyprompt: opened the demo card in the browser. Nothing you type there is saved. Waiting for you to press Save, Later or Cancel...\n')
    try {
      await requestSecretWithCard({ ...demoRequest(), open: openInBrowser })
    } catch (error) {
      // Cancel and Later are ways to finish a demo, not failures. A timeout or a browser that would not open still is.
      const finished = error instanceof KeypromptError && (error.exitCode === EXIT.CANCELLED || error.exitCode === EXIT.DEFERRED)
      if (!finished) throw error
    }
    process.stdout.write('Demo finished. Nothing was saved.\n')
    return EXIT.OK
  }

  if (verb === 'has') {
    if (rest.length !== 1) throw new KeypromptError('Usage: keyprompt has NAME', { exitCode: EXIT.USAGE })
    const name = assertName(rest[0])
    const store = getStore()
    if ((await store.read(name)) !== null) {
      if (args.json) writeJson({ command: verb, status: 'saved', names: [name], exitCode: EXIT.OK })
      else process.stdout.write(`${name} is saved in the ${store.label}.\n`)
      return EXIT.OK
    }
    if (args.json) writeJson({ command: verb, status: 'missing', names: [name], exitCode: EXIT.NOT_FOUND })
    else process.stdout.write(`${name} is not saved. Ask for it with: keyprompt set ${name} --reason "..."\n`)
    return EXIT.NOT_FOUND
  }

  if (verb === 'list') {
    if (args.json && (rest.length > 0 || args.command.length > 0)) throw new KeypromptError('Usage: keyprompt list --json', { exitCode: EXIT.USAGE })
    const catalog = await readCatalog()
    const names = Object.keys(catalog).sort()
    if (args.json) {
      try {
        names.forEach(assertName)
      } catch {
        throw new KeypromptError('The catalog contains an invalid name.')
      }
      writeJson({ command: verb, status: 'listed', names, exitCode: EXIT.OK })
      return EXIT.OK
    }
    if (names.length === 0) {
      process.stdout.write('No secrets saved with keyprompt yet.\n')
      return EXIT.OK
    }
    for (const name of names) {
      const entry = catalog[name]
      const reason = entry.reason ? `  ${entry.reason}` : ''
      process.stdout.write(`${name}  (saved ${entry.updatedAt.slice(0, 10)})${reason}\n`)
    }
    return EXIT.OK
  }

  if (verb === 'delete') {
    if (rest.length !== 1) throw new KeypromptError('Usage: keyprompt delete NAME', { exitCode: EXIT.USAGE })
    const name = assertName(rest[0])
    const store = getStore()
    const { removed, note } = await removeAndRecord(store, name)
    if (removed) await recordActivity(activityEntry({ event: 'deleted', command: 'delete', names: [name], exitCode: EXIT.OK }))
    if (args.json) writeJson({
      command: verb,
      status: removed ? 'deleted' : 'missing',
      names: [name],
      exitCode: removed ? EXIT.OK : EXIT.NOT_FOUND,
      warnings: note ? ['catalog_not_updated'] : [],
    })
    else {
      if (note) process.stderr.write(note)
      process.stdout.write(removed ? `Deleted ${name} from the ${store.label}.\n` : `${name} was not saved.\n`)
    }
    return removed ? EXIT.OK : EXIT.NOT_FOUND
  }

  if (verb === 'log') {
    if (rest.length > 0 || args.command.length > 0) throw new KeypromptError('Usage: keyprompt log [--json]', { exitCode: EXIT.USAGE })
    const entries = await readActivity()
    const shown = entries.slice(-SHOWN_ENTRIES)
    if (args.json) {
      writeJson({ command: verb, status: 'listed', names: [...new Set(shown.flatMap((e) => e.names))], exitCode: EXIT.OK, entries: shown })
    } else process.stdout.write(activityReport(shown, entries.length, activityPath()))
    return EXIT.OK
  }

  if (verb === 'guard') {
    // Claude Code treats exit 2 from a hook as "block", so the guard's own errors exit 1:
    // Claude Code shows a hook error and lets the call through (R-10).
    const event = rest[0]
    if (rest.length !== 1 || !GUARD_EVENTS.has(event)) {
      throw new KeypromptError('Usage: keyprompt guard pre-tool-use|user-prompt-submit (Claude Code runs it with the hook\'s JSON on stdin).', { exitCode: EXIT.ERROR })
    }
    if (process.stdin.isTTY) {
      throw new KeypromptError("the guard reads a Claude Code hook's JSON on stdin; it is not meant to be typed.", { exitCode: EXIT.ERROR })
    }
    const input = parseHookInput(await readStdin(process.stdin, MAX_HOOK_INPUT))
    const output = event === 'pre-tool-use' ? preToolUse(input, await savedNames()) : userPromptSubmit(input)
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`)
    return EXIT.OK
  }

  if (verb === 'install-guard') {
    if (rest.length > 0 || args.command.length > 0) throw new KeypromptError('Usage: keyprompt install-guard [--yes]', { exitCode: EXIT.USAGE })
    if (runsFromNpxCache(ROOT)) {
      throw new KeypromptError(
        "install-guard is running from npx's temporary folder, which npm can delete at any time; the guard would then stop working. Install keyprompt first (npm install -g keyprompt), then run: keyprompt install-guard",
        { exitCode: EXIT.USAGE },
      )
    }
    const path = settingsPath()
    const settings = await readSettings(path)
    const entries = guardEntries(nodeCommand(), join(ROOT, 'bin', 'keyprompt.mjs'))
    if (guardInstalled(settings, entries)) {
      process.stdout.write(`The keyprompt guard is already installed in ${path}. Nothing changed.\n`)
      return EXIT.OK
    }
    const next = addGuard(settings, entries)
    process.stdout.write(installGuardPlan(path, entries))
    if (!args.yes) {
      if (!process.stdin.isTTY) {
        throw new KeypromptError(
          "install-guard asks before it changes Claude Code's settings, and it cannot ask here (no terminal). Run it in your own terminal, or add --yes.",
          { exitCode: EXIT.USAGE },
        )
      }
      if (!(await confirm('Add them? [y/N] '))) {
        process.stdout.write('Nothing changed.\n')
        return EXIT.CANCELLED
      }
    }
    await writeSettings(path, next)
    process.stdout.write(
      `Installed in ${path}. Claude Code reloads its settings when they change, so open sessions pick this up too.\nRemove it with: keyprompt uninstall-guard\n`,
    )
    return EXIT.OK
  }

  if (verb === 'uninstall-guard') {
    if (rest.length > 0 || args.command.length > 0) throw new KeypromptError('Usage: keyprompt uninstall-guard', { exitCode: EXIT.USAGE })
    const path = settingsPath()
    const { settings: next, removed } = removeGuard(await readSettings(path))
    if (removed === 0) {
      process.stdout.write(`The keyprompt guard is not installed in ${path}. Nothing changed.\n`)
      return EXIT.OK
    }
    // Only a person at a terminal can switch the guard off (D-15); an agent's command has no terminal.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new KeypromptError('uninstall-guard works only in your own terminal, so an agent cannot switch the guard off. Run it there.', {
        exitCode: EXIT.USAGE,
      })
    }
    process.stdout.write(`This removes keyprompt's guard from ${path}. Every other setting stays as it is.\n`)
    if (!(await confirm('Remove it? [y/N] '))) {
      process.stdout.write('Nothing changed.\n')
      return EXIT.CANCELLED
    }
    await writeSettings(path, next)
    process.stdout.write(`Removed from ${path}.\n`)
    return EXIT.OK
  }

  if (verb === 'install-skill') {
    const target = join(homedir(), '.claude', 'skills', 'keyprompt')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), await readFile(join(ROOT, 'skill', 'SKILL.md'), 'utf8'))
    process.stdout.write(
      `Installed the Claude Code skill at ${join(target, 'SKILL.md')}.\nFor Codex, Cursor and other agents, add the "For AGENTS.md" block from the README to your AGENTS.md.\n`,
    )
    return EXIT.OK
  }

  throw new KeypromptError(`Unknown command "${verb}". See keyprompt --help.`, { exitCode: EXIT.USAGE })
}
