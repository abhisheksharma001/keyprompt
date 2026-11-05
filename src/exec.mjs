import { spawn } from 'node:child_process'

/**
 * Run a helper program with optional stdin, capturing its output. Secrets only
 * ever travel through `input` (stdin) and `stdout`, never through arguments,
 * so they never show up in a process list.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ input?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ code: number | null, stdout: Buffer, stderr: Buffer }>}
 */
export function runHelper(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
    child.stdin.on('error', () => {
      // The helper may exit before reading stdin; its exit code reports the failure.
    })
    child.stdin.end(options.input ?? '')
  })
}
