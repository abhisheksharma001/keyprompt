import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCommand, splitShell } from '../src/guard.mjs'

// B-32 items 9 and 15 (docs/bugs.md), step S-72: where a `#` starts a comment.
//  - Item 15 (Bash): a line continuation (backslash and newline) is taken out before the shell reads the text, so a `#` after one is a comment only
//    if it would be one without the continuation. The guard took the newline of the continuation for a real line break.
//  - Item 9 (Bash and PowerShell): a `#` right after `(` or `)` starts a comment in one place and is part of a word in another, so the text is
//    read both ways.
// Every text below is only ever passed to checkCommand or splitShell as a string; none is run, and none runs a store read.

const SAVED = ['OPENAI_API_KEY']
const READ = 'security find-generic-password -s keyprompt -w'
const PS_READ = 'Get-StoredCredential -Target keyprompt:X'

/** @param {string} command @param {'bash' | 'powershell' | undefined} [shell] */
function denied(command, shell) {
  const found = checkCommand(command, SAVED, shell)
  assert.ok(found, `should refuse (${shell ?? 'both ways'}): ${JSON.stringify(command)}`)
  assert.match(found.reason, /keyprompt guard: this command (reads a secret|prints every secret)/, command)
}

/** @param {string} command @param {'bash' | 'powershell' | undefined} [shell] */
function allowed(command, shell) {
  assert.equal(checkCommand(command, SAVED, shell), null, `should let through (${shell ?? 'both ways'}): ${JSON.stringify(command)}`)
}

/** The Bash tool, and the Monitor tool (read both ways), are the two that read Bash. */
const BASH_TOOLS = ['bash', undefined]
/** The PowerShell tool, and Monitor, are the two that read PowerShell. */
const PS_TOOLS = ['powershell', undefined]

// --- Item 15: a `#` after a line continuation ----------------------------------------------------------------

test('continuation: a `#` after a backslash-newline that follows a word or a substitution is no comment in Bash (item 15)', () => {
  for (const text of [
    // Bash joins the two lines, so the `#` sits inside the word `$(true)#`: `; timeout 5 <read>` runs.
    `true $(true)\\\n# ; timeout 5 ${READ}`,
    `true <(true)\\\n# ; timeout 5 ${READ}`,
    `true \`true\`\\\n# ; timeout 5 ${READ}`,
    `a=(x)\\\n# ; timeout 5 ${READ}`,
    // Wider: the same with a word, a quote, or two continuations in a row before the `#`.
    `true abc\\\n# ; timeout 5 ${READ}`,
    `true 'a b'\\\n# ; timeout 5 ${READ}`,
    `true "a b"\\\n# ; timeout 5 ${READ}`,
    `true abc\\\n\\\n# ; timeout 5 ${READ}`,
    `true $(true)\\\n# ; ${READ}`,
    `true $(true)\\\n# ; env -u FOO ${READ}`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('continuation: a `#` after a continuation that follows a blank or a separator is still a comment (item 15)', () => {
  for (const text of [
    `ls \\\n# ${READ}`,
    `ls\t\\\n# ${READ}`,
    `ls ;\\\n# ${READ}`,
    `ls |\\\n# ${READ}`,
    `ls &&\\\n# ${READ}`,
    `ls \\\n\\\n# ${READ}`,
    `ls\n\\\n# ${READ}`,
    `\\\n# ${READ}`,
  ]) {
    for (const shell of BASH_TOOLS) allowed(text, shell)
  }
})

test('continuation: a backslash that is itself escaped is no continuation, and the newline after it is a real line break (item 15)', () => {
  // `\\` is one backslash and the newline after it ends the command, so the `#` that follows starts a comment.
  for (const shell of BASH_TOOLS) allowed(`ls \\\\\n# ${READ}`, shell)
  for (const shell of BASH_TOOLS) allowed(`ls abc\\\\\n# ${READ}`, shell)
})

test('continuation: `splitShell` leaves a `#` after a joined word as a word, and after a joined blank as a comment (item 15)', () => {
  assert.deepEqual(splitShell('x\\\n# y; z', false, true).commands, [['x#', 'y'], ['z']])
  assert.deepEqual(splitShell('x \\\n# y; z', false, true).commands, [['x']])
  assert.deepEqual(splitShell('x;\\\n# y\nz', false, true).commands, [['x'], ['z']])
  // Main's reading (no comments) is unchanged.
  assert.deepEqual(splitShell('x\\\n# y; z', false, false).commands, [['x', '#', 'y'], ['z']])
})

// --- Item 9: a `#` right after `(` or `)` ------------------------------------------------------------------------

test('paren: a `#` right after `)` or `(` starts a comment in one shell, so a quote after it cannot hide the next line (item 9)', () => {
  for (const text of [
    `(true)# don't\n${READ}`,
    `(# don't\n${READ}\n)`,
    `(true)# don't\ntimeout 5 ${READ}`,
    `(true)# don't\nenv -u FOO ${READ}`,
    `(true)# don't\nfind . -exec ${READ} \\;`,
    `(true)# "\n${READ}`,
    `true; (true)# don't\n${READ}`,
    `(true)# don't\n(${READ})`,
    // Inside a script that a command runs, a substitution or a backtick pair.
    `eval '(true)# don'"'"'t\n${READ}'`,
    `true $( (true)# don't\n${READ}\n)`,
    `bash -c '(true)# don'"'"'t\n${READ}'`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('paren: the same in PowerShell, where `(`, `)` and a `#` after them are read both ways (item 9)', () => {
  for (const text of [
    `(1)# don't\n${PS_READ}`,
    `(# don't\n${PS_READ}\n)`,
    `(1)# "\n${PS_READ}`,
    `Write-Output (1)# don't\n${PS_READ}`,
  ]) {
    for (const shell of PS_TOOLS) denied(text, shell)
  }
})

test('paren: the locked forms that put the read after the `#` on the same line are still refused (item 9, acceptance)', () => {
  for (const text of [`cat <(true)# ; ${READ}`, `a=(x)# ; ${READ}`, `ls (#i)README ; ${READ}`, `(true)# ; ${READ}`, `(# ; ${READ}\n)`]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
  for (const text of [`(1)# ; ${PS_READ}`, `Write-Output (1)# ; ${PS_READ}`]) {
    for (const shell of PS_TOOLS) denied(text, shell)
  }
})

test('paren: a real comment after `)` or `(` that names no read is let through, and so is a blank before the `#` (item 9)', () => {
  for (const text of [`(true)# just a note`, `(# just a note\ntrue\n)`, `(true) # ${READ}`, `(true) # don't\nls`, `ls (true)# a note\nls`]) {
    for (const shell of BASH_TOOLS) allowed(text, shell)
  }
  for (const text of [`(1)# just a note`, `(1) # don't\nGet-Date`]) {
    for (const shell of PS_TOOLS) allowed(text, shell)
  }
})

test('paren: `splitShell` marks a `#` that follows `(` or `)` and reads it as a comment only when asked (item 9)', () => {
  const plain = splitShell("(a)# b'\nc", false, true)
  assert.equal(plain.paren, true)
  assert.deepEqual(plain.commands, [['a'], ["#", "b\nc"]])
  const both = splitShell("(a)# b'\nc", false, 'paren')
  assert.deepEqual(both.commands, [['a'], ['c']])
  assert.equal(both.paren, false)
  // No mark when the `#` follows a blank or a separator (a comment in every reading), a word, or sits in quotes.
  for (const text of ['(a) # b', 'a # b', 'a;# b', 'a# b', "(a '#' b)", 'echo "(#)"', '(a)\n# b', '(a)', '#']) {
    assert.equal(splitShell(text, false, true).paren, false, text)
    assert.equal(splitShell(text, true, true).paren, false, text)
  }
  // Main's reading (no comments) never marks and never reads a comment.
  assert.equal(splitShell('(a)# b', false, false).paren, false)
  assert.deepEqual(splitShell('(1)# b', true, 'paren').commands, [['1']])
})

// --- Time and size ---------------------------------------------------------------------------------------------

test('paren: a long text with no `#` after a parenthesis is read once, and one with many is still read in bounded time', () => {
  const none = 'a (b) c; '.repeat(20000)
  const marked = '(a)# b\n'.repeat(20000)
  for (const text of [none, marked]) {
    const started = process.cpuUsage()
    checkCommand(text, SAVED, 'bash')
    const used = process.cpuUsage(started)
    assert.ok((used.user + used.system) / 1000 < 5000, `took too long: ${(used.user + used.system) / 1000} ms`)
  }
})
