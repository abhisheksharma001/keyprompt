import { EXIT, KeypromptError } from './errors.mjs'

/** Environment-variable style, so a stored secret maps 1:1 onto the variable `run` sets. */
export const NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/

/**
 * @param {unknown} name
 * @returns {string}
 */
export function assertName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    const rule = 'Use an environment-variable style name: capital letters, digits and _, starting with a letter or _ (for example OPENAI_API_KEY).'
    // The JSON message leaves the typed name out: it could be a pasted key (B-19).
    throw new KeypromptError(`"${String(name)}" is not a valid secret name. ${rule}`, {
      exitCode: EXIT.USAGE,
      jsonMessage: `A name is not a valid secret name. ${rule}`,
    })
  }
  return name
}

/** Most values one card can ask for at once. */
const MAX_FIELDS = 12

const HINTS = ['visible', 'multiline', 'optional']

/**
 * Fields given as separate arguments and/or comma lists. Each item is a NAME
 * followed by zero or more `:hint`s (visible, multiline, optional). The same
 * name twice is one field and its hints are combined. Hints only change how
 * the card looks; they never change what is protected.
 * @param {string[]} parts
 * @returns {{ name: string, visible: boolean, multiline: boolean, optional: boolean }[]}
 */
export function parseFields(parts) {
  /** @type {{ name: string, visible: boolean, multiline: boolean, optional: boolean }[]} */
  const fields = []
  for (const part of parts) {
    for (const raw of part.split(',')) {
      const item = raw.trim()
      if (item.length === 0) continue
      const [rawName, ...hints] = item.split(':')
      const name = assertName(rawName)
      let field = fields.find((f) => f.name === name)
      if (field === undefined) {
        if (fields.length >= MAX_FIELDS) {
          throw new KeypromptError(`A card can ask for at most ${MAX_FIELDS} values at once.`, { exitCode: EXIT.USAGE })
        }
        field = { name, visible: false, multiline: false, optional: false }
        fields.push(field)
      }
      for (const hint of hints) {
        if (!HINTS.includes(hint)) {
          throw new KeypromptError(`Unknown hint "${hint}" on ${name}. Use visible, multiline or optional.`, {
            exitCode: EXIT.USAGE,
            jsonMessage: `Unknown hint on ${name}. Use visible, multiline or optional.`,
          })
        }
        field[/** @type {'visible' | 'multiline' | 'optional'} */ (hint)] = true
      }
    }
  }
  return fields
}

/**
 * Names given as separate arguments and/or comma lists, deduplicated in order.
 * @param {string[]} parts
 * @returns {string[]}
 */
export function parseNames(parts) {
  return parseFields(parts).map((f) => f.name)
}
