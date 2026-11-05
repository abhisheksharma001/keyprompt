import crossSpawn from 'cross-spawn'
import { constants } from 'node:os'
import { createRedactor } from './redact.mjs'

/**
 * Run a command with secrets added to its environment, passing stdin through
 * and redacting the secrets' exact values from its stdout and stderr.
 * Resolves with the exit code keyprompt should exit with: the child's own,
 * or 128 + signal number when the child was killed by a signal.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {Map<string, string>} secrets name -> value
 * @param {{ redact?: boolean }} [options]
 * @returns {Promise<number>}
 */
export function runWithSecrets(command, args, secrets, options = {}) {
  const redact = options.redact !== false
  const env = { ...process.env, ...Object.fromEntries(secrets) }

  return new Promise((resolve, reject) => {
    const child = crossSpawn(command, args, {
      env,
      stdio: redact ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    })

    const forward = (/** @type {NodeJS.Signals} */ signal) => () => {
      if (child.exitCode === null) child.kill(signal)
    }
    const handlers = /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP']).map((signal) => {
      const handler = forward(signal)
      process.on(signal, handler)
      return [signal, handler]
    })
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler)
    }

    /** @type {Promise<void>[]} */
    const drained = []
    if (redact) {
      for (const [source, target] of /** @type {const} */ ([
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ])) {
        const redactor = createRedactor(secrets)
        drained.push(
          new Promise((done) => {
            source.on('data', (chunk) => target.write(redactor.push(chunk)))
            source.on('end', () => {
              target.write(redactor.flush())
              done()
            })
          }),
        )
      }
    }

    child.on('error', (error) => {
      cleanup()
      reject(error)
    })
    child.on('close', async (code, signal) => {
      await Promise.all(drained)
      cleanup()
      if (signal) resolve(128 + (constants.signals[signal] ?? 1))
      else resolve(code ?? 1)
    })
  })
}
