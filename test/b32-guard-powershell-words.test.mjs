import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCommand, splitShell } from '../src/guard.mjs'

// B-32 items 6 and 16 (docs/bugs.md), step S-69: read as PowerShell, `-Name:value` and `$x=Cmdlet` are split into the words PowerShell
// sees. Every command below is only ever passed to checkCommand or splitShell as a string; none is run, and none runs a store read.

const SAVED = ['OPENAI_API_KEY']

/** @param {string} command @param {'bash' | 'powershell' | undefined} [shell] */
function denied(command, shell) {
  const found = checkCommand(command, SAVED, shell)
  assert.ok(found, `should refuse (${shell ?? 'both ways'}): ${command}`)
  assert.match(found.reason, /keyprompt guard: this command (reads a secret|prints every secret)/, command)
}

/** @param {string} command @param {'bash' | 'powershell' | undefined} [shell] */
function allowed(command, shell) {
  assert.equal(checkCommand(command, SAVED, shell), null, `should let through (${shell ?? 'both ways'}): ${command}`)
}

/** @param {string} text @returns {string[][]} the split copy of a one-command text read as PowerShell: the last command splitShell returns (the first is the command as Bash reads it) */
const ps = (text) => [splitShell(text, true).commands.at(-1)]

// --- Item 6: a colon-bound parameter ---------------------------------------------------------------------

test('a colon-bound parameter value is read as the word PowerShell sees (item 6)', () => {
  for (const text of [
    'Get-StoredCredential -Target:keyprompt:X',
    'Get-StoredCredential -Target:OPENAI_API_KEY',
    "Get-StoredCredential -Target:'keyprompt:X'",
    'Get-StoredCredential -Target:"keyprompt:X"',
    'Get-StoredCredential -Target:KeyPrompt:X',
    'Get-StoredCredential -Target:keyprompt',
    'get-storedcredential -a -Target:keyprompt:X -b',
    '& Get-StoredCredential -Target:keyprompt:X',
    'pwsh -c "Get-StoredCredential -Target:keyprompt:X"',
    'pwsh -Command Get-StoredCredential -Target:keyprompt:X',
    'echo ok; Get-StoredCredential -Target:keyprompt:X',
    'Get-StoredCredential -Target:keyprompt:X | Out-String',
  ]) {
    denied(text, 'powershell')
    denied(text)
  }
})

test('the colon stays where PowerShell puts it: only a word that starts with a hyphen is split, and only at its first colon', () => {
  assert.deepEqual(ps('Get-StoredCredential -Target:keyprompt:X'), [['Get-StoredCredential', '-Target', 'keyprompt:X']])
  assert.deepEqual(ps('cmd -a:b:c:d'), [['cmd', '-a', 'b:c:d']])
  // Quoted or not, the word PowerShell sees is the same (splitting a quoted word can only add a refusal).
  assert.deepEqual(ps("cmd '-a:b'"), [['cmd', '-a', 'b']])
  assert.deepEqual(ps('cmd "-a:b"'), [['cmd', '-a', 'b']])
  assert.deepEqual(ps('cmd -a:"b c"'), [['cmd', '-a', 'b c']])
  assert.deepEqual(ps('cmd "-a:b c"'), [['cmd', '-a', 'b c']])
  // Nothing after the colon: the parameter name only.
  assert.deepEqual(ps('cmd -a:'), [['cmd', '-a']])
  // Not split: no hyphen first, no colon, or a hyphen alone.
  assert.deepEqual(ps('cmd a:b -ab - -- keyprompt:X'), [['cmd', 'a:b', '-ab', '-', '--', 'keyprompt:X']])
  assert.deepEqual(ps('Get-Date -Format yyyy:MM'), [['Get-Date', '-Format', 'yyyy:MM']])
})

test('a service name in mixed case with its colon is still refused: the word as Bash reads it is kept (found by the differential run)', () => {
  for (const text of ['security find-generic-password -w -sKeyPrompt:X', 'security find-generic-password -wsKEYPROMPT:x']) {
    denied(text, 'powershell')
    denied(text)
    denied(text, 'bash')
  }
  // A colon-bound option is a PowerShell reading only; Bash keeps the whole word, as before.
  denied('security find-generic-password -g -s:keyprompt:X', 'powershell')
  denied('security find-generic-password -g -s:keyprompt:X')
})

test('a command with a word that splits is returned twice: as Bash reads it, then split (nothing main read is read any less)', () => {
  assert.deepEqual(splitShell('$c=Get-X y; z', true).commands, [['$c=Get-X', 'y'], ['$c', '=', 'Get-X', 'y'], ['z']])
  assert.deepEqual(splitShell('a -b:c d', true).commands, [['a', '-b:c', 'd'], ['a', '-b', 'c', 'd']])
  // Only the commands with a word that splits are returned twice; the words before it are in both.
  assert.deepEqual(splitShell('a b -c:d; e f', true).commands, [['a', 'b', '-c:d'], ['a', 'b', '-c', 'd'], ['e', 'f']])
  assert.deepEqual(splitShell('a b c', true).commands, [['a', 'b', 'c']])
  assert.deepEqual(splitShell('$c=Get-X y; z').commands, [['$c=Get-X', 'y'], ['z']])
})

// --- Item 16: an assignment glued to the cmdlet ----------------------------------------------------------

test('a variable assignment glued to the cmdlet starts the command at the cmdlet (item 16)', () => {
  for (const op of ['=', '+=', '-=', '*=', '/=', '%=', '??=']) {
    for (const text of [
      `$c${op}Get-StoredCredential -Target keyprompt:X`,
      `$c${op}Get-StoredCredential -Target OPENAI_API_KEY`,
      `$env:C${op}Get-StoredCredential -Target keyprompt:X`,
      `echo ok; $c${op}Get-StoredCredential -Target keyprompt:X`,
      `$c${op}Get-StoredCredential -Target:keyprompt:X`,
      `pwsh -c '$c${op}Get-StoredCredential -Target keyprompt:X'`,
    ]) {
      denied(text, 'powershell')
      denied(text)
    }
  }
})

test('an assignment is split into the name, a plain =, and the rest (item 16)', () => {
  assert.deepEqual(ps('$c=Get-StoredCredential -Target keyprompt:X'), [['$c', '=', 'Get-StoredCredential', '-Target', 'keyprompt:X']])
  assert.deepEqual(ps('$c+=Get-X y'), [['$c', '=', 'Get-X', 'y']])
  assert.deepEqual(ps('$c-=Get-X'), [['$c', '=', 'Get-X']])
  assert.deepEqual(ps('$c*=Get-X'), [['$c', '=', 'Get-X']])
  assert.deepEqual(ps('$c/=Get-X'), [['$c', '=', 'Get-X']])
  assert.deepEqual(ps('$c%=Get-X'), [['$c', '=', 'Get-X']])
  assert.deepEqual(ps('$c??=Get-X'), [['$c', '=', 'Get-X']])
  assert.deepEqual(ps('$env:C=Get-X'), [['$env:C', '=', 'Get-X']])
  // Quoted or not.
  assert.deepEqual(ps('"$c=Get-X"'), [['$c', '=', 'Get-X']])
  assert.deepEqual(ps('"$c=Get-X y"'), [['$c', '=', 'Get-X y']])
  // Nothing after the operator: the name and the =.
  assert.deepEqual(ps('$c='), [['$c', '=']])
  assert.deepEqual(ps('$c+='), [['$c', '=']])
  // Only the first operator splits; the rest of the word stays whole.
  assert.deepEqual(ps('$c=a=b'), [['$c', '=', 'a=b']])
  // Not split: no $ first, or no operator.
  assert.deepEqual(ps('c=Get-X $c Get-X=1 --x=1'), [['c=Get-X', '$c', 'Get-X=1', '--x=1']])
})

// --- A script word is never split ----------------------------------------------------------------------------

test('a word that is a whole script, as bash -c takes it, is not split into pieces (found by the differential run)', () => {
  const READ = 'security find-generic-password -s keyprompt -w'
  for (const text of [
    `bash -c "$c=Get-StoredCredential -Target keyprompt:X +o ${READ}"`,
    `bash -c '$c=echo; ${READ}'`,
    `bash -c "-a:b ${READ}"`,
    `sh -c "$x%= ${READ}"`,
    `zsh -c '-Target:keyprompt:X; ${READ}'`,
    `bash -c "$c=1 ${READ}"`,
    `bash -c '$c+=1 secret-tool lookup service keyprompt'`,
  ]) {
    denied(text, 'powershell')
    denied(text)
  }
})

// --- Tighten only: a split never turns a refusal into a pass -------------------------------------------------

test('a command that main refuses before a text-only word is still refused after the split (found by the differential run)', () => {
  // Main could not see the command word behind a glued assignment or a `-Command:`, so it read the whole text and refused. With the split the
  // command word is seen, and a text-only word (echo, cat, Write-Output ...) would be let through unread. A split marks the command, so such a
  // word is read like `eval` (S-68), and what main refused stays refused.
  for (const text of [
    '$c= echo security find-generic-password -s keyprompt -w',
    '$x%= Write-Output Get-StoredCredential -Target keyprompt:X',
    '$c+= time echo security find-generic-password -g -s OPENAI_API_KEY',
    '$env:A= env cat security dump-keychain -d',
    '$c= eval grep secret-tool lookup service keyprompt',
    '$= Write-Host secret-tool lookup service keyprompt',
    'pwsh -Command: printf errexit security dump-keychain -d',
    'pwsh -c: echo security find-generic-password -s keyprompt -w',
    'Write-Output -InputObject:x; security find-generic-password -s keyprompt -w',
    'x pwsh -c " () $= command printf secret-tool lookup -a:x service keyprompt',
  ]) {
    denied(text, 'powershell')
    denied(text)
  }
})

// --- Bash is unchanged -------------------------------------------------------------------------------------

test('the same words read as Bash stay as main reads them', () => {
  assert.deepEqual(splitShell('Get-StoredCredential -Target:keyprompt:X').commands, [['Get-StoredCredential', '-Target:keyprompt:X']])
  assert.deepEqual(splitShell('$c=Get-StoredCredential -Target keyprompt:X').commands, [['$c=Get-StoredCredential', '-Target', 'keyprompt:X']])
  assert.deepEqual(splitShell('$c+=Get-X').commands, [['$c+=Get-X']])
  for (const text of ['Get-StoredCredential -Target:keyprompt:X', '$c=Get-StoredCredential -Target keyprompt:X', '$c+=Get-StoredCredential -Target keyprompt:X']) {
    allowed(text, 'bash')
  }
})

test('splitting never adds a refusal to a command that reads nothing', () => {
  for (const text of [
    'Get-Date -Format:yyyy:MM',
    '$x=5; Write-Output $x',
    '$x+=1',
    '$x??=Get-Date',
    'Get-ChildItem -Path:C:\\temp -Recurse',
    'Get-Content -Path:keyprompt.log',
    '$c=Get-Date; $c',
    'Write-Output -InputObject:hello',
  ]) {
    allowed(text, 'powershell')
    allowed(text)
  }
})

// --- Linear time -------------------------------------------------------------------------------------------

/** @param {() => void} run @returns {number} the median of three timings, in ms */
function median3(run) {
  const times = []
  for (let k = 0; k < 3; k++) {
    const t = performance.now()
    run()
    times.push(performance.now() - t)
  }
  return times.sort((a, b) => a - b)[1]
}

test('splitting words costs time in step with a text of the same length with nothing to split', () => {
  const n = 100_000
  for (const [split, flat] of [
    ['-a:b '.repeat(n), '-ab  '.repeat(n)],
    ['$a=b '.repeat(n), 'a=b  '.repeat(n)],
    [`-${'a'.repeat(n * 5 - 4)}:b`, `-${'a'.repeat(n * 5 - 3)}b`],
    [`$${'a'.repeat(n * 5 - 4)}=b`, `${'a'.repeat(n * 5 - 2)}=b`],
  ]) {
    const base = median3(() => splitShell(flat, true))
    const took = median3(() => splitShell(split, true))
    assert.ok(took < 3 * base + 300, `split text took ${took.toFixed(0)} ms against ${base.toFixed(0)} ms for the same length`)
  }
})
