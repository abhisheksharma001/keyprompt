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

test('continuation: the `join` reading leaves a `#` after a joined word as a word, and after a joined blank as a comment (item 15)', () => {
  const join = (text) => splitShell(text, false, 'join').commands
  assert.deepEqual(join('x\\\n# y; z'), [['x#', 'y'], ['z']])
  assert.deepEqual(join('x \\\n# y; z'), [['x']])
  assert.deepEqual(join('x;\\\n# y\nz'), [['x'], ['z']])
  // After a substitution or backticks no word is open, so only the flag tells a joined `#` from one after a blank.
  assert.deepEqual(join('x $(a)\\\n# y; z'), [['x', '#', 'y'], ['z']])
  assert.deepEqual(join('x `a`\\\n# y; z'), [['x', '#', 'y'], ['z']])
  assert.deepEqual(join('x $(a) \\\n# y; z'), [['x']])
  assert.deepEqual(join('x $(a)\n# y; z'), [['x']])
  // Main's reading (no comments) reads the joined word the same way, and a `#` after a blank as a plain word.
  assert.deepEqual(splitShell('x\\\n# y; z', false, false).commands, [['x#', 'y'], ['z']])
  assert.deepEqual(splitShell('x \\\n# y; z', false, false).commands, [['x', '#', 'y'], ['z']])
})

test('continuation: the first reading is main\'s, and notes a `#` that the join reading reads another way (item 15)', () => {
  // The line break of a backslash-newline still counts as a line break here, as it did on main: the answer does not change.
  assert.deepEqual(splitShell('x $(a)\\\n# y; z', false, true).commands, [['x']])
  assert.equal(splitShell('x $(a)\\\n# y; z', false, true).hashJoined, true)
  assert.equal(splitShell('x `a`\\\n# y; z', false, true).hashJoined, true)
  // No mark when the two readings read the `#` the same way: after a real blank or separator, in a word, in quotes, or in PowerShell.
  for (const text of ['x $(a) \\\n# y', 'x $(a)\n# y', 'x\\\n# y', 'x;\\\n# y', "x '\\\n#' y", '# y', 'x # y']) assert.equal(splitShell(text, false, true).hashJoined, false, text)
  assert.equal(splitShell('x $(a)`\n# y', true, true).hashJoined, false)
  assert.deepEqual(splitShell('x $(a)`\n# y; z', true, true).commands, [['x']])
})

test('continuation: a text main refused is still refused when the join reading would have read its `#` as a word (item 15, differential)', () => {
  // Found by the differential run on this step's first build, which replaced main's comment test: there `(` + continuation + `#don't` was no
  // comment, so the quote hid the read that main (which took the `#` for a comment and read `(# $(<read>)` as a word) refused.
  for (const text of [
    `$((\\\n#don't\n(# $(${READ})timeout 5trueecho`,
    `(\\\n#don't\n(# $(${READ})`,
    `(\\\n#don't\n(# $(${READ})\n)`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
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

test('budget: the join and paren readings never use the work that main\'s readings need (senior review of PR #81, item 46)', () => {
  // The first build read these in main's own pass; the budget ran out before main's reading reached the read, and the name check that
  // follows did not know its shape (`fi\$\'nd\'`). Main refuses all of them; found by a sweep of lowered budgets.
  const obfuscated = "eval security fi\\$\\'nd\\'-generic-password -s keyprompt -w"
  for (const wrap of ['eval ', 'eval eval ']) {
    for (const copies of [16, 24]) {
      const text = `${wrap}${'$(a)\\\n# '.repeat(copies)}\n${obfuscated}`
      for (const shell of BASH_TOOLS) {
        const found = checkCommand(text, SAVED, shell, Math.floor(1.5 * text.length) + 10)
        assert.ok(found, `should refuse (${shell ?? 'both ways'}, ${copies} copies, ${wrap.trim()}): ${JSON.stringify(text)}`)
      }
    }
  }
})

test('budget: a marked script read before a later one does not use the work the later one needs (the extras have a pass of their own)', () => {
  // Each `$(true $(a)<continuation>#…)` holds a `#` that the join reading reads another way. Made in main's own pass, that reading used the
  // budget that the last substitution, which holds an obfuscated read, needed. Main refuses it; found by a sweep of lowered budgets.
  const obfuscated = "eval security fi\\$\\'nd\\'-generic-password -s keyprompt -w"
  for (const copies of [2, 4]) {
    const text = `${'$(true $(a)\\\n# y) '.repeat(copies)}$(${obfuscated})`
    for (const shell of BASH_TOOLS) {
      const found = checkCommand(text, SAVED, shell, 4 * text.length + 10)
      assert.ok(found, `should refuse (${shell ?? 'both ways'}, ${copies} copies): ${JSON.stringify(text)}`)
    }
  }
})

test('both kinds of `#` in one text: the join reading asks for the paren reading, so a quote cannot hide a read after either (items 9 and 15)', () => {
  for (const text of [
    `true $(a)\\\n# x\n(true)# don't\n${READ}`,
    `(true)# don't\ntrue $(a)\\\n# x\n${READ}`,
    `true $(a)\\\n# x\n(# don't\n${READ}\n)`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('powershell: a backtick-newline stays a blank (unchanged from main), and a `#` after `{`, `}` or a carriage return is not noted', () => {
  // The join reading is Bash only. PowerShell's own continuation is treated as main treated it; `{` and `}` are left as main read them.
  allowed(`(1)#x\nWrite-Output $(1)\`\n# ${PS_READ}`, 'powershell')
  assert.equal(splitShell('{#b', true, true).paren, false)
  assert.equal(splitShell('}#b', true, true).paren, false)
  assert.equal(splitShell('a\r#b', false, true).paren, false)
})

test('size: the extra readings are made up to 1,000,000 characters; past that a command that names a read tool is refused, as for S-71', () => {
  const read = `(true)# don't\n${READ}`
  const padded = (length) => `${read}${' '.repeat(length - read.length)}`
  // At the limit the extra pass runs and finds the read behind the quote; one character past it, the command is refused as too long to read.
  assert.match(checkCommand(padded(1000000), SAVED, 'bash')?.reason ?? '', /reads a secret/)
  assert.match(checkCommand(padded(1000001), SAVED, 'bash')?.reason ?? '', /too long or too deeply nested/)
  // Past the limit, a text that names no read tool is let through, as on main.
  assert.equal(checkCommand(`(true)# don't\nls${' '.repeat(1000001)}`, SAVED, 'bash'), null)
})

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
