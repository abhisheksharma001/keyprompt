import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { checkCommand, checkPrompt, preToolUse, splitShell, userPromptSubmit } from '../src/guard.mjs'

const BIN = fileURLToPath(new URL('../bin/keyprompt.mjs', import.meta.url))
const SAVED = ['OPENAI_API_KEY']

/**
 * A key-shaped string built at run time, so no key-shaped text sits in the repo.
 * @param {string[]} prefix pieces of the prefix
 * @param {number} length characters after the prefix
 */
function fake(prefix, length, alphabet = 'aB3dE5gH7jK9') {
  return prefix.join('') + alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length)
}

const REFUSED = [
  'security find-generic-password -s keyprompt -a OPENAI_API_KEY -w',
  'security find-generic-password -s keyprompt -a OPENAI_API_KEY -g',
  '/usr/bin/security find-generic-password -a OPENAI_API_KEY -w',
  'security find-generic-password -l "keyprompt: OPENAI_API_KEY" -w',
  'security find-generic-password -s keyprompt -wa OPENAI_API_KEY',
  'security dump-keychain -d login.keychain',
  'cd /tmp && security find-generic-password -s keyprompt -w',
  "bash -c 'security find-generic-password -s keyprompt -w'",
  "zsh -lc 'security find-generic-password -s keyprompt -w'",
  'sudo security find-generic-password -s keyprompt -w',
  'sudo -u root security find-generic-password -s keyprompt -w',
  'rtk security find-generic-password -s keyprompt -w',
  'env A=1 security find-generic-password -s keyprompt -w',
  'KEY=$(security find-generic-password -s keyprompt -a OPENAI_API_KEY -w) node app.js',
  'echo "$(security find-generic-password -s keyprompt -w)"',
  'echo `security find-generic-password -s keyprompt -w`',
  'eval "security find-generic-password -s keyprompt -w"',
  'keyprompt run OPENAI_API_KEY -- security find-generic-password -s keyprompt -w',
  'npx -y keyprompt run OPENAI_API_KEY -- security find-generic-password -s keyprompt -w',
  'secret-tool lookup service keyprompt account OPENAI_API_KEY',
  'secret-tool lookup account OPENAI_API_KEY',
  'secret-tool search --all service keyprompt',
  "(Get-StoredCredential -Target 'keyprompt:OPENAI_API_KEY').Password",
  '$c = Get-StoredCredential -Target keyprompt:OPENAI_API_KEY',
  'Get-StoredCredential -Target OPENAI_API_KEY | Select-Object -ExpandProperty Password',
  'pwsh -NoProfile -ExecutionPolicy Bypass -Command "Get-StoredCredential -Target keyprompt:OPENAI_API_KEY"',
  "Add-Type -TypeDefinition $src; [Cred]::CredRead('keyprompt:OPENAI_API_KEY', 1, 0, [ref]$p)",
]

const LET_THROUGH = [
  'git grep find-generic-password',
  `git grep -n -E "'(find|add|delete)-generic-password'|SERVICE" -- src/store/macos.mjs`,
  'git grep -n -E "CredRead|Advapi32|keyprompt:|DllImport" -- src/store/windows.mjs',
  'grep -rn "secret-tool lookup service keyprompt" docs/',
  'echo security find-generic-password -s keyprompt -w',
  'git commit -m "refuse security find-generic-password -s keyprompt -w"',
  '# security find-generic-password -s keyprompt -w',
  'security find-generic-password -s keyprompt -a OPENAI_API_KEY',
  'security find-generic-password -s github.com -w',
  'security find-generic-password -a SOME_OTHER_NAME -w',
  'security dump-keychain',
  'secret-tool store --label x service other account y',
  'keyprompt run OPENAI_API_KEY -- node app.js',
  'keyprompt has OPENAI_API_KEY',
  'keyprompt list',
  'cmdkey /list:keyprompt:OPENAI_API_KEY',
  "pwsh -NoProfile -Command \"Write-Output 'Get-StoredCredential'\"",
  'ls -la',
]

test('refuses each direct read of a keyprompt secret (G1)', () => {
  for (const command of REFUSED) {
    const found = checkCommand(command, SAVED)
    assert.ok(found, `should refuse: ${command}`)
    assert.match(found.reason, /keyprompt run NAME -- COMMAND/, command)
  }
})

test('lets through commands that only mention those words, or read nothing of keyprompt (G1b)', () => {
  for (const command of LET_THROUGH) {
    assert.equal(checkCommand(command, SAVED), null, `should let through: ${command}`)
  }
})

test('a saved name only counts when it is saved', () => {
  assert.equal(checkCommand('security find-generic-password -a OPENAI_API_KEY -w', []), null)
  assert.ok(checkCommand('security find-generic-password -a OPENAI_API_KEY -w', ['OPENAI_API_KEY']))
})

test('splitShell keeps quoted text whole and returns $( ) and backticks as scripts', () => {
  const { commands, nested } = splitShell(`echo 'a; b' "c | d" && x=$(inner one) y; z \`two\``)
  assert.deepEqual(commands, [['echo', 'a; b', 'c | d'], ['x=', 'y'], ['z']])
  assert.deepEqual(nested, ['inner one', 'two'])
})

test('preToolUse answers only for shell tools, with a deny the hooks reference describes (R-10)', () => {
  const command = 'security find-generic-password -s keyprompt -w'
  for (const tool of ['Bash', 'PowerShell', 'Monitor']) {
    assert.deepEqual(preToolUse({ tool_name: tool, tool_input: { command } }), {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: checkCommand(command)?.reason,
      },
    })
  }
  assert.equal(preToolUse({ tool_name: 'Read', tool_input: { command } }), null)
  assert.equal(preToolUse({ tool_name: 'Bash', tool_input: {} }), null)
  assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command: 'ls' } }), null)
})

const KEYS = [
  ['an Anthropic API key', fake(['sk', '-ant-', 'api03-'], 90)],
  ['an OpenAI API key', fake(['sk', '-proj-'], 120)],
  ['an OpenAI API key', fake(['sk', '-svcacct-'], 60)],
  ['a secret key that starts with sk-', fake(['sk', '-'], 48)],
  ['a GitHub token', fake(['gh', 'p_'], 36)],
  ['a GitHub token', fake(['github', '_pat_'], 82)],
  ['a Stripe live secret key', fake(['sk', '_live_'], 99)],
  ['a Stripe live secret key', fake(['rk', '_live_'], 99)],
  ['a Slack token', fake(['xo', 'xb-'], 50, '1234-abcd')],
  ['a private key', ['-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----'].join('')],
]

test('names the kind of each key format it knows (G2, R-12)', () => {
  for (const [kind, key] of KEYS) {
    assert.deepEqual(checkPrompt(`here it is: ${key} thanks`), [kind], kind)
  }
})

test('stays quiet on ordinary text, prefixes alone and public material (an easy system, not a noisy one)', () => {
  const quiet = [
    'Fix the login bug and run the tests.',
    'Anthropic keys start with sk-ant- and GitHub classic tokens with ghp_.',
    'use sk-learn for the model; see github_pat_ docs',
    'commit 69b09fb3c1e2d4f5a6b7c8d9e0f1a2b3c4d5e6f7 and id 123e4567-e89b-12d3-a456-426614174000',
    ['-----BEGIN ', 'PUBLIC KEY-----'].join(''),
    'pk_live_ is the publishable prefix',
  ]
  for (const text of quiet) assert.deepEqual(checkPrompt(text), [], text)
})

test('userPromptSubmit warns without repeating the key, and never blocks (D-12)', () => {
  const key = fake(['sk', '-ant-', 'api03-'], 90)
  const github = fake(['gh', 'p_'], 36)
  const output = userPromptSubmit({ prompt: `use ${key} and ${github}` })
  assert.ok(output)
  const text = JSON.stringify(output)
  assert.ok(!text.includes(key) && !text.includes(github), 'the output must not contain the key')
  assert.ok(!text.includes(key.slice(0, 20)), 'nor the start of it')
  assert.equal(/** @type {any} */ (output).decision, undefined)
  assert.match(/** @type {any} */ (output).systemMessage, /this message looks like it contains an Anthropic API key and a GitHub token/)
  assert.equal(/** @type {any} */ (output).hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  assert.doesNotMatch(text, /you pasted/i)
  assert.equal(userPromptSubmit({ prompt: 'hello' }), null)
  assert.equal(userPromptSubmit({}), null)
})

/**
 * @param {string[]} args
 * @param {string} input
 */
function guard(args, input) {
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-guard-'))
  writeFileSync(join(home, 'catalog.json'), JSON.stringify({ MY_SAVED_NAME: { store: 'test', updatedAt: '2026-11-07T00:00:00.000Z' } }))
  return spawnSync(process.execPath, [BIN, 'guard', ...args], { input, encoding: 'utf8', env: { ...process.env, KEYPROMPT_HOME: home } })
}

test('keyprompt guard pre-tool-use prints a deny for a direct read, using the saved names in the catalog', () => {
  const result = guard(['pre-tool-use'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'security find-generic-password -a MY_SAVED_NAME -w' } }))
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /keyprompt run/)
})

test('keyprompt guard pre-tool-use prints nothing for an ordinary command', () => {
  const result = guard(['pre-tool-use'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git grep find-generic-password' } }))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
})

test('keyprompt guard user-prompt-submit warns without the key', () => {
  const key = fake(['sk', '-proj-'], 120)
  const result = guard(['user-prompt-submit'], JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: `key: ${key}` }))
  assert.equal(result.status, 0, result.stderr)
  assert.match(JSON.parse(result.stdout).systemMessage, /an OpenAI API key/)
  assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key))
})

test('keyprompt guard never exits 2, which Claude Code would read as "block", and never echoes its input', () => {
  const key = fake(['sk', '-ant-', 'api03-'], 90)
  const bad = guard(['user-prompt-submit'], `not json ${key}`)
  assert.equal(bad.status, 1)
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /expected a Claude Code hook's JSON object/)
  assert.ok(!bad.stderr.includes(key))
  assert.equal(guard(['something-else'], '{}').status, 1)
  assert.equal(guard([], '{}').status, 1)
})
