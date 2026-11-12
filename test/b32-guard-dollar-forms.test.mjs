import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCommand, splitShell } from '../src/guard.mjs'

// B-32 items 2, 3 and 20 (docs/bugs.md), step S-70: read as Bash, `$'…'` is an ANSI-C string, a `$` that a line continuation joins to `(`
// or `'` is `$(` or `$'`, and quotes and comments inside `$( )` start no ending of it. Every text below is only ever passed to checkCommand
// or splitShell as a string; none is run, and none runs a store read.

const SAVED = ['OPENAI_API_KEY']
const READ = 'security find-generic-password -s keyprompt -w'

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

/** @param {string} text the text read with the dollar forms (the third reading, S-70) */
const dollarWords = (text, comments = true) => splitShell(text, false, comments, undefined, true)

// --- Item 2: `$'…'` ----------------------------------------------------------------------------------------

test('ansi: `$\'…\'` is one string, and a backslash-quote inside it does not end it (item 2)', () => {
  for (const text of [
    // The B-32 form: the string is the one character `'`, so the `#'` after the read is a comment and the read runs.
    `true $'\\'' ; ${READ} #'`,
    `true $'\\'' ; ${READ} # '`,
    `echo $'it\\'s' ; ${READ} #'`,
    `true $'\\\\' ; ${READ} #'`,
    `true $'\\\\\\'' ; ${READ} #'`,
    // The command name written that way keeps no `$`.
    `$'security' find-generic-password -s keyprompt -w`,
    `$'secu'rity find-generic-password -s keyprompt -w`,
    `secu$'rity' find-generic-password -s keyprompt -w`,
    `security $'find-generic-password' -s keyprompt -w`,
    `$'security' find-generic-password -s $'keyprompt' -w`,
    `env $'security' find-generic-password -s keyprompt -w`,
    `eval $'security' find-generic-password -s keyprompt -w`,
    `bash -c "$'security' find-generic-password -s keyprompt -w"`,
    `echo ok; $'security' find-generic-password -s keyprompt -w`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('ansi: an unfinished `$\'…` string is open, and the escapes in it are kept as written, never decoded (item 2, limit)', () => {
  assert.deepEqual(dollarWords(`$'security' x`).commands, [['security', 'x']])
  assert.deepEqual(dollarWords(`a$'b\\'c'd e`).commands, [["ab'cd", 'e']])
  assert.deepEqual(dollarWords(`a$'b\\\\c'd e`).commands, [['ab\\cd', 'e']])
  // Any other escape stays as written: `\x73` is the four characters, not the letter s. S-59's docs name this as a limit.
  assert.deepEqual(dollarWords(`$'\\x73ecurity' x`).commands, [['\\x73ecurity', 'x']])
  assert.deepEqual(dollarWords(`$'a\\nb' x`).commands, [['a\\nb', 'x']])
  // A blank, a `;` or a newline inside the string is text.
  assert.deepEqual(dollarWords(`$'a b;c\nd' x`).commands, [['a b;c\nd', 'x']])
  assert.equal(dollarWords(`x $'abc`).open, true)
  assert.equal(dollarWords(`x $'abc\\'`).open, true)
  assert.equal(dollarWords(`x $'abc'`).open, false)
  // Inside double quotes `$'` is plain text, and inside single quotes too.
  assert.deepEqual(dollarWords(`"$'a'" b`).commands, [["$'a'", 'b']])
  assert.deepEqual(dollarWords(`'$'a'' b`).commands, [["$a", 'b']])
})

test('ansi: Bash tool text only; the PowerShell reading is the one main made (item 2, PowerShell: no change)', () => {
  // PowerShell has no ANSI-C string: `$'` is a variable sign and a quote. What main answers for these, it still answers.
  for (const text of [`true $'\\'' ; ${READ} #'`, `$'security' find-generic-password -s keyprompt -w`, `$'secu'rity find-generic-password -s keyprompt -w`]) {
    allowed(text, 'powershell')
  }
  const same = splitShell(`$'security' x`, true)
  assert.deepEqual(same.commands, [["$security", 'x']])
  assert.equal(same.dollar, false)
  assert.deepEqual(splitShell(`$'security' x`, true, true, undefined, true).commands, same.commands)
})

// --- Item 3: quotes and comments inside `$( )` ------------------------------------------------------------

test('subshell: a quoted ) or a comment inside $( ) does not end it (item 3)', () => {
  for (const text of [
    `echo $(echo ')'; ${READ})`,
    `echo $(echo "x)" ; ${READ})`,
    `echo $(echo \\) ; ${READ})`,
    `echo $(echo "$(echo ')')" ; ${READ})`,
    `echo "$(echo ')'; ${READ})"`,
    `echo "$(# )" "\n${READ})"`,
    `echo $(# )\n${READ})`,
    `echo $(true # )\n${READ})`,
    `echo $(true ; # ' \n${READ})`,
    `echo $(echo $'\\')'; ${READ})`,
    `echo x $(true ;echo '(' ; ${READ})`,
    `echo x $(echo "(" ; ${READ})`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('subshell: what it skips is quoted text, double-quoted text, a backslash pair and a comment, and $( ) in double quotes still counts (item 3)', () => {
  const nested = (text) => dollarWords(text).nested
  assert.deepEqual(nested(`x $(a ')' b) c`), [`a ')' b`])
  assert.deepEqual(nested(`x $(a ")" b) c`), [`a ")" b`])
  assert.deepEqual(nested(`x $(a \\) b) c`), ['a \\) b'])
  assert.deepEqual(nested(`x $(a "$(b ")")" c) d`), ['a "$(b ")")" c'])
  assert.deepEqual(nested(`x $(a # )\nb) c`), ['a # )\nb'])
  // A `#` that follows a word is no comment: `$#`, `${#x}` and `a#b` keep the parenthesis counting.
  assert.deepEqual(nested(`x $(a$# ) b`), ['a$# '])
  assert.deepEqual(nested(`x $(a#b ) c`), ['a#b '])
  assert.deepEqual(nested(`x $(a (b) ) c`), ['a (b) '])
  assert.deepEqual(nested(`x $(a $((1)) ) c`), ['a $((1)) '])
  // Unfinished: the rest of the text is the script, and the text is open.
  assert.equal(dollarWords(`x $(a ')' b`).open, true)
  assert.deepEqual(nested(`x $(a ')' b`), [`a ')' b`])
  assert.equal(dollarWords(`x $(a 'b)`).open, true)
})

// --- Item 20: a line continuation between `$` and `(` -----------------------------------------------------

test('join: a $ that a line continuation joins to ( is $( (item 20)', () => {
  for (const text of [
    `echo "$\\\n(${READ})"`,
    `echo "$\\\n\\\n(${READ})"`,
    `echo "x$\\\n(${READ})y"`,
    `echo $\\\n(${READ})`,
    `echo $\\\n\\\n(${READ})`,
    `a=$\\\n(${READ})`,
    `echo $\\\n'security' find-generic-password -s keyprompt -w`,
    `$\\\n'security' find-generic-password -s keyprompt -w`,
    `true $\\\n'\\'' ; ${READ} #'`,
    `echo "$\\\n(echo ')' ; ${READ})"`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('join: a $ before a continuation and then anything else stays a plain character', () => {
  assert.deepEqual(dollarWords(`a$\\\nb c`).commands, [['a$b', 'c']])
  assert.deepEqual(dollarWords(`"a$\\\nb" c`).commands, [['a$b', 'c']])
  // The \\r\\n pair is no continuation in Bash.
  assert.deepEqual(dollarWords(`"a$\\\r\n(b)" c`).nested, [])
})

// --- Nothing else changes -----------------------------------------------------------------------------------

test('the Bash reading does not refuse text that only uses these forms', () => {
  for (const text of [
    `echo $'security find-generic-password -s keyprompt -w'`,
    `echo $'${READ}'`,
    `printf '%s' $'a\\'b'`,
    `echo $(echo ')')`,
    `echo $(echo ')'; ls)`,
    `echo "$(# )" "\nls)"`,
    `echo "$\\\n(ls)"`,
    `echo $\\\n(ls)`,
    `ls $'a b' $'c'`,
    `grep -r $'foo\\'bar' src`,
    `git commit -m $'fix: it\\'s done'`,
    `echo $(true # it's\nls)`,
    `x=$'a'; y=$(echo "b)"); echo $x $y`,
  ]) {
    for (const shell of BASH_TOOLS) allowed(text, shell)
  }
})

test('PowerShell: answers on the dollar forms are the ones main gave (the PowerShell reading has no change)', () => {
  // Read as PowerShell (the PowerShell tool, or Monitor), the Bash-only forms are plain text exactly as before.
  for (const text of [`echo $(echo ')'; ${READ})`, `echo "$(# )" "\n${READ})"`, `echo "$\\\n(${READ})"`]) allowed(text, 'powershell')
  // A continuation in PowerShell is a backtick, and that reading was already refusing this one.
  denied(`$\\\n'security' find-generic-password -s keyprompt -w`, 'powershell')
  denied(`echo $\\\n(${READ})`, 'powershell')
})

// --- The third reading is the old reading when there is nothing new to read -----------------------------

/** Every text of up to `left` more symbols, each handed to `check`. */
function all(symbols, text, left, check) {
  check(text)
  if (left > 0) for (const symbol of symbols) all(symbols, text + symbol, left - 1, check)
}

test('splitShell says there is a dollar form when, and only when, the new reading can differ: every text of up to 6 symbols (the mark, exhaustive)', () => {
  const SYMBOLS = ['$', "'", '"', '#', '\\', '\n', '(', ')', 'a']
  let texts = 0
  let marked = 0
  all(SYMBOLS, '', 6, (text) => {
    for (const comments of [true, false]) {
      const old = splitShell(text, false, comments)
      const now = splitShell(text, false, comments, undefined, true)
      texts++
      if (old.dollar) {
        marked++
        continue
      }
      // Not marked: the new reading must be the old one, word for word.
      if (JSON.stringify(old.commands) !== JSON.stringify(now.commands) || JSON.stringify(old.nested) !== JSON.stringify(now.nested) || old.open !== now.open || old.defines !== now.defines) {
        assert.fail(`not marked, but read differently: ${JSON.stringify({ text, comments, old, now })}`)
      }
    }
  })
  assert.ok(texts > 1_000_000, `${texts} readings`)
  assert.ok(marked > 100_000 && marked < texts, `${marked} of ${texts} marked, so both answers were tested`)
})

test('the mark and the new reading, on 40,000 seeded longer texts of 12 kinds of symbol (the mark, random)', () => {
  const SYMBOLS = ['$', "'", '"', '#', '\\', '\n', '(', ')', 'a', ' ', ';', '`', '$(', "$'", '\\\n']
  const rand = seeded(20261120)
  for (let n = 0; n < 40000; n++) {
    const text = Array.from({ length: between(rand, 5, 40) }, () => pick(rand, SYMBOLS)).join('')
    for (const comments of [true, false]) {
      const old = splitShell(text, false, comments)
      const now = splitShell(text, false, comments, undefined, true)
      if (!old.dollar && (JSON.stringify(old.commands) !== JSON.stringify(now.commands) || JSON.stringify(old.nested) !== JSON.stringify(now.nested) || old.open !== now.open)) {
        assert.fail(`not marked, but read differently: ${JSON.stringify({ text, comments })}`)
      }
      // Read as PowerShell nothing is ever marked, and the flag changes nothing.
      const ps = splitShell(text, true, comments)
      assert.equal(ps.dollar, false)
      assert.deepEqual(splitShell(text, true, comments, undefined, true).commands, ps.commands)
    }
  }
})

// --- The name check past the limits (S-67's N5 warning) ---------------------------------------------------

/** A script 5 levels down, in `$( )` spans: the guard does not read that deep, so it answers from the name check alone. The text of a span is
 * kept as written (the outer levels decode nothing of it), so a `$'…'` in it reaches the name check as it stands. */
const deep = (/** @type {string} */ inner) => `${'echo $('.repeat(5)}${inner}${')'.repeat(5)}`

test('fallback: past the depth limit, a name that a `$\'…\'` rebuilds is found (S-67 round 4, N5)', () => {
  for (const inner of [
    `security fi$'nd'-generic-password -s keyprompt -w`,
    `security find$'-'generic-password -s keyprompt -w`,
    `secret$'-'tool lookup service keyprompt`,
    `se$'cret-tool lookup service keyprompt`,
    `security dump-key$'chain' -d`,
    `security fi$\\\n'nd'-generic-password -s keyprompt -w`,
    `Get-Stored$'Credential' -Target keyprompt:X`,
  ]) {
    for (const shell of BASH_TOOLS) {
      const found = checkCommand(deep(inner), SAVED, shell)
      assert.ok(found, `should refuse (${shell ?? 'both ways'}): ${deep(inner)}`)
      assert.match(found.reason, /too long or too deeply nested/)
    }
  }
})

test('fallback: a command that runs out of work is refused when a name is rebuilt that way (S-67 round 4, N5)', () => {
  for (const text of [`security fi$'nd'-generic-password -s keyprompt -w`, `se$'cret'-tool lookup service keyprompt`, `Get-Stored$'Credential' -Target keyprompt:X`]) {
    const found = checkCommand(text, SAVED, 'bash', 1)
    assert.ok(found, text)
    assert.match(found.reason, /too long or too deeply nested/)
  }
})

test('fallback: a $ that is not before a quote still breaks a name, as before', () => {
  for (const inner of [`echo se$cret-tool lookup service keyprompt`, `echo secret$-tool lookup service keyprompt`, `echo find$x-generic-password`, `echo se$"cret-tool"`]) {
    for (const shell of BASH_TOOLS) allowed(deep(inner), shell)
  }
})

/** Whether `out` is what is left of `text` when only whole pieces are left out between two of its characters: the rule of
 * test/b32-guard-unfinished.test.mjs, with one more piece (S-70): a `$` that stands before a quote, or before line continuations
 * and a quote, which the Bash reading takes out. A blank in `out` stands for anything. */
function madeFromAnsi(text, out) {
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
  for (let at = 0; at < text.length; at++) {
    const c = text[at]
    const code = c.charCodeAt(0)
    const tick = c === '`'
    let before = false
    if (c === '$') {
      let k = at + 1
      while (text[k] === '\\' && text[k + 1] === '\n') k += 2
      before = text[k] === "'"
    }
    const dropped = tick || before || c === '\\' || c === "'" || c === '"' || c === '\r' || c === '\n' || (code >= 0x2018 && code <= 0x201e)
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

test('fallback, half 1: what the new reading leaves out of a word is only what the rule allows: every text of up to 4 special characters, every two letters with up to 4 between them, and 20,000 longer texts', () => {
  const ALPHABET = ['a', ' ', '\n', '\\', "'", '"', '`', '$', '(', ')', '#', ';']
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
  const SYMBOLS = ALPHABET.slice(1)
  let readings = 0
  const check = (raw) => {
    // Every letter is a different one, so a letter in a word can only have come from its own place in the text.
    let n = 0
    const text = raw.replace(/a/g, () => LETTERS[n++ % 26])
    for (const comments of [true, false]) {
      const { commands, nested } = splitShell(text, false, comments, undefined, true)
      readings++
      for (const words of commands) {
        if (!madeFromAnsi(text, words.join(' '))) assert.fail(`not the text with pieces left out: ${JSON.stringify({ text, comments, words })}`)
      }
      for (const script of nested) if (!text.includes(script)) assert.fail(`not a piece of the text: ${JSON.stringify({ text, comments, script })}`)
    }
  }
  all(SYMBOLS, '', 4, check)
  all(SYMBOLS, '', 4, (text) => check(`a${text}a`))
  for (const symbol of SYMBOLS) all(SYMBOLS, '', 3, (text) => check(`${symbol}a${text}a`))
  const rand = seeded(20261121)
  for (let k = 0; k < 20000; k++) check(Array.from({ length: between(rand, 5, 24) }, () => (rand() < 0.25 ? 'a' : pick(rand, ALPHABET))).join(''))
  assert.ok(readings > 100000, `${readings} readings`)
})

test('fallback, half 2: the name check answers exactly as the rule written out the slow way, on 30,000 seeded texts that hold `$\'` between the letters of a name', () => {
  const TOKENS = ["$'", "'", '$', '\\\n', '$\\\n', '(', ')', '`', '"', ' ', 'x', '$(', ';', "$''"]
  const rand = seeded(20261122)
  let yes = 0
  for (let n = 0; n < 30000; n++) {
    const name = pick(rand, ['find-generic-password', 'dump-keychain', 'secret-tool', 'Get-StoredCredential', 'CredRead'])
    let text = pick(rand, ['', 'x', '$', '`', '$('])
    for (let i = 0; i < name.length; i++) {
      for (let k = rand() < 0.2 ? between(rand, 1, 3) : 0; k > 0; k--) text += pick(rand, TOKENS)
      if (rand() < 0.99) text += name[i]
    }
    text += pick(rand, ['', ')', ' y', "'"])
    const rule = TOOL_NAMES.some((tool) => madeFromAnsi(text.toLowerCase(), tool))
    // A budget of 1 character runs out at once, so the answer is the name check's.
    assert.equal(checkCommand(text, SAVED, 'bash', 1) !== null, rule, JSON.stringify(text))
    if (rule) yes++
  }
  assert.ok(yes > 3000 && yes < 27000, `${yes} of 30,000 named a tool, so both answers were tested`)
})

// --- Linear time ----------------------------------------------------------------------------------------------

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

test('reading the dollar forms costs time in step with a text of the same length: 200 KB of each shape, and 1,000 seeded texts', () => {
  const n = 40_000
  for (const [what, shape, flat] of [
    ['$\' strings', "$'a\\'b' ".repeat(n), "x'a\\'b' ".repeat(n)],
    ['$( ) with quotes', "$(a ')' b) ".repeat(n), '$(a ) b) '.repeat(n)],
    ['$( ) with comments', '$(a # )\nb) '.repeat(n), '$(a x )\nb) '.repeat(n)],
    ['$( open', "$(a ')' ".repeat(n), '$(a ) '.repeat(n)],
    ['$( nested', '$(a '.repeat(n) + ')'.repeat(n), '$(b '.repeat(n) + ')'.repeat(n)],
    ['$( nested in double quotes', '"$(a '.repeat(n) + '")'.repeat(n), '"$(b '.repeat(n) + '")'.repeat(n)],
    ['continuations', '$\\\n'.repeat(n * 2) + "'a'", 'x\\\n'.repeat(n * 2) + "'a'"],
    ['comments', "$(# ' \n".repeat(n), '$(x x \n'.repeat(n)],
    ['quote runs', "$'".repeat(n * 2), "x'".repeat(n * 2)],
    ['backslash runs', "$'\\".repeat(n * 2), "x'\\".repeat(n * 2)],
  ]) {
    const base = median3(() => splitShell(flat, false, true, undefined, true))
    const took = median3(() => splitShell(shape, false, true, undefined, true))
    assert.ok(took < 4 * base + 300, `${what}: ${took.toFixed(0)} ms against ${base.toFixed(0)} ms for the same length`)
    const old = median3(() => splitShell(shape, false, true))
    assert.ok(old < 4 * base + 300, `${what} (old reading): ${old.toFixed(0)} ms against ${base.toFixed(0)} ms for the same length`)
  }
  const rand = seeded(20261123)
  const PIECES = ["$'", '$(', "'", '"', '#', '\\', '\n', ')', 'a ', '$\\\n']
  const texts = Array.from({ length: 1000 }, () => Array.from({ length: between(rand, 50, 4000) }, () => pick(rand, PIECES)).join(''))
  const chars = texts.reduce((sum, text) => sum + text.length, 0)
  const flats = texts.map((text) => 'a'.repeat(text.length))
  const base = median3(() => flats.forEach((text) => splitShell(text, false, true, undefined, true)))
  const took = median3(() => texts.forEach((text) => splitShell(text, false, true, undefined, true)))
  assert.ok(took < 6 * base + 500, `${chars} characters: ${took.toFixed(0)} ms against ${base.toFixed(0)} ms for the same length`)
})

/** @param {string} text @returns {number} the smallest work budget (in steps of 10%) with which the guard lets the text through, as Bash */
function budgetNeeded(text) {
  let budget = text.length
  while (checkCommand(text, SAVED, 'bash', Math.ceil(budget)) !== null) budget *= 1.1
  return Math.ceil(budget)
}

test('a nested text full of dollar forms needs no more than a small multiple of the work budget of a text of the same length without any', () => {
  // The text names a read tool without running one, so it is let through only if the budget lasts; one that runs out is refused.
  const nest = (/** @type {string} */ unit, /** @type {number} */ length) => `eval eval eval ${unit.repeat(Math.ceil(length / unit.length))}find-generic-password`
  const length = 100_000
  const flat = budgetNeeded(nest('z ', length)) / nest('z ', length).length
  for (const unit of ["$'a' ", '$(a ) ', "$(a ')') ", '$(a # )\nb) ', '$\\\n(a) ']) {
    const text = nest(unit, length)
    const per = budgetNeeded(text) / text.length
    // The dollar forms add a second reading of the text, and nothing more at each level.
    assert.ok(per < 3 * flat, `reading ${JSON.stringify(unit)} words needed ${per.toFixed(1)} steps for each character against ${flat.toFixed(1)} for the same length of plain words`)
  }
})

// --- Seeded generators --------------------------------------------------------------------------------------

/** @param {number} seed @returns {() => number} a small deterministic generator (mulberry32) */
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
const between = (/** @type {() => number} */ rand, /** @type {number} */ low, /** @type {number} */ high) => low + Math.floor(rand() * (high - low + 1))
const pick = (/** @type {() => number} */ rand, /** @type {any[]} */ list) => list[Math.floor(rand() * list.length)]
