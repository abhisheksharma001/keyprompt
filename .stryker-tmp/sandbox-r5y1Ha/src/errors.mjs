/** Exit codes the CLI uses. `run` exits with the child's own code instead. */
// @ts-nocheck

export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  CANCELLED: 4,
  TIMED_OUT: 5,
  DEFERRED: 6,
}

/** An expected failure with a message written for the person (or agent) reading it. */
export class KeypromptError extends Error {
  /**
   * @param {string} message
   * @param {{ exitCode?: number, jsonMessage?: string }} [options] `jsonMessage` is the
   *   message with anything keyprompt did not write itself left out (a typed argument, a
   *   helper's output), for `--json` results (B-19). It defaults to the message.
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'KeypromptError'
    this.exitCode = options.exitCode ?? EXIT.ERROR
    this.jsonMessage = options.jsonMessage ?? message
  }
}

/**
 * A password-store helper failed. Text mode adds the first line of what the
 * helper printed; the `--json` message leaves it out, because keyprompt did
 * not write it.
 * @param {string} text keyprompt's own words, without a final full stop.
 * @param {Buffer | string} stderr What the helper printed.
 */
export function helperError(text, stderr) {
  const line = stderr.toString('utf8').trim().split('\n')[0] ?? ''
  return new KeypromptError(line.length > 0 ? `${text}: ${line}` : text, { jsonMessage: `${text}.` })
}
