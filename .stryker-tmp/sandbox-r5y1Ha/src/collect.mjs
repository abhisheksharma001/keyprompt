/**
 * @typedef {import('./card-server.mjs').CardField} CardField
 * @typedef {(request: { fields: CardField[], allowSessionOnly: boolean }) => Promise<{ remembered: boolean, values: Map<string, string> }>} Ask
 */
// @ts-nocheck


/**
 * Every value `run` needs, in the order the fields were given. A saved name is
 * read from the store and never asked for again (a hint on it changes nothing).
 * The missing names go on one card, asked once. An optional name left empty is
 * simply absent from the result.
 *
 * This does not save anything: `ask` saves what the person chose to remember
 * while the card is still open, so a failed save shows on the card.
 *
 * @param {import('./store/index.mjs').SecretStore} store
 * @param {CardField[]} fields
 * @param {Ask} ask
 * @returns {Promise<Map<string, string>>}
 */
export async function collectSecrets(store, fields, ask) {
  /** @type {Map<string, string>} */
  const saved = new Map()
  /** @type {CardField[]} */
  const missing = []
  for (const field of fields) {
    const value = await store.read(field.name)
    if (value === null) missing.push(field)
    else saved.set(field.name, value)
  }

  /** @type {Map<string, string>} */
  const asked = missing.length > 0 ? (await ask({ fields: missing, allowSessionOnly: true })).values : new Map()

  /** @type {Map<string, string>} */
  const secrets = new Map()
  for (const { name } of fields) {
    const value = saved.get(name) ?? asked.get(name)
    if (value !== undefined) secrets.set(name, value)
  }
  return secrets
}
