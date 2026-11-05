import { KeypromptError } from './errors.mjs'

/** @typedef {import('./store/index.mjs').SecretStore} SecretStore */

/**
 * "A", "A and B", "A, B and C".
 * @param {string[]} names
 */
export function joinNames(names) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Refuse any value the store cannot hold, before anything is written.
 * @param {SecretStore} store
 * @param {Map<string, string>} values
 */
export function assertFits(store, values) {
  for (const [name, value] of values) {
    if (value.length > store.maxValueLength) {
      throw new KeypromptError(
        `${name} is ${value.length} characters; the ${store.label} holds at most ${store.maxValueLength}. Nothing was changed.`,
      )
    }
  }
}

/**
 * Only messages written for people are shown; anything else could carry
 * text nobody checked, so it is not repeated.
 * @param {unknown} error
 */
function reasonOf(error) {
  return error instanceof KeypromptError ? error.message.replace(/\.$/, '') : 'an unexpected error'
}

/**
 * Put every touched name back as it was: the old value written back, or the
 * item removed if there was none. Newest first. Returns the names that could
 * not be put back, in their original order.
 * @param {SecretStore} store
 * @param {{ name: string, old: string | null }[]} touched
 */
async function putBack(store, touched) {
  /** @type {string[]} */
  const stuck = []
  for (const { name, old } of [...touched].reverse()) {
    try {
      if (old === null) await store.remove(name)
      else await store.write(name, old)
    } catch {
      stuck.unshift(name)
    }
  }
  return stuck
}

/**
 * Save every value, or none of them. Before each write the old value is read.
 * If a read or write fails, every name touched so far is put back, the
 * failing one included: a write can fail after it changed the item (the
 * macOS store checks the value it reads back), so "Nothing was changed" is
 * only said once that name has been put back too.
 * @param {SecretStore} store
 * @param {Map<string, string>} values
 */
export async function saveAll(store, values) {
  assertFits(store, values)
  /** @type {{ name: string, old: string | null }[]} */
  const touched = []
  for (const [name, value] of values) {
    try {
      const old = await store.read(name)
      touched.push({ name, old })
      await store.write(name, value)
    } catch (error) {
      const stuck = await putBack(store, touched)
      const failed = `Could not save ${name}: ${reasonOf(error)}.`
      if (stuck.length === 0) throw new KeypromptError(`${failed} Nothing was changed.`)
      const one = stuck.length === 1
      throw new KeypromptError(
        `${failed} Undoing also failed for ${joinNames(stuck)}, so ${one ? 'it' : 'they'} may not hold what ${one ? 'it' : 'they'} held before. To fix ${one ? 'it' : 'them'}, run: keyprompt set ${stuck.join(' ')}`,
      )
    }
  }
}
