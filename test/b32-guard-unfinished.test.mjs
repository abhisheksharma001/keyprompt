import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCommand, preToolUse, splitShell } from '../src/guard.mjs'

// B-32 items 5, 11 and 17 (docs/bugs.md), step S-67: when the guard cannot finish reading a command that names a
// store read tool, it refuses instead of letting the command through. Every command below is only ever passed to
// checkCommand / preToolUse / splitShell as a string; none is run.

const SAVED = ['OPENAI_API_KEY']
const READ = 'security find-generic-password -s keyprompt -w'
const PS_READ = 'Get-StoredCredential -Target keyprompt:X'

const READS_REASON = 'keyprompt guard: this command reads a secret saved by keyprompt straight from the OS password store.'
// Approved by Abhishek (D-25).
const UNREAD_REASON =
  "keyprompt guard: this command is too long or too deeply nested for the guard to read, and it names the OS password store's read tool, so it is refused."
// The tail rule's sentence. The approved one says "too long or too deeply nested", which is not true of a tail that opens a quote,
// and a sentence that says the words after the flag "open" a quote was not true of a quote opened by a later word in double quotes
// (senior review of PR #69), so this one says that the guard read them as PowerShell. Abhishek approves it with the merge.
const UNCLOSED_REASON =
  "keyprompt guard: read as PowerShell, the words after a `-c` or `-Command` flag in this command open a quote, a block comment or `$(` that never closes, so the guard cannot finish reading them, and the command names the OS password store's read tool, so it is refused."

/** @param {string | undefined} shell */
function refusal(command, shell) {
  const found = checkCommand(command, SAVED, shell)
  assert.ok(found, `should refuse (${shell ?? 'both ways'}): ${command.slice(0, 120)}`)
  return found.reason
}

// --- Item 5: past the depth limit, a command that names a read is refused -----------------------------------

test('eval nested five or more deep around a read is refused as unreadable (item 5)', () => {
  for (const evals of [5, 6, 9, 30]) {
    for (const shell of ['bash', 'powershell', undefined]) {
      const reason = refusal('eval '.repeat(evals) + READ, shell)
      assert.ok(reason.startsWith(UNREAD_REASON), `${evals} evals, ${shell}: ${reason.slice(0, 100)}`)
      assert.match(reason, /`keyprompt run NAME -- COMMAND`/)
    }
  }
})

test('pwsh -c nested five or more deep around a read is refused as unreadable (item 5)', () => {
  for (const calls of [5, 8, 40]) {
    for (const shell of ['bash', 'powershell', undefined]) {
      const reason = refusal('pwsh -c '.repeat(calls) + PS_READ, shell)
      assert.ok(reason.startsWith(UNREAD_REASON), `${calls} calls, ${shell}: ${reason.slice(0, 100)}`)
    }
  }
})

test('the name of the read tool is found even when quotes and backslashes are in it (item 5)', () => {
  assert.ok(refusal('eval eval eval eval eval security find-generic-"password" -s keyprompt -w', 'bash').startsWith(UNREAD_REASON))
  assert.ok(refusal("eval eval eval eval eval security find\\-generic-'pass'word -s keyprompt -w", 'bash').startsWith(UNREAD_REASON))
  assert.ok(refusal('eval eval eval eval eval security dump-keychain -d', 'bash').startsWith(UNREAD_REASON))
  assert.ok(refusal('eval eval eval eval eval secret-tool lookup service keyprompt', 'bash').startsWith(UNREAD_REASON))
  assert.ok(refusal('pwsh -c pwsh -c pwsh -c pwsh -c pwsh -c "[Cred]::CredRead(1)"', 'powershell').startsWith(UNREAD_REASON))
})

test('four evals deep is still read, and answers with the plain reason (item 5)', () => {
  assert.ok(refusal('eval eval eval eval ' + READ, 'bash').startsWith(READS_REASON))
  assert.ok(refusal('pwsh -c pwsh -c pwsh -c pwsh -c ' + PS_READ, 'powershell').startsWith(READS_REASON))
})

test('a command nested deeper than that, which names no read tool, is still allowed (item 5)', () => {
  assert.equal(checkCommand('eval '.repeat(8) + 'echo hello', SAVED), null)
  assert.equal(checkCommand('pwsh -c '.repeat(200) + 'x', SAVED), null)
  assert.equal(checkCommand('eval eval eval eval eval eval eval echo "security is a word"', SAVED), null)
})

test('the hook output for an unreadable command is a deny with the same words (item 5)', () => {
  const out = preToolUse({ tool_name: 'Bash', tool_input: { command: 'eval '.repeat(6) + READ } }, SAVED)
  assert.equal(out?.hookSpecificOutput.permissionDecision, 'deny')
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.startsWith(UNREAD_REASON))
})

// --- Item 11: a fake `pwsh -c` that opens `<#` or `'` must not hide a real one after it -----------------------

const ITEM_11 = {
  'a fake call that opens <#': `find . -exec pwsh -c "<#" \\; -exec pwsh -c Write-Output pwsh '; ${PS_READ}' \\;`,
  "a fake call that opens a '": `find . -exec pwsh -c "'" \\; -exec pwsh -c Write-Output pwsh '; ${PS_READ}' \\;`,
  'the same with a path to pwsh': `find . -exec /usr/local/bin/pwsh -c "<#" \\; -exec /usr/local/bin/pwsh -c Write-Output /usr/local/bin/pwsh '; ${PS_READ}' \\;`,
  'the same with a path to pwsh and a quote': `find . -exec /usr/local/bin/pwsh -c "'" \\; -exec /usr/local/bin/pwsh -c Write-Output /usr/local/bin/pwsh '; ${PS_READ}' \\;`,
}

test('a tail that opens a quote or comment and never closes it is refused when it names a read (item 11)', () => {
  for (const [what, command] of Object.entries(ITEM_11)) {
    for (const shell of ['bash', 'powershell', undefined]) {
      const reason = refusal(command, shell)
      assert.ok(reason.startsWith(UNCLOSED_REASON) || reason.startsWith(READS_REASON), `${what} (${shell}): ${reason.slice(0, 100)}`)
    }
  }
})

test('the Bash tool gets the unclosed-text reason for item 11 (item 11)', () => {
  for (const [what, command] of Object.entries(ITEM_11)) {
    assert.ok(refusal(command, 'bash').startsWith(UNCLOSED_REASON), what)
  }
})

test('the same shapes that name no read tool are still allowed (item 11)', () => {
  assert.equal(checkCommand(`find . -exec pwsh -c "<#" \\; -exec pwsh -c Write-Output pwsh 'x' \\;`, SAVED, 'bash'), null)
  assert.equal(checkCommand(`find . -exec pwsh -c "'" \\; -exec pwsh -c Write-Output pwsh 'x' \\;`, SAVED, 'bash'), null)
})

// --- splitShell reports a text that ends inside something it opened ------------------------------------------

test('splitShell says when the text ends inside a quote, a comment, $( or a backtick (item 11)', () => {
  /** @type {[string, boolean, boolean][]} text, PowerShell, open */
  const cases = [
    ["echo 'abc", false, true],
    ['echo "abc', false, true],
    ['echo $(abc', false, true],
    ['echo "a $(b"', false, true],
    ['echo `abc', false, true],
    ['<# abc', true, true],
    ['echo hi <# abc', true, true],
    ["echo 'a''", true, true],
    ["echo 'abc'", false, false],
    ['echo "abc"', false, false],
    ['echo $(abc)', false, false],
    ['echo `abc`', false, false],
    ['<# abc #>', true, false],
    ["echo 'a''b'", true, false],
    ['echo hi; echo there', false, false],
    ['', false, false],
    ['echo `abc', true, false], // In PowerShell the backtick is the escape character, so it opens nothing.
  ]
  for (const [text, powershell, open] of cases) {
    assert.equal(splitShell(text, powershell).open, open, `${JSON.stringify(text)} (powershell ${powershell})`)
  }
  // With comments off, `<#` is a plain word, as main read it.
  assert.equal(splitShell('<# abc', true, false).open, false)
})

// --- Item 17: a work budget, so slowness can never turn into a pass ------------------------------------------

test('when the work budget runs out before anything is found, a command that names a read is refused (item 17)', () => {
  const reason = checkCommand(READ, SAVED, 'bash', 10)?.reason
  assert.ok(reason?.startsWith(UNREAD_REASON), reason)
  assert.ok(checkCommand(`echo hi; ${PS_READ}`, SAVED, 'powershell', 5)?.reason.startsWith(UNREAD_REASON))
  assert.ok(checkCommand(`true $(true); ${READ}`, SAVED, undefined, 20)?.reason.startsWith(UNREAD_REASON))
})

test('when the work budget runs out, a command that names no read tool is let through (item 17)', () => {
  assert.equal(checkCommand('echo hi; ls -la', SAVED, 'bash', 3), null)
  assert.equal(checkCommand('echo "security"; true', SAVED, 'bash', 3), null)
})

test('a read found before the budget runs out is refused with the plain reason (item 17)', () => {
  // The text is scanned once in bash mode: a budget of its length is enough for that scan.
  const reason = checkCommand(READ, SAVED, 'bash', READ.length * 3)?.reason
  assert.ok(reason?.startsWith(READS_REASON), reason)
})

test('an ordinary command is read with the default budget (item 17)', () => {
  assert.ok(checkCommand(READ, SAVED)?.reason.startsWith(READS_REASON))
  assert.equal(checkCommand('echo hello', SAVED), null)
})

test('a read tool is named through quotes, backslashes, backticks and line breaks inside its name (item 17)', () => {
  // A budget of 1 character runs out at once, so the answer comes from naming alone.
  for (const junk of ["'", '"', '\\', '`', '\n', '\r']) {
    for (const name of ['find-generic-password', 'dump-keychain', 'secret-tool', 'Get-StoredCredential', 'CredRead']) {
      const command = `x ${name.slice(0, 4)}${junk}${name.slice(4)} y`
      const reason = checkCommand(command, SAVED, 'bash', 1)?.reason
      assert.ok(reason?.startsWith(UNREAD_REASON), JSON.stringify(command))
    }
  }
  assert.equal(checkCommand('x find-generic-pass y', SAVED, 'bash', 1), null, 'part of a name is not the name')
  assert.equal(checkCommand('x password-generic-find y', SAVED, 'bash', 1), null)
})

// The parser takes `$( … )` spans, backtick spans and (in PowerShell) curly quotes out of a word, so a tool name split by one
// is the tool name to it. The fallback that runs when the guard cannot finish reading has to see the same name (senior review of PR #69).
const SPLIT_READS = {
  'security, $() inside the name': 'security find-generic-pass$()word -s keyprompt -w',
  'security, $(true) inside the name': 'security find-generic-pass$(true)word -s keyprompt -w',
  'security, a backtick span inside the name': 'security find-generic-pass`true`word -s keyprompt -w',
  'security dump-keychain split by $()': 'security dump-key$()chain -d',
  'secret-tool split by $(true)': 'secret-to$(true)ol lookup service keyprompt',
  'secret-tool split by a nested $( )': 'secret-to$(echo $(true))ol lookup service keyprompt',
  'secret-tool split by two spans': 'sec$()ret-to`x`ol lookup service keyprompt',
  'Get-StoredCredential split by $()': 'Get-Stored$()Credential -Target keyprompt:X',
  'Get-StoredCredential split by curly single quotes': 'Get-Stored‘’Credential -Target keyprompt:X',
  'Get-StoredCredential split by curly double quotes': 'Get-Stored“”Credential -Target keyprompt:X',
  'Get-StoredCredential split by low and reversed curly quotes': 'Get-Stored‚‛„’Credential -Target keyprompt:X',
  'CredRead split by $()': 'Add-Type x; [Cred]::Cred$()Read(1)',
  'security split by $() inside a $( )': 'echo $(security find-generic-pass$()word -s keyprompt -w)',
  'secret-tool split by a span holding bare parens, inside a $( )': 'echo $(secret-to$(echo (x))ol lookup service keyprompt)',
  'dump-keychain split by $() inside backticks': 'echo `security dump-key$(true)chain -d`',
  'dump-keychain split by $((1)) inside a $( ) that never closes': 'echo hi; $(security dump-$((1))keychain -d',
  'Get-StoredCredential split by two spans inside a $( )': 'x $(Get-Stored$(a)$(b)Credential -Target keyprompt:X)',
  'a tick span around a $( ) in the name': 'security find-generic-`$(x)`password -s keyprompt -w',
  'a tick span that holds a bare paren, between the halves': 'echo find-generic-`(x)`pass$(true)word -s keyprompt -w',
  'a ) inside a tick span, which closes nothing': 'echo find-generic-`x)`password -s keyprompt -w',
  'a $ in front of the name that opens no span': 'echo $find-generic-pass$(true)word -s keyprompt -w',
  // Round 2 of the senior review (A to G): spans the parser pairs differently from a plain left-to-right count.
  'A: an escaped ) inside $( )': 'security find-generic-pass$(\\))word -w -s keyprompt',
  'B: an escaped ( inside $( )': 'security find-generic-pass$(\\()word -w -s keyprompt',
  'C: a $( inside a backtick span': 'security find-generic-pass`$(`word -w -s keyprompt',
  'D: a backtick inside $( )': 'security find-gen`x`eric-pass$(`)word -w -s keyprompt',
  'E: a backtick inside $( ), PowerShell name': 'Get-Stored$(`))Credential -Target keyprompt:X',
  'F: a $( inside a backtick span, secret-tool': 'secret-to`$(`ol lookup service keyprompt',
  'G: a backtick inside $( ), dump-keychain': 'security dump-key$(`))chain -d',
  'residual: $(( then a $( inside a backtick span': '$((secret-to`$(`ol lookup service keyprompt',
}

test('a read tool name split by a $( ) span, a backtick span or curly quotes is found when the budget runs out (item 17, review of PR #69)', () => {
  // A budget of 1 character runs out at once, so the answer comes from naming alone.
  for (const [what, command] of Object.entries(SPLIT_READS)) {
    for (const shell of ['bash', 'powershell', undefined]) {
      const reason = checkCommand(`echo hi; ${command}`, SAVED, shell, 1)?.reason
      assert.ok(reason?.startsWith(UNREAD_REASON), `${what} (${shell ?? 'both'}): ${reason?.slice(0, 80)}`)
    }
  }
})

test('a split name is found inside and after spans nested any depth, and the check does not crash on them (item 5, review of PR #69)', () => {
  const split = 'secret-to$(true)ol lookup service keyprompt'
  for (const depth of [3, 8, 63, 64, 70, 200, 5000]) {
    const open = '$('.repeat(depth)
    const close = ')'.repeat(depth)
    for (const command of [`${open}${split}${close}`, `${open}${split}`, `${open}${close} ${split}`, `${open}echo hi${close}; ${split}`, `${close} ${split}`]) {
      const reason = checkCommand(command, SAVED, 'bash', 1)?.reason
      assert.ok(reason?.startsWith(UNREAD_REASON), `${depth} deep: ${command.slice(0, 20)}... ${command.slice(-50)}`)
    }
  }
})

test('a stray backtick before a tick span around a $( ) in the name does not hide the name (item 17, review of PR #69)', () => {
  // The first backtick has no partner, so the others pair up the wrong way round: with backticks read as spans, `$(x)` lands on the
  // same level as the two halves of the name. The other reading, with backticks as plain characters, puts it a level down.
  const command = "`\nbash -c '(a) security find-generic-`$(x)`password -s keyprompt -w}(a) "
  for (const shell of ['powershell', undefined]) {
    assert.ok(checkCommand(command, SAVED, shell), `read in full (${shell ?? 'both'})`)
    assert.ok(checkCommand(command, SAVED, shell, 1)?.reason.startsWith(UNREAD_REASON), `the fallback names it too (${shell ?? 'both'})`)
  }
})

test('a read tool name split by a $( ) span is found past the depth limit as well (item 5, review of PR #69)', () => {
  const nested = 'echo $('.repeat(5) + 'security find-generic-pass$()word -s keyprompt -w' + ')'.repeat(5)
  const reason = refusal(nested, 'bash')
  assert.ok(reason.startsWith(UNREAD_REASON) || reason.startsWith(READS_REASON), reason.slice(0, 80))
})

test('a name that is only near a span, or a span that holds only part of it, is not taken for the tool (item 17)', () => {
  for (const command of [
    'echo find-generic-pass $(date) word',
    'echo secret- $(true) tool',
    'echo find-generic-pass)word', // a ) outside every span is a plain character and separates words
    'echo find-generic-pass(x)word',
    'x $(secret-)$(tool lookup service keyprompt)', // two spans next to each other are two scripts, not one word
    'x$(secret-)$(tool)',
    'echo $(find-generic-pass)word',
    'echo find-generic-pass‘ ’word',
  ]) {
    assert.equal(checkCommand(command, SAVED, 'bash', 1), null, command)
  }
})

test('the same split names, in a command too long for the default budget, are still refused (item 17, review of PR #69)', () => {
  // Main reads these (the parser takes the span out of the word) and refuses them at any length. The shape is the one
  // item 17 describes, about 100 KB of it, which runs the default budget out before the read at its end is reached.
  const pad = nestLater('z '.repeat(50000))
  assert.ok(pad.length > 100000)
  /** @type {[string, (string | undefined)[]][]} */
  const cases = [
    ['security find-generic-pass$()word -s keyprompt -w', ['bash', undefined]],
    ['security find-generic-pass`true`word -s keyprompt -w', ['bash', undefined]],
    ['secret-to$(true)ol lookup service keyprompt', ['bash', undefined]],
    ['Get-Stored$()Credential -Target keyprompt:X', ['powershell', undefined]],
    ['Get-Stored‘’Credential -Target keyprompt:X', ['powershell', undefined]],
    [SPLIT_READS['A: an escaped ) inside $( )'], ['bash', undefined]],
    [SPLIT_READS['C: a $( inside a backtick span'], ['bash', undefined]],
    [SPLIT_READS['D: a backtick inside $( )'], ['bash', undefined]],
    [SPLIT_READS['E: a backtick inside $( ), PowerShell name'], ['powershell', undefined]],
    [SPLIT_READS['G: a backtick inside $( ), dump-keychain'], ['powershell', undefined]],
    [SPLIT_READS['residual: $(( then a $( inside a backtick span'], ['bash', undefined]],
  ]
  for (const [read, shells] of cases) {
    for (const shell of shells) {
      const reason = checkCommand(`${pad}; ${read}`, SAVED, shell)?.reason
      assert.ok(reason, `${shell ?? 'both'}: ${read}`)
      assert.ok(reason.startsWith(UNREAD_REASON) || reason.startsWith(READS_REASON), reason.slice(0, 80))
    }
  }
})

test('a split name in a plain command past the 16 million cap is refused, though main reads it (item 17, review of PR #69)', () => {
  // 16.5 MB with nothing nested: main reads it in about a second. The first reading charges more than the cap, so the name check answers.
  const command = 'true '.repeat(3300000) + '; ' + SPLIT_READS['A: an escaped ) inside $( )']
  assert.ok(command.length > 16500000)
  const reason = checkCommand(command, SAVED, 'bash')?.reason
  assert.ok(reason?.startsWith(UNREAD_REASON), reason?.slice(0, 80))
})

test('curly quotes inside a read tool name are found in a command of about 20 KB, as the Monitor tool reads it (item 17, review of PR #69)', () => {
  const command = `${nestLater('z '.repeat(10000))}; Get-Stored‘’Credential -Target keyprompt:X`
  assert.ok(command.length > 20000)
  for (const shell of ['powershell', undefined]) {
    const reason = checkCommand(command, SAVED, shell)?.reason
    assert.ok(reason, `${shell ?? 'both'} should refuse`)
  }
})

// --- The tail rule's sentence is true on the path where a later word opens the quote --------------------------

test('a find command whose later word has an apostrophe in double quotes is refused with a sentence that is true of it (item 11, review of PR #69)', () => {
  // No word after the first `-c` opens a quote as bash reads it: the apostrophe is inside double quotes. Read as PowerShell, the
  // later words do open one, which is what the sentence says. It names a read tool, so it is refused rather than let through.
  const commands = [
    `find . -exec pwsh -c 'Write-Host $args' {} \\; -o -name "Bob's secret-tool notes.md" -exec pwsh -File lint.ps1 {} \\;`,
    `find . -name '*.ps1' -exec pwsh -c 'Get-Content $args[0]' {} \\; -exec grep -l "don't call secret-tool" {} \\; -exec pwsh -c 'Write-Host done' \\;`,
  ]
  for (const command of commands) {
    for (const shell of ['bash', undefined]) {
      assert.ok(refusal(command, shell).startsWith(UNCLOSED_REASON), `${shell ?? 'both'}: ${command.slice(0, 80)}`)
    }
    assert.equal(checkCommand(command.replace(/secret-tool/g, 'a tool'), SAVED, 'bash'), null, 'the same command that names no read tool is allowed')
  }
})

test('the unclosed-text sentence the guard gives says what it did and does not claim more (invariant 9)', () => {
  const reason = refusal(ITEM_11['a fake call that opens <#'], 'bash')
  assert.ok(reason.startsWith('keyprompt guard: read as PowerShell, the words after a `-c` or `-Command` flag'), reason.slice(0, 100))
  assert.ok(!/too long|too deeply nested/.test(reason), 'it is not the sentence for depth or length')
  assert.ok(!/text after a PowerShell `-c` or `-Command` flag that opens/.test(reason), 'it does not claim that the text after the flag, as written, opens the quote')
})

test('the work budget is spent at its limit and not before (item 17)', () => {
  assert.ok(checkCommand(READ, SAVED, 'bash', READ.length)?.reason.startsWith(READS_REASON), 'a limit of exactly the text is enough for the first reading')
  assert.ok(checkCommand(READ, SAVED, 'bash', READ.length - 1)?.reason.startsWith(UNREAD_REASON), 'one character fewer is not')
})

test('command substitution nested five deep around a read is refused as unreadable, and four deep is read (item 5)', () => {
  const deep = (levels) => 'echo $('.repeat(levels) + READ + ')'.repeat(levels)
  assert.ok(refusal(deep(5), 'bash').startsWith(UNREAD_REASON))
  assert.ok(refusal(deep(8), undefined).startsWith(UNREAD_REASON))
  assert.ok(refusal(deep(4), 'bash').startsWith(READS_REASON))
})

test('a read in a later $( ) of a command is found after an earlier one that holds none (item 5)', () => {
  assert.ok(refusal(`echo $(true) $(${READ})`, 'bash').startsWith(READS_REASON))
})

/** Four levels of quoting around a script, the shape the timing tests in b25-guard-plain-forms.test.mjs use. */
function nest4(filler) {
  const l3 = 'x pwsh -c ' + filler
  const l2 = "x pwsh -c '" + l3 + "'"
  const l1 = "x pwsh -c '" + l2.replace(/'/g, "''") + "'"
  return 'x pwsh -c "' + l1.replace(/"/g, '\\"') + '"'
}

test('the default work budget grows with the length of the command, so a long nested read is still found (item 17)', () => {
  // About 500 KB. Reading down to the read at its end takes about 2 million characters, more than the 1 million base budget.
  const command = nest4('z '.repeat(250000) + PS_READ)
  assert.ok(command.length > 500000)
  const reason = checkCommand(command, SAVED)?.reason
  assert.ok(reason?.startsWith(READS_REASON), reason?.slice(0, 120))
})

/** A flat filler and the shape B-32 item 17 describes: every nested `pwsh -c` is followed by another word named pwsh. */
function nestLater(filler) {
  const l3 = 'x pwsh -c ' + filler + ' pwsh y'
  const l2 = "x pwsh -c '" + l3 + "' pwsh y"
  const l1 = "x pwsh -c '" + l2.replace(/'/g, "''") + "' pwsh y"
  return 'x pwsh -c "' + l1.replace(/"/g, '\\"') + '" pwsh y'
}

// Time limits here are 5 seconds, half the hook's 10 second timeout: on the builder's machine this shape took 0.8 to 2.0 s
// with other work running, and 2.8 to 4 s on main, so a limit of 2 s would fail by chance. The test after them does not use a clock.
test("B-32 item 17's 1 MB shape is answered well inside the hook timeout, read both ways (open flag F13)", () => {
  const command = nestLater('z '.repeat(500000))
  assert.ok(command.length > 1000000)
  const start = Date.now()
  const found = checkCommand(command, SAVED)
  const ms = Date.now() - start
  assert.equal(found, null, 'it names no read tool')
  assert.ok(ms < 5000, `took ${ms} ms`)
})

test('the same 1 MB shape with a read in it is refused well inside the hook timeout (item 17)', () => {
  const command = nestLater('z '.repeat(250000) + READ + ' ' + 'z '.repeat(250000))
  const start = Date.now()
  const found = checkCommand(command, SAVED)
  const ms = Date.now() - start
  assert.ok(found, 'a command that names a read tool is never let through')
  assert.ok(ms < 5000, `took ${ms} ms`)
})

test("B-32 item 17's 1 MB shape is cut off by the work budget when it names a read tool (no clock)", () => {
  // It only names the tool, so the guard finds no read; reading all of it takes more than 12 characters per character
  // (it takes 64), so only the budget can give the refusal, whatever the machine's speed.
  const command = nestLater('z '.repeat(500000) + 'find-generic-password')
  const reason = checkCommand(command, SAVED)?.reason
  assert.ok(reason?.startsWith(UNREAD_REASON), reason)
})

test('a command of any length gets an answer in bounded time and, naming a read, a refusal (item 17)', () => {
  // About 12 MB that only names the tool (no read the guard would find): the four readings need about 48 million characters,
  // more than the largest budget (16 million), so only the budget can refuse it.
  const command = 'x ' + 'z '.repeat(6000000) + 'find-generic-password'
  const start = Date.now()
  const reason = checkCommand(command, SAVED)?.reason
  const ms = Date.now() - start
  assert.ok(reason?.startsWith(UNREAD_REASON), reason)
  assert.ok(ms < 6000, `took ${ms} ms, too close to the hook's 10 second timeout`)
})

// --- The property: whatever the parser refuses, the fallback refuses (review of PR #69) ----------------------------------------

test('6,000 seeded commands: whatever the guard finds a read in, the fallback names it too, so a long command cannot hide it (property)', () => {
  // The fallback is what answers when the budget or the depth ends the reading, with a limit of 1 so that it always does.
  // Main refuses these in full reading, so a command the fallback lets through would be a command that padding turns into a pass.
  const NAMES = [
    ['security find-generic-', 'password -s keyprompt -w'],
    ['secret-', 'tool lookup service keyprompt'],
    ['Get-Stored', 'Credential -Target keyprompt:X'],
    ['security dump-', 'keychain -d'],
    ['Add-Type x; [Cred]::Cred', 'Read(1)'],
  ]
  const SPLIT = ['', '$()', '$(true)', '$(echo (x))', '$(echo $(y))', '`true`', '``', "''", '""', '\\', '‘’', '“”', '$(a)$(b)', '$((1))', '`$(x)`']
  const OPEN = ['', '$(', 'echo $(', '`', '"$(', '"', 'echo "', "'", 'eval ', 'bash -c "', "bash -c '", 'pwsh -c ', 'pwsh -c "', "pwsh -c '", '( ', '{ ', 'x; ', 'x | ', 'echo $(echo ', 'sudo ', 'env A=1 ']
  const CLOSE = ['', ')', '`', '"', "'", ' )', '))', ')"', ')`', '}', ' )"']
  const FILL = ['', 'x ', 'echo hi; ', '(a) ', '$(b) ', 'foo ', '# c\n', '\n', '; ']
  const rand = seeded(20261111)
  let found = 0
  for (let n = 0; n < 6000; n++) {
    const [first, second] = pick(rand, NAMES)
    let command = pick(rand, FILL) + pick(rand, OPEN) + pick(rand, FILL) + first + pick(rand, SPLIT) + second + pick(rand, CLOSE) + pick(rand, FILL)
    if (rand() < 0.3) command = pick(rand, OPEN) + command + pick(rand, CLOSE)
    for (const shell of ['bash', 'powershell', undefined]) {
      const reason = checkCommand(command, SAVED, shell)?.reason
      if (!reason || reason.startsWith(UNREAD_REASON) || reason.startsWith(UNCLOSED_REASON)) continue
      found++
      assert.ok(checkCommand(command, SAVED, shell, 1), `read in full, but the fallback lets it through (${shell ?? 'both'}): ${JSON.stringify(command)}`)
    }
  }
  assert.ok(found > 2000, `only ${found} of the generated commands hold a read the guard finds, so the property says little`)
})

test('20,000 seeded split reads with 1 to 5 odd tokens in the middle: whatever the guard finds a read in, the fallback names it too (property, round 2 generator)', () => {
  // The generator of the second senior reviewer: a read split in two, with 1 to 5 tokens from this list between the halves and 0 to 2 before.
  const READS = [
    ['security find-generic-pass', 'word -w -s keyprompt'],
    ['secret-to', 'ol lookup service keyprompt'],
    ['Get-Stored', 'Credential -Target keyprompt:X'],
    ['security dump-key', 'chain -d'],
  ]
  const TOKENS = ['$(', ')', '(', '`', '\\', '"', "'", '$((', '))', '#', '<#', '#>', '\n', ' ', ';', '|', '{', '}', '‘', '“', 'x', '\\`', '``', '$', '\\)', '\\(', '`)', '`(', '\\$(', '`$(', '${', '\r\n', "@'", "'@"]
  const rand = seeded(20261112)
  const tokens = (count) => Array.from({ length: count }, () => pick(rand, TOKENS)).join('')
  let found = 0
  for (let n = 0; n < 20000; n++) {
    const [first, second] = pick(rand, READS)
    const command = tokens(between(rand, 0, 2)) + first + tokens(between(rand, 1, 5)) + second
    for (const shell of ['bash', 'powershell', undefined]) {
      const reason = checkCommand(command, SAVED, shell)?.reason
      if (!reason || reason.startsWith(UNREAD_REASON) || reason.startsWith(UNCLOSED_REASON)) continue
      found++
      assert.ok(checkCommand(command, SAVED, shell, 1), `read in full, but the fallback lets it through (${shell ?? 'both'}): ${JSON.stringify(command)}`)
    }
  }
  assert.ok(found > 500, `only ${found} of the generated commands hold a read the guard finds, so the property says little`)
})

// --- Round 3 of the senior review: a `$(` that only an outer reading puts together ------------------------------------------

// An outer reading (eval, a shell's -c) takes out what stands between the `$` and the `(`: adjacent quotes, a backslash, a whole span.
// The inner reading then sees `$(x)` and takes it out of the tool's name. Main refuses each of these at any length.
const ROUND_3 = {
  "adjacent single quotes between $ and (, under bash -c '…'": `bash -c 'security find-generic-pa$''(x)ssword -w -s keyprompt'`,
  'a backslash before $, ( and ), under eval': 'eval security find-generic-pa\\$\\(x\\)ssword -w -s keyprompt',
  'a whole span between $ and (, under eval "…"': 'eval "security find-generic-pa$$(true)(x)ssword -w -s keyprompt"',
  'adjacent double quotes between $ and (, under eval "…"': 'eval "secret-to$""(x)ol lookup service keyprompt"',
  // Round 4 (N2): a backtick span between the `$` and the `(` that itself holds a `$`. Only a `$` that stays remembered until the `(` finds these.
  'a backtick span, holding a $, between $ and (, under eval "…"': 'eval "secret-$`sec$`(x)tool lookup service keyprompt"',
  'the same inside a store subcommand, under eval "…"': 'eval "security find-generic-pa$`find$`(x)ssword -w -s keyprompt"',
}

test('a $( that only an outer reading puts together does not hide the name when the budget runs out (item 17, round 3 of the review of PR #69)', () => {
  for (const [what, command] of Object.entries(ROUND_3)) {
    assert.ok(refusal(command, 'bash').startsWith(READS_REASON), `read in full: ${what}`)
    for (const shell of ['bash', 'powershell', undefined]) {
      const reason = checkCommand(command, SAVED, shell, 1)?.reason
      assert.ok(reason?.startsWith(UNREAD_REASON), `${what} (${shell ?? 'both'}): ${reason?.slice(0, 80)}`)
    }
  }
})

test('the same four, behind about 100 KB that runs the default budget out, are denied through the hook (item 17, round 3)', () => {
  const pad = nestLater('z '.repeat(50000))
  assert.ok(pad.length > 100000)
  for (const [what, command] of Object.entries(ROUND_3)) {
    const out = preToolUse({ tool_name: 'Bash', tool_input: { command: `${pad}; ${command}` } }, SAVED)
    assert.equal(out?.hookSpecificOutput.permissionDecision, 'deny', what)
    assert.ok(out.hookSpecificOutput.permissionDecisionReason.startsWith(UNREAD_REASON), what)
  }
})

// --- The rule of the name check, written out the slow way ----------------------------------------------------------------------

/**
 * Whether `out` can be what is left of `text` when, between two characters of `out`, only whole pieces are left out: a dropped
 * character (backslash, quote, CR, LF, backtick, curly quote); `$` … `(` … `)` or backtick; backtick … backtick or `)`.
 * A blank in `out` stands for anything (a join puts blanks in, and a quoted blank is kept). This is the rule `mentionsRead`
 * in src/guard.mjs states, with sets of states and no bit tricks.
 *
 * @param {string} text
 * @param {string} out
 */
function madeFrom(text, out) {
  const chars = []
  const free = []
  let gapFree = true
  for (const ch of out) {
    if (ch === ' ') gapFree = true
    else {
      chars.push(ch)
      free.push(gapFree)
      gapFree = false
    }
  }
  const n = chars.length
  if (n === 0) return true
  let plain = new Array(n + 1).fill(false)
  const anywhere = new Array(n + 1).fill(false)
  const dollar = new Array(n + 1).fill(false)
  const span = new Array(n + 1).fill(false)
  anywhere[0] = true
  for (const c of text) {
    const code = c.charCodeAt(0)
    const tick = c === '`'
    const dropped = tick || c === '\\' || c === "'" || c === '"' || c === '\r' || c === '\n' || (code >= 0x2018 && code <= 0x201e)
    const next = new Array(n + 1).fill(false)
    for (let k = 0; k <= n; k++) {
      if (k < n && (plain[k] || anywhere[k]) && chars[k] === c) next[k + 1] = true
      if (dropped && plain[k]) next[k] = true
      if ((c === ')' || tick) && span[k]) next[k] = true
    }
    for (let k = 0; k <= n; k++) {
      if (tick && plain[k]) span[k] = true
      if (c === '$' && plain[k]) dollar[k] = true
      if (c === '(' && dollar[k]) span[k] = true
    }
    plain = next
    if (plain[n]) return true
    for (let k = 1; k < n; k++) if (plain[k] && free[k]) anywhere[k] = true
  }
  return false
}
const TOOL_NAMES = ['find-generic-password', 'dump-keychain', 'secret-tool', 'get-storedcredential', 'credread']

test('the parser leaves out of a word only what the name check allows between two letters: every text of up to 4 special characters, every two letters with up to 4 between them, and 20,000 longer texts (the rule, half 1)', () => {
  // The name check is sound because of one fact about splitShell: a command it returns is the text with whole pieces left out, and
  // a nested script is a piece of the text. This checks that fact on splitShell itself, read all four ways. A parser that learns
  // to take something new out of a word (say `${x}`) fails here until the name check in src/guard.mjs allows it too.
  const ALPHABET = ['a', ' ', '\n', '\r', '\\', "'", '"', '`', '$', '(', ')', '#', '<', '>', '“', ';', '{', '\t', '’']
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
  const curly = (text) => text.replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"')
  let readings = 0
  const check = (raw) => {
    // Every letter is a different one, so a letter in a word can only have come from its own place in the text.
    let n = 0
    const text = raw.replace(/a/g, () => LETTERS[n++ % 26])
    for (const powershell of [false, true]) {
      for (const comments of [true, false]) {
        const { commands, nested } = splitShell(text, powershell, comments)
        const from = powershell ? curly(text) : text
        readings++
        for (const words of commands) {
          if (!madeFrom(from, words.join(' '))) assert.fail(`not the text with pieces left out: ${JSON.stringify({ text, powershell, comments, words })}`)
        }
        for (const script of nested) if (!from.includes(script)) assert.fail(`not a piece of the text: ${JSON.stringify({ text, powershell, comments, script })}`)
      }
    }
  }
  const SYMBOLS = ALPHABET.slice(0, 15)
  /** Every text of up to `left` more symbols, each put through `shape`. */
  const all = (text, left, shape) => {
    check(shape(text))
    if (left > 0) for (const symbol of SYMBOLS) all(text + symbol, left - 1, shape)
  }
  all('', 4, (text) => text)
  // What matters is what stands between two letters, so: two letters with up to 4 symbols between them, and the same with up to
  // 3 between them after one symbol that may have opened a quote or a span.
  all('', 4, (text) => `a${text}a`)
  for (const symbol of SYMBOLS) all('', 3, (text) => `${symbol}a${text}a`)
  const rand = seeded(20261113)
  for (let k = 0; k < 20000; k++) check(Array.from({ length: between(rand, 5, 24) }, () => (rand() < 0.25 ? 'a' : pick(rand, ALPHABET))).join(''))
  assert.ok(readings > 700000, `${readings} readings`)
})

test('the name check answers exactly as its rule written out the slow way, on 30,000 seeded texts (the rule, half 2)', () => {
  const TOKENS = ['$', '(', ')', '`', '\\', '"', "'", '\n', '\r', ' ', 'x', '‘', '”', '$(', '$()', ';', '#', '{', 'K', 'K', 'İ']
  const rand = seeded(20261114)
  let yes = 0
  for (let n = 0; n < 30000; n++) {
    const name = pick(rand, ['find-generic-password', 'dump-keychain', 'secret-tool', 'Get-StoredCredential', 'CredRead'])
    let text = pick(rand, ['', 'x', '$', '`', '$('])
    for (let i = 0; i < name.length; i++) {
      for (let k = rand() < 0.15 ? between(rand, 1, 3) : 0; k > 0; k--) text += pick(rand, TOKENS)
      if (rand() < 0.99) text += name[i]
    }
    text += pick(rand, ['', ')', ' y'])
    const rule = TOOL_NAMES.some((tool) => madeFrom(text.toLowerCase(), tool))
    // A budget of 1 character runs out at once, so the answer is the name check's.
    assert.equal(checkCommand(text, SAVED, 'bash', 1) !== null, rule, JSON.stringify(text))
    if (rule) yes++
  }
  assert.ok(yes > 3000 && yes < 27000, `${yes} of 30,000 named a tool, so both answers were tested`)
})

test('9,000 seeded reads, obfuscated and then quoted again for 0 to 3 outer shells: whatever the guard finds a read in, the fallback names it too (property, round 3)', () => {
  // The class the two generators above could not reach: the split name is encoded again for each outer shell (eval, bash -c, sh -lc,
  // pwsh -c, find -exec, $( )), with quotes or backslashes, and sometimes a pair of quotes, a span or a backslash is dropped in at a
  // random place (`$''(`, `$$(true)(`).
  const READS = [
    ['security ', 'find-generic-password', ' -w -s keyprompt'],
    ['security ', 'dump-keychain', ' -d'],
    ['', 'secret-tool', ' lookup service keyprompt'],
    ['', 'Get-StoredCredential', ' -Target keyprompt:X'],
    ['Add-Type x; [Cred]::', 'CredRead', '(1)'],
  ]
  const JUNK = ['$()', '$(true)', '$(x)', '`true`', '``', "''", '""', '\\', '‘’', '“”', '$(echo (x))', '$(a)$(b)', '$((1))', '`$(x)`', '$(\\))', '$(`)', '(x)', '$', '$x', '"$(x)"', "'$(x)'", '$""(x)', "$''(x)", '$$(true)(x)', '\\\n', '`\n']
  const sq = (s) => `'${s.replace(/'/g, `'\\''`)}'`
  const dq = (s) => `"${s.replace(/[\\"$`]/g, '\\$&')}"`
  const dqWeak = (s) => `"${s.replace(/"/g, '\\"')}"` // leaves `$( )` and backticks for this level to take out
  const bs = (s) => s.replace(/[^A-Za-z0-9 \n-]/g, '\\$&')
  const psq = (s) => `'${s.replace(/'/g, "''")}'`
  const pdq = (s) => `"${s.replace(/[`$]/g, '`$&').replace(/"/g, '""')}"`
  const WRAPS = [
    (s) => `eval ${s}`,
    (s) => `eval ${bs(s)}`,
    (s) => `eval ${sq(s)}`,
    (s) => `eval ${dq(s)}`,
    (s) => `eval ${dqWeak(s)}`,
    (s) => `bash -c ${sq(s)}`,
    (s) => `bash -c ${dq(s)}`,
    (s) => `bash -c ${dqWeak(s)}`,
    (s) => `sh -lc ${sq(s)}`,
    (s) => `sh -lc ${dq(s)}`,
    (s) => `pwsh -c ${psq(s)}`,
    (s) => `pwsh -c ${pdq(s)}`,
    (s) => `pwsh -c ${s}`,
    (s) => `powershell -Command ${sq(s)}`,
    (s) => `find . -exec bash -c ${sq(s)} \\;`,
    (s) => `find . -exec sh -c ${dq(s)} \\;`,
    (s) => `echo $(${s})`,
    (s) => `$(${s})`,
    (s) => `x \`${s}\``,
    (s) => `echo "$(${s})"`,
  ]
  const DROPS = ["''", '""', '\\', '$(true)', '`x`', '‘’', '$', '(', ')', '`', "'", '"']
  const rand = seeded(20261115)
  const dropIn = (s) => {
    const at = between(rand, 0, s.length)
    return s.slice(0, at) + pick(rand, DROPS) + s.slice(at)
  }
  let found = 0
  let nested = 0
  for (let n = 0; n < 9000; n++) {
    const [before, name, after] = pick(rand, READS)
    const cuts = [between(rand, 1, name.length - 1)]
    if (rand() < 0.4) cuts.push(between(rand, 1, name.length - 1))
    cuts.sort((a, b) => a - b)
    let command = before
    let last = 0
    for (const cut of cuts) {
      command += name.slice(last, cut) + (rand() < 0.85 ? pick(rand, JUNK) : '')
      last = cut
    }
    command += name.slice(last) + after
    const levels = between(rand, 0, 3)
    for (let level = levels; level > 0; level--) {
      command = pick(rand, WRAPS)(command)
      if (rand() < 0.25) command = dropIn(command)
    }
    for (let k = rand() < 0.3 ? between(rand, 1, 2) : 0; k > 0; k--) command = dropIn(command)
    for (const shell of ['bash', 'powershell', undefined]) {
      const reason = checkCommand(command, SAVED, shell)?.reason
      if (!reason || reason.startsWith(UNREAD_REASON) || reason.startsWith(UNCLOSED_REASON)) continue
      found++
      if (levels >= 2) nested++
      assert.ok(checkCommand(command, SAVED, shell, 1), `read in full, but the fallback lets it through (${shell ?? 'both'}): ${JSON.stringify(command)}`)
    }
  }
  assert.ok(found > 5000, `only ${found} of the generated commands hold a read the guard finds, so the property says little`)
  assert.ok(nested > 1500, `only ${nested} of them sit under two or more outer shells`)
})

test('what the wider name check costs: a $ … ( … ) between the halves of a name is refused past the budget, a blank next to a half is not (item 17, round 3)', () => {
  // Refused, though no shell would put these together: the price of covering `$''(` and `$$(true)(`. Only past the budget or the depth limit.
  for (const command of ['echo secret-$x (y)tool', 'echo find-generic-pass$HOME/a (b)word']) {
    assert.ok(checkCommand(command, SAVED, 'bash', 1)?.reason.startsWith(UNREAD_REASON), command)
    assert.equal(checkCommand(command, SAVED, 'bash'), null, `read in full, it is allowed: ${command}`)
  }
  for (const command of [
    'echo secret- $x (y) tool',
    'echo "the secret-" $(date) "(tool)"',
    'echo find-generic-pass $x (y)word',
    'echo find-generic-pass$x (y) word',
    'echo cred$x (read)',
    'case $tool in secret-) tool=1;; esac',
    'echo "a secret - tool (and $more)"',
  ]) {
    assert.equal(checkCommand(command, SAVED, 'bash', 1), null, command)
  }
})

// --- The property: no long nested shape that names a read comes back as "no read" -----------------------------

/** A small seeded generator (mulberry32), so a failure can be replayed from its seed. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (rand, low, high) => low + Math.floor(rand() * (high - low + 1))
const pick = (rand, list) => list[Math.floor(rand() * list.length)]
const filler = (rand) => Array.from({ length: rand() < 0.05 ? between(rand, 2000, 9000) : between(rand, 0, 300) }, () => pick(rand, ['x', 'z', 'ok', '-n']))
/** @param {string[]} words @param {string} read */
function withRead(rand, words, read) {
  const at = between(rand, 0, words.length)
  return [...words.slice(0, at), read, ...words.slice(at)]
}
/** PowerShell quoting: wrap a script as `pwsh -c '…'`, doubling its quotes. */
const wrap = (script) => `pwsh -c '${script.replace(/'/g, "''")}'`

/** @type {((rand: () => number) => { command: string, shell: 'bash' | 'powershell' | undefined, limit?: number })[]} */
const SHAPES = [
  // eval around a read, five or more deep
  (rand) => ({
    command: withRead(rand, [...Array(between(rand, 5, 40)).fill('eval'), ...filler(rand)], pick(rand, [READ, PS_READ])).join(' '),
    shell: pick(rand, ['bash', undefined]),
  }),
  // pwsh -c over and over, with a read at a random word
  (rand) => ({
    command: withRead(rand, [...Array(between(rand, 5, 60)).fill('pwsh -c'), ...filler(rand)], PS_READ).join(' '),
    shell: pick(rand, ['bash', 'powershell', undefined]),
  }),
  // pwsh -c '…' quoted inside itself, one to eight deep
  (rand) => {
    let script = withRead(rand, filler(rand), PS_READ).join(' ')
    for (let level = between(rand, 1, 8); level > 0; level--) script = wrap(script)
    return { command: script, shell: pick(rand, ['powershell', undefined]) }
  },
  // fake calls that open <# or ', then a real one that runs past a later word named pwsh (item 11)
  (rand) => {
    const fakes = Array.from({ length: between(rand, 1, 6) }, () => `-exec pwsh -c ${pick(rand, ['"<#"', `"'"`])} \\;`)
    const pad = filler(rand).join(' ')
    return { command: `find . ${fakes.join(' ')} ${pad} -exec pwsh -c Write-Output pwsh '; ${PS_READ}' \\;`, shell: pick(rand, ['bash', undefined]) }
  },
  // a tool name split by a $( ) span, a backtick span or curly quotes, in a command the budget cannot finish (review of PR #69)
  (rand) => ({
    command: withRead(rand, filler(rand), pick(rand, Object.values(SPLIT_READS))).join(' '),
    shell: pick(rand, ['bash', 'powershell', undefined]),
    limit: between(rand, 1, 40),
  }),
]

test('1,000 seeded long nested shapes that name a read are each refused inside two seconds (property)', () => {
  const rand = seeded(20261110)
  for (let n = 0; n < 1000; n++) {
    const { command, shell, limit } = SHAPES[n % SHAPES.length](rand)
    const start = Date.now()
    const found = checkCommand(command, SAVED, shell, limit)
    const ms = Date.now() - start
    assert.ok(found, `shape ${n} (${n % SHAPES.length}, ${shell ?? 'both'}, ${command.length} characters) came back as "no read": ${command.slice(0, 200)}`)
    assert.ok(ms < 2000, `shape ${n} took ${ms} ms`)
  }
})
