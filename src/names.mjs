import { EXIT, KeypromptError } from './errors.mjs'

/** Environment-variable style, so a stored secret maps 1:1 onto the variable `run` sets. */
export const NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/

/**
 * @param {unknown} name
 * @returns {string}
 */
export function assertName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new KeypromptError(
      `"${String(name)}" is not a valid secret name. Use an environment-variable style name: capital letters, digits and _, starting with a letter or _ (for example OPENAI_API_KEY).`,
      { exitCode: EXIT.USAGE },
    )
  }
  return name
}

/**
 * Names given as separate arguments and/or comma lists, deduplicated in order.
 * @param {string[]} parts
 * @returns {string[]}
 */
export function parseNames(parts) {
  const names = []
  for (const part of parts) {
    for (const raw of part.split(',')) {
      const name = raw.trim()
      if (name.length === 0) continue
      assertName(name)
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}
