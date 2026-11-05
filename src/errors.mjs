/** Exit codes the CLI uses. `run` exits with the child's own code instead. */
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
   * @param {{ exitCode?: number }} [options]
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'KeypromptError'
    this.exitCode = options.exitCode ?? EXIT.ERROR
  }
}
