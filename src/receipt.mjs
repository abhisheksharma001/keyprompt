/**
 * What the done screen says about each box. `{store}` is the store label.
 * A test compares these with the PRD, word for word.
 */
export const RECEIPT_WORDS = {
  saved: 'Saved in your {store}',
  handed: 'Handed to this one command, not saved',
  kept: 'Kept the saved value',
  empty: 'Left empty',
  later: 'Not saved (Later)',
}

/** Shown under the receipt of a `run` card, where the values go to a command. */
export const MASKING_NOTE =
  "keyprompt masks exact copies in that command's output. It cannot stop a command from sending the key elsewhere — see SECURITY.md."

/**
 * Where each box's value went, by name and outcome. Names and outcomes only:
 * a value never appears here.
 * @param {import('./card-server.mjs').CardField[]} fields
 * @param {Map<string, string>} values The non-empty values the card accepted.
 * @param {boolean} remember Saved to the store (true) or handed to one command (false).
 * @returns {{ name: string, outcome: keyof typeof RECEIPT_WORDS }[]}
 */
export function receiptFor(fields, values, remember) {
  return fields.map(({ name, saved }) => ({
    name,
    outcome: values.has(name) ? (remember ? 'saved' : 'handed') : saved ? 'kept' : 'empty',
  }))
}
