// @ts-nocheck
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { EXIT, KeypromptError } from './errors.mjs'
import { MAX_FIELDS, NAME_PATTERN } from './names.mjs'
import { joinNames } from './save.mjs'

/** The file `setup` reads when no `--from` is given. */
export const DEFAULT_EXAMPLE = '.env.example'

/** An example file is a list of names; one this large is not. */
const MAX_EXAMPLE_BYTES = 1024 * 1024

/** Words in a file's name that say it is a template rather than a file of real values. */
const TEMPLATE_WORDS = new Set(['example', 'sample', 'template', 'schema', 'dist'])

/**
 * setup reads names only from a template, never from a file that may hold
 * real values (`.env`, `.env.local`), so the file's own name must say it is
 * one. Checked before the file is opened. The message never repeats the path:
 * it was typed by the agent.
 * @param {string} path
 */
export function assertTemplateName(path) {
  const words = basename(path).toLowerCase().split(/[._-]/)
  if (!words.some((word) => TEMPLATE_WORDS.has(word))) {
    throw new KeypromptError(
      'setup reads names only from an example file, never from a file that may hold real values such as .env or .env.local. ' +
        "The file's name must contain example, sample, template, schema or dist (for example .env.example).",
      { exitCode: EXIT.USAGE },
    )
  }
}

/**
 * Does `text` contain `quote` that is not escaped with a backslash?
 * @param {string} text
 * @param {string} quote
 */
function closes(text, quote) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === quote) return true
  }
  return false
}

/**
 * The names an example file lists, in order, each once. Only the text before
 * `=` is kept; values and comments are never returned. A value that opens a
 * quote and runs over several lines is passed over to its closing quote, so
 * none of its lines is taken for a name. A line that is not a `NAME=...` line
 * with a keyprompt name is reported by its number, never by its text.
 * @param {string} text
 * @returns {{ names: string[], ignoredLines: number[] }}
 */
export function exampleNames(text) {
  /** @type {string[]} */
  const names = []
  /** @type {number[]} */
  const ignoredLines = []
  /** @type {string | null} The quote a value that spans lines is waiting for. */
  let open = null
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (open !== null) {
      if (closes(lines[i], open)) open = null
      continue
    }
    const line = lines[i].trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([^=\s]+)\s*=(.*)$/.exec(line)
    if (match === null) {
      ignoredLines.push(i + 1)
      continue
    }
    const [, name, rest] = match
    const value = rest.trimStart()
    const quote = value[0]
    if ((quote === '"' || quote === "'" || quote === '`') && !closes(value.slice(1), quote)) open = quote
    if (!NAME_PATTERN.test(name)) ignoredLines.push(i + 1)
    else if (!names.includes(name)) names.push(name)
  }
  return { names, ignoredLines }
}

/**
 * The names in the example file `from` names, or in `.env.example` here.
 * @param {string | undefined} from
 */
export async function readExampleNames(from) {
  const path = from ?? DEFAULT_EXAMPLE
  assertTemplateName(path)
  const where = from === undefined ? `${DEFAULT_EXAMPLE} in this folder` : 'the file given with --from'
  /** @type {string} */
  let text
  try {
    if ((await stat(path)).size > MAX_EXAMPLE_BYTES) {
      throw new KeypromptError(`The example file is larger than 1 MB, so it is not a list of names. setup read nothing from it.`, { exitCode: EXIT.USAGE })
    }
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof KeypromptError) throw error
    const code = /** @type {NodeJS.ErrnoException} */ (error).code
    if (code === 'ENOENT') {
      const missing = from === undefined ? `There is no ${DEFAULT_EXAMPLE} in this folder.` : 'There is no file at the path given with --from.'
      throw new KeypromptError(`${missing} Run keyprompt setup in the project's folder, or name its example file with --from FILE.`, {
        exitCode: EXIT.USAGE,
      })
    }
    throw new KeypromptError(`Could not read ${where}${typeof code === 'string' && /^[A-Z]{1,20}$/.test(code) ? ` (${code})` : ''}.`)
  }
  const found = exampleNames(text)
  if (found.names.length === 0) {
    throw new KeypromptError(`The example file lists no names keyprompt can save (lines like OPENAI_API_KEY=, with capital letters, digits and _).`, {
      exitCode: EXIT.USAGE,
    })
  }
  return found
}

/**
 * What setup tells the agent and the person: names and line numbers only,
 * never a value.
 * @param {{
 *   names: string[],
 *   fields: { name: string }[],
 *   values: Map<string, string>,
 *   skipped: string[],
 *   remaining: string[],
 *   ignoredLines: number[],
 *   storeLabel: string,
 * }} result `names` is every name in the file, in order; `fields` the names on the card.
 */
export function setupReport({ names, fields, values, skipped, remaining, ignoredLines, storeLabel }) {
  const lines = []
  const saved = fields.filter((f) => values.has(f.name)).map((f) => f.name)
  const empty = fields.filter((f) => !values.has(f.name)).map((f) => f.name)
  if (fields.length === 0) lines.push('Nothing to ask: every name in the example file is saved already.')
  if (saved.length > 0) {
    lines.push(`Saved ${joinNames(saved)} in the ${storeLabel}. ${saved.length === 1 ? 'The value was' : 'The values were'} not shown here.`)
  }
  if (empty.length > 0) lines.push(`Left empty, so still not saved: ${joinNames(empty)}.`)
  if (skipped.length > 0) lines.push(`Already saved, so not asked: ${joinNames(skipped)}.`)
  if (remaining.length > 0) {
    lines.push(
      `Not asked yet, because one card holds at most ${MAX_FIELDS}: ${joinNames(remaining)}. ` +
        `Run keyprompt setup again: it asks for the first ${MAX_FIELDS} names still missing, in the file's order.`,
    )
  }
  if (ignoredLines.length > 0) {
    const one = ignoredLines.length === 1
    lines.push(
      `${one ? 'Line' : 'Lines'} ${joinNames(ignoredLines.map(String))} of the example file ${one ? 'was' : 'were'} not read: ` +
        'keyprompt reads lines like NAME=..., where NAME uses capital letters, digits and _.',
    )
  }
  const ready = names.filter((name) => skipped.includes(name) || values.has(name))
  if (ready.length > 0) lines.push(`Use ${ready.length === 1 ? 'it' : 'them'} with: keyprompt run ${ready.join(',')} -- <command>`)
  return `${lines.join('\n')}\n`
}
