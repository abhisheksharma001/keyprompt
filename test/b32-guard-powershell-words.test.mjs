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

test('assignments chained in one word are each split, so the cmdlet at the end is a word of its own (found by comparing two versions)', () => {
  for (const text of [
    '$a=$b=Get-StoredCredential -Target keyprompt:X',
    '$a+=$b-=$c??=Get-StoredCredential -Target keyprompt:X',
    '$a=$b=$c=Get-StoredCredential -Target:keyprompt:X',
    '$a=$b=Get-StoredCredential -Target OPENAI_API_KEY',
    'echo ok; $a=$b=Get-StoredCredential -Target keyprompt:X',
    'pwsh -c "$a=$b=Get-StoredCredential -Target keyprompt:X"',
    'pwsh -c $a=$b=Get-StoredCredential -Target keyprompt:X',
  ]) {
    denied(text, 'powershell')
    denied(text)
  }
  assert.deepEqual(ps('$a=$b=Get-X y'), [['$a', '=', '$b', '=', 'Get-X', 'y']])
  assert.deepEqual(ps('$a+=$b??=c'), [['$a', '=', '$b', '=', 'c']])
  // Only a $ after the = starts another assignment; anything else is the rest.
  assert.deepEqual(ps('$a=b=$c'), [['$a', '=', 'b=$c']])
  assert.deepEqual(ps('$a=$b'), [['$a', '=', '$b']])
  assert.deepEqual(ps('$a=$b='), [['$a', '=', '$b', '=']])
})

// --- Tighten only: a split never turns a refusal into a pass -------------------------------------------------

test('a command that main refuses before a text-only word is still refused after the split (found by the differential run)', () => {
  // Main could not see the command word behind a glued assignment or a `-Command:`, so it read the whole text and refused. In the split copy the
  // command word is seen, and a text-only word (echo, cat, Write-Output ...) is let through unread there. The command is also read as main read it
  // (the first of the two commands splitShell returns), so what main refused stays refused.
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

test('a nested pwsh -c text full of split words needs no more of the work budget than the same length without any', () => {
  // Each level of the nesting quotes the one inside it, as the nested-pwsh test in b25-guard-plain-forms.test.mjs does.
  const nest = (inner) => {
    const l2 = "x pwsh -c '" + 'x pwsh -c ' + inner + "'"
    const l1 = "x pwsh -c '" + l2.replace(/'/g, "''") + "'"
    return 'x pwsh -c "' + l1.replace(/"/g, '\\"') + '"'
  }
  // The text names a read tool without running one, so it is let through only if the budget lasts; one that runs out is refused.
  for (const unit of ['z ', '-a:b ', '$a=b ']) {
    const text = nest(unit.repeat(20_000) + 'find-generic-password')
    // Reading the text once at each level takes about 12 units for each character, and nothing more is allowed.
    assert.equal(checkCommand(text, SAVED, undefined, 12 * text.length + 1000), null, `the budget ran out reading ${unit.trim()} words`)
  }
})

test('a split word before a nested pwsh -c flag, or beside eval, does not double the work at each level (review of PR #75, B2)', () => {
  // Each text names a read tool without running one, about 40 to 100 KB and 2 to 4 levels deep. Main lets each one through within its
  // budget. Reading the split copy's scripts again at every level made each one run out of budget, so it was refused as too long to read.
  const read = 'find-generic-password'
  for (const text of [
    '-a:b pwsh -c '.repeat(4) + '-a:b '.repeat(20_000) + read,
    '$a=pwsh -c '.repeat(4) + '$a=b '.repeat(20_000) + read,
    'pwsh -c eval pwsh -c eval ' + 'z '.repeat(20_000) + read + ' -a:b',
    'eval pwsh -c eval pwsh -c ' + 'z '.repeat(20_000) + read + ' -a:b',
  ]) {
    for (const shell of /** @type {const} */ (['powershell', 'bash'])) allowed(text, shell)
  }
})

test('a text a split copy reads again after a function is defined is read again without the text-only exemption', () => {
  // Only the split copy sees `pwsh` here. The first reading lets `echo` through; the second (S-68) reads it like eval and finds the read.
  denied("function f {}; $a=pwsh -c 'echo Get-StoredCredential -Target keyprompt:X'", 'powershell')
})

test('a text read once is still read again when a split copy reaches it deeper, so the depth limit still holds', () => {
  // `$a=pwsh` is split into `$a`, `=`, `pwsh`, so the copy has one more level than the original: its innermost `pwsh -c` script is past the
  // depth limit. The texts the copy reaches were read before, by the first command, but less deep.
  const P = (n) => 'pwsh -c '.repeat(n) + 'find-generic-password'
  const found = checkCommand(`${P(3)} ; $a=${P(5)}`, SAVED, 'powershell')
  assert.match(found?.reason ?? '', /too long or too deeply nested/)
})

test('outside a split copy every reading is made, as on main, so a text main runs out of budget on is still refused', () => {
  // The same nested text twice: main reads it twice and needs about 9 units of the budget for each character. Skipping the second reading
  // outside a copy would need about 4, and let through a text main refuses.
  const inner = 'pwsh -c '.repeat(2) + 'z '.repeat(500) + 'find-generic-password'
  const text = `${inner} ; ${inner}`
  assert.ok(checkCommand(text, SAVED, 'powershell', 6 * text.length), 'should refuse: the budget runs out on main')
})

test('after a split copy is read, the readings outside it are all made again, as on main', () => {
  // The first command `-a:b` has a split copy; once it is read, the skip must not carry on into the commands after it.
  const inner = 'pwsh -c '.repeat(2) + 'z '.repeat(500) + 'find-generic-password'
  const text = `-a:b ; ${inner} ; ${inner}`
  assert.ok(checkCommand(text, SAVED, 'powershell', 6 * text.length), 'should refuse: the budget runs out on main')
})

test('a split copy of many small commands needs little more of the work budget than main', () => {
  // 2,000 commands, each with a split word and a one-word `pwsh -c` script the copy has already seen. Main needs about 2 units of the
  // budget for each character; the copy's skips must not cost more than reading those scripts would.
  const text = '-a:b pwsh -c x ; '.repeat(2000) + 'find-generic-password'
  assert.equal(checkCommand(text, SAVED, 'powershell', 3 * text.length), null)
})

test('a text a split copy reaches is read again when it is read in another comments mode or as the other shell', () => {
  // From the round-2 senior review of PR #75: with either left out of what marks a text as already read, the skip lets these through.
  for (const text of [
    '$v=pwsh -c eval x pwsh -c <# security dump-keychain -d )',
    `eval $v=pwsh -c bash -c '"$( Get-StoredCredential -Target:keyprompt:X ' ; -a:b eval $v=pwsh -c bash -c '"$( Get-StoredCredential -Target:keyprompt:X '`,
  ]) {
    assert.ok(checkCommand(text, SAVED, 'powershell'), `should refuse: ${text}`)
  }
})

test('a text one split copy read is read again when another copy reaches it deeper', () => {
  // Both commands start with `$a=pwsh`, so only their split copies see the nesting. The second copy reaches, one level deeper, texts the first
  // copy read; read again there, its innermost `pwsh -c` script is past the depth limit.
  const P = (n) => 'pwsh -c '.repeat(n) + 'find-generic-password'
  const found = checkCommand(`$a=${P(3)} ; $a=${P(5)}`, SAVED, 'powershell')
  assert.match(found?.reason ?? '', /too long or too deeply nested/)
})

test('a text a split copy read is still read again by the commands outside it, as on main', () => {
  // Main reads the nested text three times and needs about 11 units of the budget for each character. Skipping the two readings after the
  // copy's would need about 8, and let through a text main refuses.
  const inner = 'pwsh -c '.repeat(2) + 'z '.repeat(500) + 'find-generic-password'
  const text = `-a:b pwsh -c ${inner} ; pwsh -c ${inner} ; pwsh -c ${inner}`
  assert.ok(checkCommand(text, SAVED, 'powershell', Math.floor(9.5 * text.length)), 'should refuse: the budget runs out on main')
})

test('one word of 150,000 chained assignments after a read does not crash the guard, so the read is still refused (review of PR #75, B1)', () => {
  // A guard that throws is skipped by the hook (exit 1 lets the call through), so a crash would turn a refusal into a pass.
  const chain = '$a='.repeat(150_000) + '1'
  for (const [text, shell] of [
    [`Get-StoredCredential -Target keyprompt:X ; ${chain}`, 'powershell'],
    [`if(1){Get-StoredCredential -Target keyprompt:X} ${chain}`, undefined],
    [`pwsh -c 'Get-StoredCredential -Target keyprompt:X ; ${chain}'`, 'bash'],
  ]) {
    let found
    assert.doesNotThrow(() => (found = checkCommand(text, SAVED, shell)), `threw (${shell ?? 'both ways'})`)
    assert.ok(found, `should refuse (${shell ?? 'both ways'}) a read followed by a long chain`)
  }
})
