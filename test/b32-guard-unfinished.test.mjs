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
// The tail rule's sentence: the approved one says "too long or too deeply nested", which is not true of a tail that opens a quote.
const UNCLOSED_REASON =
  "keyprompt guard: this command has text after a PowerShell `-c` or `-Command` flag that opens a quote or block comment and never closes it, so the guard cannot finish reading it, and it names the OS password store's read tool, so it is refused."

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

/** @type {((rand: () => number) => { command: string, shell: 'bash' | 'powershell' | undefined })[]} */
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
]

test('1,000 seeded long nested shapes that name a read are each refused inside two seconds (property)', () => {
  const rand = seeded(20261110)
  for (let n = 0; n < 1000; n++) {
    const { command, shell } = SHAPES[n % SHAPES.length](rand)
    const start = Date.now()
    const found = checkCommand(command, SAVED, shell)
    const ms = Date.now() - start
    assert.ok(found, `shape ${n} (${n % SHAPES.length}, ${shell ?? 'both'}, ${command.length} characters) came back as "no read": ${command.slice(0, 200)}`)
    assert.ok(ms < 2000, `shape ${n} took ${ms} ms`)
  }
})
