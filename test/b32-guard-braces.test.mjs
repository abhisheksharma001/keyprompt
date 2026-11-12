import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCommand, splitShell } from '../src/guard.mjs'

// B-32 items 13 and 14 (docs/bugs.md), step S-71: read as Bash, `${…}` and `(( ))` are one piece, so a `#` or a quote inside them starts
// nothing; read as PowerShell, `${…}` is one variable name that ends at the first `}` that no backtick escapes. Every text below is only ever
// passed to checkCommand or splitShell as a string; none is run, and none runs a store read.

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

/** @param {string} text the text read with the new forms (the second reading) */
const formWords = (text, powershell = false, comments = true) => splitShell(text, powershell, comments, undefined, true)

// --- Item 14: `${…}` in Bash -------------------------------------------------------------------------------

test('braces: a `#` inside an unquoted `${…}` starts no comment, so the read after it is seen (item 14)', () => {
  for (const text of [
    // The B-32 forms: the shell runs the read, because `${x:+ #}` expands to nothing.
    `x=; \${x:+ #} ${READ}`,
    `nice \${x:+ #} ${READ}`,
    `eval \${x:+ #} 'timeout 5 ${READ}'`,
    `true \${x:-a #}; timeout 5 ${READ}`,
    // Wider: the first reading dropped the rest of the line after such a `#`, so B-25's own forms after it passed.
    `true \${x:-a #}; find . -exec ${READ} \\;`,
    `true \${x:-a #}; env -u FOO ${READ}`,
    `true \${x:-a #}; ${READ}`,
    `true \${x:-a #}\n${READ}`,
    // The braces nest, a quote or a backslash hides a brace, and a nested substitution is still read.
    `true \${x:-\${y:- #}}; ${READ}`,
    `true \${x:-'}' #}; ${READ}`,
    `true \${x:-"}" #}; ${READ}`,
    `true \${x:-\\} #}; ${READ}`,
    `true \${x:-$(true) #}; ${READ}`,
    `true \${x:-a #}; true \${y:-b #}; ${READ}`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('braces: a read inside `${…}` is read (item 14, acceptance)', () => {
  for (const text of [
    `echo \${x:-$(${READ})}`,
    `echo \${x:-\`${READ}\`}`,
    `echo "\${x:-$(${READ})}"`,
    `echo \${x:-$(true #)}$(${READ})`,
    `x=\${y:-$(${READ})}`,
    `true \${x:-a #} $(${READ})`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('braces: text that only uses `${…}` is let through', () => {
  for (const text of [
    'echo ${HOME}',
    'echo ${x:-a} # ' + READ,
    `echo "\${x:-a}" # ${READ}`,
    '# ' + READ,
    'echo ${x:-"}"} done',
    "echo ${x:-'}'} done",
    'echo ${x:-\\}} done',
    'echo ${x:-${y:-z}} done',
    'echo ${#x} ${x#a} ${x%b} ${x//a/b} ${x:1:2}',
    'ls ${x:+ #} -l',
    'ls ${x:+ #}; echo hi',
    'echo "${x:-a}" \'${y}\' \\${z}',
    "git commit -m 'use ${x:-a #} here'",
  ]) {
    for (const shell of BASH_TOOLS) allowed(text, shell)
  }
})

// --- Item 14: `(( ))` in Bash -------------------------------------------------------------------------------

test('arithmetic: a `#` inside `(( ))` or `$(( ))` starts no comment, so the read after it is seen (item 14)', () => {
  for (const text of [
    `(( 1 # )); ${READ}`,
    `(( x = 1 # )); timeout 5 ${READ}`,
    `((x=1 #\n)); ${READ}`,
    `echo $(( 1 # )); ${READ}`,
    `for ((i=0; i<3; i++)); do ${READ}; done`,
    `if (( 1 # )); then ${READ}; fi`,
    `(( (1 + 2) # )); ${READ}`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('arithmetic: a read inside `(( ))` is read (item 14, acceptance)', () => {
  for (const text of [`(( $(${READ}) ))`, `echo $(( $(${READ}) ))`, `(( \`${READ}\` ))`, `echo "$(( $(${READ}) ))"`]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('arithmetic: text that only uses `(( ))` is let through', () => {
  for (const text of [
    'echo $((1 + 2))',
    'echo $(( 1 #))',
    'echo $(( 1 # ))\nls',
    'for ((i=0; i<3; i++)); do echo $i; done',
    '(( x = 16#ff )); echo $x',
    'if (( 1 )); then echo yes; fi',
    'echo "$(( 1 + 2 ))"',
    'echo $(( (1 + 2) * 3 ))',
    '(echo hi)',
    '((echo hi))',
  ]) {
    for (const shell of BASH_TOOLS) allowed(text, shell)
  }
})

// --- Item 13: `${…}` in PowerShell --------------------------------------------------------------------------

test('PowerShell: a `${…}` name holds quotes, blanks and `#` up to its first unescaped `}`, so the read after it is seen (item 13)', () => {
  for (const text of [
    `Write-Output \${a'}; ${PS_READ}`,
    `Write-Output \${a"}; ${PS_READ}`,
    // The B-32 item reads "up to the next }", and the tokenizer lets a backtick escape the brace (F5: tokenizer.cs, ScanVariable).
    `Write-Output \${a\`}'}; ${PS_READ}`,
    `Write-Output \${a #}; ${PS_READ}`,
    `Write-Output \${a <#}; ${PS_READ} #>`,
    `Write-Output "\${a'}"; ${PS_READ}`,
    `Write-Output "\${a #}"; ${PS_READ}`,
    `\${a'}; ${PS_READ}`,
  ]) {
    for (const shell of PS_TOOLS) denied(text, shell)
  }
})

test('PowerShell: text that only uses `${…}` is let through', () => {
  for (const text of [
    'Write-Output ${env:HOME}',
    "Write-Output ${a'}; Get-Date",
    'Write-Output ${a #}; Get-Date',
    'Write-Output "${a}" ${b}',
    'Write-Output ${a`}b}; Get-Date',
    '# ' + PS_READ,
    'Write-Output ${a} # ' + PS_READ,
  ]) {
    for (const shell of PS_TOOLS) allowed(text, shell)
  }
})

// --- What splitShell returns ---------------------------------------------------------------------------------

test('splitShell: the second reading takes `${…}` and `(( ))` as one word, and a nested substitution inside is still nested', () => {
  assert.deepEqual(formWords('true ${x:-a #}; ls').commands, [['true', '${x:-a #}'], ['ls']])
  assert.deepEqual(formWords('x=; ${x:+ #} cmd').commands, [['x='], ['${x:+ #}', 'cmd']])
  assert.deepEqual(formWords('a${x:-b c}d e').commands, [['a${x:-b c}d', 'e']])
  assert.deepEqual(formWords('${x:-${y:-}} z').commands, [['${x:-${y:-}}', 'z']])
  assert.deepEqual(formWords("${x:-'}' #} z").commands, [["${x:-'}' #}", 'z']])
  assert.deepEqual(formWords('${x:-$(ls)} z').nested, ['ls'])
  assert.deepEqual(formWords('${x:-`ls`} z').nested, ['ls'])
  assert.deepEqual(formWords('(( 1 # )); ls').commands, [['(( 1 # ))'], ['ls']])
  assert.deepEqual(formWords('echo $((1 + 2)) x').commands, [['echo', '$((1 + 2))', 'x']])
  assert.deepEqual(formWords('echo $((1 + 2)) x').nested, [])
  assert.deepEqual(formWords('(( (1 + 2) * 3 )) ls').commands, [['(( (1 + 2) * 3 ))', 'ls']])
  assert.deepEqual(formWords('(( $(ls) ))').nested, ['ls'])
  // A double quote or a quote inside the piece hides what it holds: a brace or a parenthesis there ends nothing.
  assert.deepEqual(formWords('${x:-")"} z').commands, [['${x:-")"}', 'z']])
  assert.deepEqual(formWords('${x:-"}"} z').commands, [['${x:-"}"}', 'z']])
  assert.deepEqual(formWords('${x:-"{"} z').commands, [['${x:-"{"}', 'z']])
  assert.deepEqual(formWords('(( "))" 1 )) z').commands, [['(( "))" 1 ))', 'z']])
  assert.deepEqual(formWords("${x:-'}'} z").commands, [["${x:-'}'}", 'z']])
  assert.deepEqual(formWords("(( ')' 1 )) z").commands, [["(( ')' 1 ))", 'z']])
  // A backslash hides the next character.
  assert.deepEqual(formWords('${x:-\\}} z').commands, [['${x:-\\}}', 'z']])
  assert.deepEqual(formWords('${x:-\\{} z').commands, [['${x:-\\{}', 'z']])
  assert.deepEqual(formWords('(( 1 \\) )) z').commands, [['(( 1 \\) ))', 'z']])
  assert.deepEqual(formWords("${x:-\\'} z").commands, [["${x:-\\'}", 'z']])
  // Inside double quotes a single quote is only a character, so it hides nothing.
  assert.deepEqual(formWords(`"\${x:-a'b}" z`).commands, [["${x:-a'b}", 'z']])
  assert.equal(formWords(`"\${x:-a'b}" z`).open, false)
  assert.deepEqual(formWords(`"$((1 ' 2))" z`).commands, [["$((1 ' 2))", 'z']])
  // Inside double quotes the piece is part of the string.
  assert.deepEqual(formWords('"${x:-a #}" z').commands, [['${x:-a #}', 'z']])
  assert.deepEqual(formWords('"$((1 # ))" z').commands, [['$((1 # ))', 'z']])
  // The first word after a `((` that is not at a word start is read as before.
  assert.deepEqual(formWords('echo a((b)) c').commands, [['echo', 'a'], ['b'], ['c']])
})

test('splitShell: an unfinished `${`, `((` or `$((` is open', () => {
  for (const text of ['echo ${x', 'echo ${x:-"}"', '((1 + 2)', 'echo $((1 + 2)', '${x:-${y}', 'echo "${x']) {
    assert.equal(formWords(text).open, true, text)
  }
  for (const text of ['echo ${x}', '((1 + 2))', 'echo $((1 + 2))', '${x:-${y}}', 'echo "${x}"']) {
    assert.equal(formWords(text).open, false, text)
  }
})

test('splitShell: the first reading is main\'s and says when the second one is needed', () => {
  // The mark is set by every `${`, every `((` where a word starts and every `$((`, outside single quotes and escapes.
  for (const text of ['${x}', 'echo ${x}', 'echo "${x}"', '((1))', 'echo $((1))', 'echo "$((1))"', 'ls; ((1))', 'a=${b:-c}', 'echo "a${b}"', 'echo ((']) {
    assert.equal(splitShell(text).dollar, true, text)
    assert.equal(splitShell(text, false, false).dollar, true, text)
  }
  for (const text of ['echo hi', "echo '${x}'", 'echo \\${x}', 'echo "\\${x}"', '# ${x}', 'echo $x', 'echo a((b))', 'echo $', 'x=$(ls)', 'echo { }']) {
    assert.equal(splitShell(text).dollar, false, text)
  }
  // Main's reading of the text that needs the second one is unchanged: the `#` is a comment, the `'` a quote.
  assert.deepEqual(splitShell('true ${x:-a #}; ls').commands, [['true', '${x:-a']])
  assert.deepEqual(splitShell("Write-Output ${a'}; ls", true).commands, [['Write-Output', '$'], ['a}; ls']])
  assert.equal(splitShell('Write-Output ${a}', true).dollar, true)
  assert.equal(splitShell('Write-Output "${a}"', true).dollar, true)
  assert.equal(splitShell('Write-Output $((1))', true).dollar, false)
  assert.equal(splitShell('Write-Output ((1))', true).dollar, false)
  assert.equal(splitShell("Write-Output '${a}'", true).dollar, false)
})

test('splitShell, PowerShell: the second reading ends a `${…}` name at the first `}` that no backtick escapes', () => {
  assert.deepEqual(formWords("Write-Output ${a'}; ls", true).commands, [['Write-Output', "${a'}"], ['ls']])
  assert.deepEqual(formWords('Write-Output ${a #}; ls', true).commands, [['Write-Output', '${a #}'], ['ls']])
  assert.deepEqual(formWords('Write-Output ${a`}b}; ls', true).commands, [['Write-Output', '${a`}b}'], ['ls']])
  assert.deepEqual(formWords('Write-Output x${a}y z', true).commands, [['Write-Output', 'x${a}y', 'z']])
  assert.deepEqual(formWords('Write-Output "${a"}" z', true).commands, [['Write-Output', '${a"}', 'z']])
  assert.equal(formWords('Write-Output ${a', true).open, true)
  assert.equal(formWords('Write-Output ${a`}', true).open, true)
  assert.equal(formWords('Write-Output ${a}', true).open, false)
  // `$(` and `((` are not read differently in PowerShell.
  assert.deepEqual(formWords('Write-Output $((1)) ((2))', true).commands, splitShell('Write-Output $((1)) ((2))', true).commands)
})

// --- Nothing main refused is let through, and the new reading is only made when needed ---------------------

/** Every text of up to `left` more symbols, each handed to `check`. */
function all(symbols, text, left, check) {
  check(text)
  if (left > 0) for (const symbol of symbols) all(symbols, text + symbol, left - 1, check)
}

test('splitShell says there is a form to read whenever the second reading can differ: every text of up to 6 symbols, as Bash and as PowerShell (the mark, exhaustive)', () => {
  const SYMBOLS = ['$', '{', '}', '(', ')', '#', "'", '`', 'a', ' ']
  let marked = 0
  let texts = 0
  all(SYMBOLS, '', 6, (text) => {
    for (const powershell of [false, true]) {
      for (const comments of [true, false]) {
        const old = splitShell(text, powershell, comments)
        const now = splitShell(text, powershell, comments, undefined, true)
        texts++
        if (old.dollar) {
          marked++
          continue
        }
        if (JSON.stringify(old.commands) !== JSON.stringify(now.commands) || JSON.stringify(old.nested) !== JSON.stringify(now.nested) || old.open !== now.open || old.defines !== now.defines) {
          assert.fail(`not marked, but read differently: ${JSON.stringify({ text, powershell, comments, old, now })}`)
        }
      }
    }
  })
  assert.ok(texts > 1_000_000, `${texts} readings`)
  assert.ok(marked > 10_000 && marked < texts / 2, `${marked} of ${texts} marked, so both answers were tested`)
})

// --- Time ------------------------------------------------------------------------------------------------

/** @param {() => void} run @returns {number} the middle of three timings in ms */
function median3(run) {
  const times = []
  for (let k = 0; k < 3; k++) {
    const start = performance.now()
    run()
    times.push(performance.now() - start)
  }
  return times.sort((a, b) => a - b)[1]
}

test('reading the braces costs time in step with a text of the same length: 200 KB of each shape', () => {
  const n = 40_000
  for (const [what, shape, flat, powershell] of [
    ['${…} pieces', '${x:-a #}\n'.repeat(n), 'x{x:-a #}\n'.repeat(n), false],
    ['${ open', '${x:-'.repeat(n), 'x{x:-'.repeat(n), false],
    ['${ nested', '${x:-'.repeat(n) + '}'.repeat(n), 'x{x:-'.repeat(n) + '}'.repeat(n), false],
    ['${ with quotes', "${x:-'}'} ".repeat(n), 'x{x:-a} '.repeat(n), false],
    ['${ with a lone "', '${x:-"} '.repeat(n), 'x{x:-a} '.repeat(n), false],
    ['${ with a lone \'', "${x:-'} ".repeat(n), 'x{x:-a} '.repeat(n), false],
    ['${ with $( in it', '${x:-$(a)} '.repeat(n), 'x{x:-$(a)} '.repeat(n), false],
    ['${ with ( in it', '${x:-(} '.repeat(n), 'x{x:-a} '.repeat(n), false],
    ['(( pieces', '(( 1 # ))\n'.repeat(n), 'x( 1 # ))\n'.repeat(n), false],
    ['(( open', '((1 '.repeat(n), 'x(1 '.repeat(n), false],
    ['(( nested', '(('.repeat(n) + '))'.repeat(n), 'x('.repeat(n) + '))'.repeat(n), false],
    ['$(( pieces', 'echo $(( 1 # ))\n'.repeat(n), 'echo $( 1 # )\n'.repeat(n), false],
    ['$(( open', '$(('.repeat(n), '$( '.repeat(n), false],
    ['PowerShell ${ pieces', '${a #}\n'.repeat(n), 'x{a #}\n'.repeat(n), true],
    ['PowerShell ${ open', '${a`'.repeat(n), 'x{a`'.repeat(n), true],
    ['PowerShell backticks', '${a`}'.repeat(n), 'x{a`}'.repeat(n), true],
  ]) {
    const base = median3(() => splitShell(flat, powershell, true, undefined, true))
    const took = median3(() => splitShell(shape, powershell, true, undefined, true))
    assert.ok(took < 4 * base + 300, `${what}: ${took.toFixed(0)} ms against ${base.toFixed(0)} ms for the same length`)
    const old = median3(() => splitShell(shape, powershell, true))
    assert.ok(old < 4 * base + 300, `${what} (first reading): ${old.toFixed(0)} ms against ${base.toFixed(0)} ms for the same length`)
  }
})

test('checkCommand reads 200 KB of braces and parentheses well inside the hook\'s timeout, and the work stays in budget', () => {
  const n = 20_000
  for (const unit of ['${x:-a #}\n', '(( 1 # ))\n', '${x:-', '((1 ', '$((', "${x:-'} ", 'a ${x:-$(b)} ']) {
    const text = unit.repeat(n)
    const start = performance.now()
    checkCommand(text, SAVED)
    checkCommand(text, SAVED, 'bash')
    checkCommand(text, SAVED, 'powershell')
    const took = performance.now() - start
    assert.ok(took < 5000, `${JSON.stringify(unit)}: ${took.toFixed(0)} ms for three readings of ${text.length} characters`)
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
