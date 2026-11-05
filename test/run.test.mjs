import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const HARNESS = fileURLToPath(new URL('../fixtures/run-harness.mjs', import.meta.url))

/** Run a Node snippet under runWithSecrets and capture what reaches the terminal. */
function runSnippet(secrets, code) {
  return spawnSync(process.execPath, [HARNESS, JSON.stringify(secrets), process.execPath, '-e', code], {
    encoding: 'utf8',
  })
}

test('the secret reaches the command as an environment variable', () => {
  const r = runSnippet({ MY_TOKEN: 'tok-123' }, 'process.exit(process.env.MY_TOKEN === "tok-123" ? 0 : 9)')
  assert.equal(r.status, 0)
})

test('the value is masked in stdout and stderr, even when written in pieces', () => {
  const r = runSnippet(
    { MY_TOKEN: 'tok-super-secret-42' },
    `const v = process.env.MY_TOKEN
     process.stdout.write('out ' + v.slice(0, 5))
     setTimeout(() => { process.stdout.write(v.slice(5) + ' end\\n'); console.error('err ' + v) }, 30)`,
  )
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'out [keyprompt:MY_TOKEN] end\n')
  assert.equal(r.stderr, 'err [keyprompt:MY_TOKEN]\n')
  assert.ok(!r.stdout.includes('tok-super-secret-42') && !r.stderr.includes('tok-super-secret-42'))
})

test("the command's exit code is passed through", () => {
  assert.equal(runSnippet({ K: 'v' }, 'process.exit(7)').status, 7)
})
