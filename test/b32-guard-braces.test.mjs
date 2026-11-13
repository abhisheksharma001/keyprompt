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
const formWords = (text, powershell = false, comments = true) => splitShell(text, powershell, comments, undefined, true, true)

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
  // A nested expansion inside the double quotes of a piece is no level of its own: no brace counts there.
  assert.deepEqual(formWords('${x:-"${y}"} z').commands, [['${x:-"${y}"}', 'z']])
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
  // Inside double quotes a single quote is only a character in this reading (zsh 5.9 reads it so; bash 3.2.57 starts a quote, which the
  // `bashq` reading does, see the test below), so it hides nothing here.
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
    assert.equal(splitShell(text).braces, true, text)
    assert.equal(splitShell(text, false, false).braces, true, text)
  }
  for (const text of ['echo hi', "echo '${x}'", 'echo \\${x}', 'echo "\\${x}"', '# ${x}', 'echo $x', 'echo a((b))', 'echo $', 'x=$(ls)', 'echo { }']) {
    assert.equal(splitShell(text).braces, false, text)
  }
  // Main's reading of the text that needs the second one is unchanged: the `#` is a comment, the `'` a quote.
  assert.deepEqual(splitShell('true ${x:-a #}; ls').commands, [['true', '${x:-a']])
  assert.deepEqual(splitShell("Write-Output ${a'}; ls", true).commands, [['Write-Output', '$'], ['a}; ls']])
  assert.equal(splitShell('Write-Output ${a}', true).braces, true)
  assert.equal(splitShell('Write-Output "${a}"', true).braces, true)
  assert.equal(splitShell('Write-Output $((1))', true).braces, false)
  assert.equal(splitShell('Write-Output ((1))', true).braces, false)
  assert.equal(splitShell("Write-Output '${a}'", true).braces, false)
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

// --- Found by the diff review of this step ---------------------------------------------------------------

test('a `$\'…\'` string inside a piece ends at its own closing quote, so a `\\\'` in it does not open a quote that swallows the read (review finding 1)', () => {
  for (const text of [
    `x=; \${x:+$'\\'' #} ${READ}`,
    `x=; \${x:+$'\\\\' #} ${READ}`,
    `x=; \${x:+$'a\\'b' #} ${READ}`,
    `x=; $(( 1 + $'\\'' # )); ${READ}`,
    `x=; \${x:+$\\\n'\\'' #} ${READ}`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
  assert.deepEqual(formWords(`\${x:+$'\\'' #} z`).commands, [[`\${x:+$'\\'' #}`, 'z']])
  // Inside double quotes `$'` is plain text, and a lone quote after it is a character there.
  assert.deepEqual(formWords(`"\${x:+$'a} z" y`).commands, [[`\${x:+$'a} z`, 'y']])
})

test('line continuations between the characters of an opener are taken out first, as the shell does (review finding 2)', () => {
  for (const text of [
    `x=; $\\\n{x:+ #} ${READ}`,
    `x=; $\\\n\\\n{x:+ #} ${READ}`,
    `(\\\n( 1 # )); ${READ}`,
    `echo $\\\n(( 1 # )); ${READ}`,
    `echo $(\\\n( 1 # )); ${READ}`,
    `echo $\\\n(\\\n( 1 # )); ${READ}`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
  assert.deepEqual(formWords('$\\\n{x:+ #} z').commands, [['$\\\n{x:+ #}', 'z']])
  assert.deepEqual(formWords('"$\\\n{x:-a #}" z').commands, [['$\\\n{x:-a #}', 'z']])
  assert.equal(splitShell('$\\\n{x}').braces, true)
  assert.equal(splitShell('(\\\n(x))').braces, true)
  assert.equal(splitShell('echo $\\\n((x))').braces, true)
  // A continuation in PowerShell is a backtick, and `$` then a continuation is not a variable name.
  assert.equal(splitShell('$\\\n{x}', true).braces, false)
})

test('a bare `{` inside `${…}` ends nothing in bash and is one more level in zsh, so the text is read both ways (review finding 5)', () => {
  // bash 3.2.57 runs the command after the first one (checked with echo); zsh 5.9 counts the brace (`[${x:-{a} b}]` is one word there).
  // The first two run only in bash, the second two only in zsh, and nothing but the third reading shows the read in either.
  for (const text of [`nice \${x:+ #{} ${READ}`, `nice \${x:+ {} #} ${READ}`, `true \${x:-a #{}; ${READ}`, `true \${x:-a {} #}; ${READ}`, `true \${x:-a {b} #}; ${READ}`, `true \${x:-{{a} #}}; ${READ}`]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
  const bashWay = formWords('${x:-{a} b} z')
  assert.deepEqual(bashWay.commands, [['${x:-{a}', 'b}', 'z']])
  assert.equal(bashWay.bare, true)
  const zshWay = splitShell('${x:-{a} b} z', false, true, undefined, true, 'zsh')
  assert.deepEqual(zshWay.commands, [['${x:-{a} b}', 'z']])
  // No bare brace, nothing to read the other way.
  assert.equal(formWords('${x:-${y}} z').bare, false)
  assert.equal(formWords('${x:-a} z').bare, false)
  assert.equal(formWords('(( 1 )) { z').bare, false)
})

test('what is not an opener is not read as one: no piece starts at a `$` or a `(` that something else follows (mutation run)', () => {
  // A character between the `$` and the brace or parenthesis, a backslash that is not before a newline, and a word before a `(`.
  for (const text of ['$a\n{x}', '$a{x}', '$\\a{x}', '$\\\\{x}', 'echo $a(b)', 'echo $\\a((b))', 'echo a((b))', 'echo $x(( 1 ))', '$ {x}']) {
    assert.equal(splitShell(text).braces, false, text)
  }
  // A continuation is taken out once, and only a backslash before a newline is one.
  assert.equal(splitShell('$\\\n\\\n{x}').braces, true)
  assert.equal(splitShell('$\\\n\\a{x}').braces, false)
  assert.deepEqual(formWords('$a\n{x} z').commands, [['$a'], ['{x}', 'z']])
  // A `${` inside `(( ))` is not a level of its own: the parentheses are what count there.
  assert.deepEqual(formWords('(( ${x} )) ls').commands, [['(( ${x} ))', 'ls']])
  assert.deepEqual(formWords('(( (1) * (2) )) ls').commands, [['(( (1) * (2) ))', 'ls']])
  // The same inside `$(( ))`, which has its own opener.
  assert.deepEqual(formWords('echo $(( (1 + 2) * 3 )) z').commands, [['echo', '$(( (1 + 2) * 3 ))', 'z']])
  assert.deepEqual(formWords('echo $(( (1) * (2) )) z').commands, [['echo', '$(( (1) * (2) ))', 'z']])
})

test('the zsh reading reads the forms of S-70 as well: a `$\'…\'` name after a piece that only zsh closes late', () => {
  // bash ends `${x:+ {}` at the first `}` and zsh at the second; only the zsh reading shows the command, and in it `sec$\'ur\'ity` is `security`.
  for (const text of [`nice \${x:+ {} #} sec$'ur'ity find-generic-password -s keyprompt -w`, `nice \${x:+ {} #} $'security' find-generic-password -s keyprompt -w`]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

// --- Nothing main refused is let through, and the new reading is only made when needed ---------------------

test('the third reading is added to the second, it does not replace it: texts that S-70\'s reading refuses stay refused when a `${` or `((` swallows the rest', () => {
  // Found by the differential run on the first build of this step: 25 texts in 600,000 that main refused and that build let through, because
  // an unfinished `${` made one piece to the end of the text and hid the `$'…'` read that S-70's reading found (B-32 item 45).
  for (const text of [
    `\${x:-($''${READ}'\${x:+ #}$(}$`,
    `\${x:+ #}x=\${x:+ #}${PS_READ}|$'\\\n$''${READ}'}`,
    `\${x:- # @{\n$''${READ}'@"find . -exec`,
    `@""@\\;\${&&$@{|$''${READ}'#)`,
    `bash -c\${&$''${READ}'\${x:- \nWrite-Output@{$(${READ})`,
    `((1 $''${READ}'`,
    `$((1 $''${READ}'`,
  ]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('a single quote inside a piece in double quotes starts a quote in bash 3.2.57 and is a plain character in zsh 5.9, so the text is read both ways (senior review, finding 2)', () => {
  // Checked with echo in place of the read: `echo "${x:-'}"'}" ; echo RAN` prints RAN in bash 3.2.57 and is an error in zsh 5.9.
  for (const text of [`echo "\${x:-'}"'}" ; ${READ}`, `echo "\${x:-'}"'}" ; nice \${x:+ #} ${READ}`, `x=; echo "\${x:-'}"'}"; timeout 5 ${READ}`]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
  const quote = `echo "\${x:-'}"'}" ; z`
  assert.equal(splitShell(quote, false, true, undefined, true, true).sq, true)
  // The bash reading takes `'}"'` as a quote inside the string, which ends at the second `"`; the other one ends the string at the first
  // `"` and the `'` after it opens a quote that runs to the end of the text, so the command after it is never seen.
  assert.deepEqual(splitShell(quote, false, true, undefined, true, 'bashq').commands, [['echo', `\${x:-'}"'}`], ['z']])
  assert.deepEqual(splitShell(quote, false, true, undefined, true, true).commands, [['echo', `\${x:-'}}" ; z`]])
  // Only a quote inside a piece that sits in double quotes is noted.
  for (const text of [`echo '\${x}' z`, `echo "\${HOME}'s" z`, `echo \${x:-'a'} z`, `echo "\${x:-a}" 'b' z`]) {
    assert.equal(splitShell(text, false, true, undefined, true, true).sq, false, text)
    allowed(text, 'bash')
  }
})

// B-32 item 46 (senior review of PR #81, blocker 1): the extra readings spent the work budget main's own readings needed. A text with a
// few thousand `${a:-{}` pieces made the third reading's commands, read again at every `eval` depth, use the whole budget before main's reading
// reached the read; the fallback (a name check) does not know the shape of item 39 (`fi\$\'nd\'`), so the text was let through. Bash 3.2.57 runs it.
const READ_39 = `security fi\\$\\'nd\\'-generic-password -s keyprompt -w`

test('the extra readings never use the budget main\'s readings need: a long run of `${a:-{}` before an obfuscated read is still refused (senior review, blocker 1)', () => {
  for (const copies of [3500, 5000]) {
    const pieces = Array(copies).fill('${a:-{}').join(' ')
    for (const shell of BASH_TOOLS) denied(`eval eval eval eval ${pieces}; eval ${READ_39}`, shell)
  }
})

test('the extra readings never use the budget main\'s readings need: with the read first and the budget cut to what main\'s two readings need, the read is still refused', () => {
  // Main reads the text twice (the second time with the `$'…'` form read) and finds the read; a third reading of the same length must not
  // take what is left. The budget is two readings of the text and a little more.
  for (const piece of ['${a{} ', '${a:-{} ', '(( ']) {
    const text = `eval ${READ_39}; ${piece.repeat(200)}`
    for (const shell of BASH_TOOLS) {
      const found = checkCommand(text, SAVED, shell, 2 * text.length + 10)
      assert.ok(found, `should refuse (${shell ?? 'both ways'}, budget ${2 * text.length + 10}): ${piece}`)
    }
  }
})

test('the first two readings are main\'s word for word inside double quotes, and the mark is not set by text that holds no form (mutation run)', () => {
  // Inside double quotes the first and second readings do not take a `${…}` or `$((…))` as a piece; only the third does. These are main's words.
  assert.deepEqual(splitShell('"${x:-"} z').commands, [['${x:-}', 'z']])
  assert.deepEqual(splitShell('"${x:-"} z', false, true, undefined, true).commands, [['${x:-}', 'z']])
  assert.deepEqual(splitShell('"$((1 "))" z').commands, [['', 'z']])
  assert.deepEqual(splitShell('"$((1 "))" z', false, true, undefined, true).commands, [['']])
  // A `((` inside double quotes is no opener, in any reading.
  assert.deepEqual(formWords(`"(( ' x" z`).commands, [[`(( ' x`, 'z']])
  for (const text of ['"a" z', '"((a))" z', '"a ((b))" z', `"(( 1 ' x" z`, 'echo "$a(b)"']) {
    assert.equal(splitShell(text).braces, false, text)
    assert.equal(formWords(text).braces, false, text)
  }
})

test('the third reading and the bash-quote reading read S-70\'s `$\'…\'` forms too: a `$\'security\'` after a piece is seen (mutation run)', () => {
  for (const text of [`nice \${x:+ #} $'security' find-generic-password -s keyprompt -w`, `echo "\${x:-'}"'}" ; $'security' find-generic-password -s keyprompt -w`]) {
    for (const shell of BASH_TOOLS) denied(text, shell)
  }
})

test('the second pass is made for a command of exactly a megabyte and not for one character more (mutation run)', () => {
  const hidden = `nice \${x:+ #} ${READ}`
  const exact = hidden + ' '.repeat(1_000_000 - hidden.length)
  assert.equal(exact.length, 1_000_000)
  assert.match(checkCommand(exact, SAVED, 'bash')?.reason ?? '', /this command reads a secret/)
  assert.match(checkCommand(`${exact} `, SAVED, 'bash')?.reason ?? '', /too long or too deeply nested/)
})

test('the second pass has a budget of its own: with 3 times the text, a read behind `${x:+ #}` is found by the brace readings, not given up on as too long', () => {
  // The first pass (main's readings) uses about twice the text; a second pass that shared what was left would run out and fall back to the
  // name check, which refuses with another message ("too long"). Measured: the window is 2 to 3.75 times the text (a mutation run).
  for (const text of [`nice \${x:+ #} ${READ}`, `x=; \${x:+ #} ${READ}`, `true \${x:-a #}; env -u FOO ${READ}`]) {
    const found = checkCommand(text, SAVED, 'bash', 3 * text.length)
    assert.ok(found, text)
    assert.match(found.reason, /this command reads a secret/, text)
  }
})

test('a command longer than a megabyte does not get the second pass, so the extra reading never narrows the hook\'s time margin; one that names a read tool is refused, one that does not is let through', () => {
  const padding = '${a}x '
  const hidden = `nice \${x:+ #} ${READ}`
  // Short enough for the second pass: the brace forms find the read behind the `#`.
  denied(`${padding.repeat(1000)}; ${hidden}`, 'bash')
  // Past the limit the pass is not made, and the name check refuses the command because it names the read tool.
  const long = `${padding.repeat(200_100)}; ${hidden}`
  assert.ok(long.length > 1_000_000)
  assert.match(checkCommand(long, SAVED, 'bash')?.reason ?? '', /too long or too deeply nested/)
  // The same length without a read tool in it is let through.
  const benign = padding.repeat(200_100)
  assert.ok(benign.length > 1_000_000)
  allowed(benign, 'bash')
})

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
        const now = splitShell(text, powershell, comments, undefined, true, true)
        texts++
        if (old.dollar || old.braces) {
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


test('reading the braces costs time in step with a plain text of the same length: 200 KB of each shape', () => {
  // Each shape is repeated to about 200 KB and timed against 200 KB of plain words, read the same way. A scan made again for each piece (the
  // mistake S-70's first build made, B-32 item 43) takes seconds on these, and the line below is a few hundred milliseconds.
  for (const [what, unit, powershell] of [
    ['${…} pieces', '${x:-a #}\n', false],
    ['${ open', '${x:-', false],
    ['${ closing late', '${x:-a ', false],
    ['${ with quotes', "${x:-'}'} ", false],
    ['${ with a lone "', '${x:-"} ', false],
    ['${ with a lone \'', "${x:-'} ", false],
    ['${ with $( in it', '${x:-$(a)} ', false],
    ['${ with a ( in quotes in a $( in it', "${x:-$(')')} ", false],
    ['${ with a ( in it', '${x:-(} ', false],
    ['(( pieces', '(( 1 # ))\n', false],
    ['(( open', '((1 ', false],
    ['(( with a ) in quotes', "(( ')' 1 ))\n", false],
    ['$(( pieces', 'echo $(( 1 # ))\n', false],
    ['$(( open', '$((', false],
    ['$(( with $( in it', 'echo $(( $(a) ))\n', false],
    ['PowerShell ${ pieces', '${a #}\n', true],
    ['PowerShell ${ open', '${a`', true],
    ['PowerShell backticks', '${a`}', true],
  ]) {
    const text = unit.repeat(Math.ceil(200_000 / unit.length))
    const flat = 'x '.repeat(Math.ceil(text.length / 2))
    const base = median3(() => splitShell(flat, powershell, true, undefined, true, true))
    const took = median3(() => splitShell(text, powershell, true, undefined, true, true))
    assert.ok(took < 4 * base + 500, `${what}: ${took.toFixed(0)} ms against ${base.toFixed(0)} ms for the same length`)
    const old = median3(() => splitShell(text, powershell, true))
    assert.ok(old < 4 * base + 500, `${what} (first reading): ${old.toFixed(0)} ms against ${base.toFixed(0)} ms for the same length`)
  }
})

test('checkCommand reads 200 KB of braces and parentheses well inside the hook\'s timeout', () => {
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

