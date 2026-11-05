import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openInBrowser } from './browser.mjs'
import { requestSecretWithCard } from './card-server.mjs'
import { readCatalog, recordRemoved, recordSavedMany } from './catalog.mjs'
import { EXIT, KeypromptError } from './errors.mjs'
import { assertName, parseFields, parseNames } from './names.mjs'
import { runWithSecrets } from './run.mjs'
import { assertFits, joinNames, saveAll } from './save.mjs'
import { getStore } from './store/index.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `keyprompt: give API keys to AI agents without pasting them into the chat.

Usage:
  keyprompt set NAME [--reason TEXT] [--by TEXT]
      Open a secure secret card in the browser. The person pastes the value;
      it is saved in the OS password store. Blocks until saved or cancelled.

  keyprompt run NAME[,NAME...] [--reason TEXT] [--by TEXT] [--no-redact] -- COMMAND [ARGS...]
      Run COMMAND with each secret in its environment as $NAME. A secret
      that is not saved yet opens the card first. Exact copies of the values
      are masked in COMMAND's output as [keyprompt:NAME].

  keyprompt has NAME        Exit 0 if NAME is saved, 3 if not. Never shows the value.
  keyprompt list            Saved names, reasons and dates. Never values.
  keyprompt delete NAME     Remove NAME from the password store.
  keyprompt install-skill   Teach Claude Code to use keyprompt (writes ~/.claude/skills/keyprompt).

There is deliberately no command that prints a secret.

Names look like environment variables: OPENAI_API_KEY, STRIPE_SECRET_KEY.
Options:
  --reason TEXT   Shown on the card: why the secret is needed.
  --by TEXT       Shown on the card: who is asking (default: detected agent and folder).
  --no-redact     Pass COMMAND's output through untouched (for full-screen tools).
`

/**
 * @param {string[]} argv
 * @returns {{ positionals: string[], command: string[], reason?: string, by?: string, redact: boolean, help: boolean, version: boolean }}
 */
export function parseArgs(argv) {
  const dash = argv.indexOf('--')
  const own = dash === -1 ? argv : argv.slice(0, dash)
  const command = dash === -1 ? [] : argv.slice(dash + 1)
  /** @type {ReturnType<typeof parseArgs>} */
  const parsed = { positionals: [], command, redact: true, help: false, version: false }
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
    else if (arg === '--no-redact') parsed.redact = false
    else if (arg === '--help' || arg === '-h') parsed.help = true
    else if (arg === '--version' || arg === '-v') parsed.version = true
    else if (arg.startsWith('--')) throw new KeypromptError(`Unknown option ${arg}. See keyprompt --help.`, { exitCode: EXIT.USAGE })
    else parsed.positionals.push(arg)
  }
  return parsed
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
 * @param {{ reason?: string, by?: string, replacing: boolean, allowSessionOnly: boolean }} options
 */
async function askWithCard(store, fields, options) {
  process.stderr.write(
    `keyprompt: opened a secure card in the browser for ${joinNames(fields.map((f) => f.name))}. Waiting for it to be filled in...\n`,
  )
  return requestSecretWithCard({
    fields,
    reason: options.reason,
    requester: requesterLabel(options.by),
    storeLabel: store.label,
    replacing: options.replacing,
    allowSessionOnly: options.allowSessionOnly,
    open: openInBrowser,
    onSubmit: async (values, remember) => {
      if (!remember) {
        assertFits(store, values)
        return
      }
      await saveAll(store, values)
      await recordSavedMany([...values.keys()], { reason: options.reason, store: store.id })
    },
  })
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
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const args = parseArgs(argv)
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

  if (verb === 'set') {
    const parsed = parseFields(rest)
    if (parsed.length === 0) throw new KeypromptError('Usage: keyprompt set NAME [NAME...] [--reason TEXT]', { exitCode: EXIT.USAGE })
    const store = getStore()
    /** @type {import('./card-server.mjs').CardField[]} */
    const fields = []
    for (const field of parsed) fields.push({ ...field, saved: (await store.read(field.name)) !== null })
    const { values } = await askWithCard(store, fields, {
      reason: args.reason,
      by: args.by,
      replacing: fields.every((f) => f.saved),
      allowSessionOnly: false,
    })
    process.stdout.write(setReport(fields, values, store.label))
    return EXIT.OK
  }

  if (verb === 'run') {
    const names = parseNames(rest)
    if (names.length === 0 || args.command.length === 0) {
      throw new KeypromptError('Usage: keyprompt run NAME[,NAME...] -- COMMAND [ARGS...]', { exitCode: EXIT.USAGE })
    }
    const store = getStore()
    /** @type {Map<string, string>} */
    const secrets = new Map()
    for (const name of names) {
      const saved = await store.read(name)
      if (saved !== null) {
        secrets.set(name, saved)
        continue
      }
      const { values, remembered } = await askWithCard(store, [{ name }], {
        reason: args.reason,
        by: args.by,
        replacing: false,
        allowSessionOnly: true,
      })
      process.stderr.write(`keyprompt: ${name} ${remembered ? `saved in the ${store.label}` : 'received for this run only'}.\n`)
      // One required field, so the card only submits when it is filled in.
      secrets.set(name, /** @type {string} */ (values.get(name)))
    }
    const [command, ...commandArgs] = args.command
    return runWithSecrets(command, commandArgs, secrets, { redact: args.redact })
  }

  if (verb === 'has') {
    if (rest.length !== 1) throw new KeypromptError('Usage: keyprompt has NAME', { exitCode: EXIT.USAGE })
    const name = assertName(rest[0])
    const store = getStore()
    if ((await store.read(name)) !== null) {
      process.stdout.write(`${name} is saved in the ${store.label}.\n`)
      return EXIT.OK
    }
    process.stdout.write(`${name} is not saved. Ask for it with: keyprompt set ${name} --reason "..."\n`)
    return EXIT.NOT_FOUND
  }

  if (verb === 'list') {
    const catalog = await readCatalog()
    const names = Object.keys(catalog).sort()
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
    const removed = await store.remove(name)
    await recordRemoved(name)
    process.stdout.write(removed ? `Deleted ${name} from the ${store.label}.\n` : `${name} was not saved.\n`)
    return removed ? EXIT.OK : EXIT.NOT_FOUND
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
