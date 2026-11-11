import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCommand, splitShell } from '../src/guard.mjs'

// B-32 items 1, 4, 10 and 12 (docs/bugs.md), step S-68: the guard finds the real command word. Every command below is only
// ever passed to checkCommand as a string; none is run, and none of them runs a store read.

const SAVED = ['OPENAI_API_KEY']
const READ = 'security find-generic-password -s keyprompt -w'
const PS_READ = 'Get-StoredCredential -Target keyprompt:X'

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

// --- Item 1: a function or alias can redefine a text-only name --------------------------------------------

test('a command that defines a function or alias is refused when a text-only name then runs a read (item 1)', () => {
  for (const text of [
    `echo() { "$@"; }; echo ${READ}`,
    `echo () { "$@"; }; echo ${READ}`,
    `echo(){ "$@"; }; echo ${READ}`,
    `echo() ( "$@" ); echo ${READ}`,
    `function grep { "$@"; }; grep ${READ}`,
    `function echo { "$@" }; echo ${READ}`,
    `alias echo=eval; echo ${READ}`,
    `alias cat='eval'; cat "${READ}"`,
    // The words are read after quotes and escapes are taken out, so spelling the definition around them does not hide it.
    `e''cho() { "$@"; }; echo ${READ}`,
    `ec\\ho() { "$@"; }; echo ${READ}`,
    `fun''ction echo { "$@"; }; echo ${READ}`,
    `"function" echo { "$@"; }; echo ${READ}`,
    // The definition inside a script the command runs, or after the text-only command.
    `bash -c 'echo() { "$@"; }; echo ${READ}'`,
    `eval 'echo() { "$@"; }; echo ${READ}'`,
    `echo ${READ}; echo() { "$@"; }`,
    `printf() { "$@"; }
printf ${READ}`,
  ]) {
    denied(text, 'bash')
    denied(text, undefined)
  }
})

test("PowerShell's function and alias commands count too (item 1)", () => {
  for (const text of [
    `function Write-Output { Invoke-Expression "$args" }; Write-Output ${PS_READ}`,
    `Function Write-Host { & @args }; Write-Host ${PS_READ}`,
    `Set-Alias Write-Output Invoke-Expression; Write-Output "${PS_READ}"`,
    `New-Alias echo iex; echo "${PS_READ}"`,
    `sal echo iex; echo "${PS_READ}"`,
    `nal echo iex; echo "${PS_READ}"`,
  ]) {
    denied(text, 'powershell')
    denied(text, undefined)
  }
})

test('text-only commands still pass when nothing in the command defines a function or alias (item 1, locked)', () => {
  for (const text of [`echo ${READ}`, `grep -r "${READ}" docs/`, `printf '%s' "${READ}"`, `cat notes.txt | grep find-generic-password`, `echo "empty ()"`]) {
    allowed(text, 'bash')
  }
  for (const text of [`Write-Output "${PS_READ}"`, `Write-Host ${PS_READ}`]) allowed(text, 'powershell')
})

test('a function or alias in the command does not refuse a command that names no read (item 1)', () => {
  for (const text of ['echo() { "$@"; }; echo hello', 'function grep { "$@"; }; grep foo file.txt', 'alias ll="ls -l"; echo hi', 'a=(1 2 3); echo "${a[@]}"', 'cat <(true) | grep x']) {
    allowed(text, 'bash')
  }
  allowed('function Write-Output { "x" }; Write-Output hello', 'powershell')
})

// --- Item 4: the script after bash's and zsh's -c is the first word that is not an option --------------------

test('the script after -c is found past `--`, option words and option values (item 4)', () => {
  for (const text of [
    `bash -c -- '${READ}'`,
    `bash -c -e '${READ}'`,
    `bash -c -e -u '${READ}'`,
    `bash -c -e -- '${READ}'`,
    `sh -c -o errexit '${READ}'`,
    `sh -c +o errexit '${READ}'`,
    `bash -c -O extglob '${READ}'`,
    `bash -c +O extglob '${READ}'`,
    `zsh -c -O extglob '${READ}'`,
    `bash -co errexit '${READ}'`,
    `bash -cO extglob '${READ}'`,
    `bash -c -o errexit -o nounset '${READ}'`,
    `bash -c -ex '${READ}'`,
    `sudo bash -c -- '${READ}'`,
    `env FOO=1 zsh -c -- "${READ}"`,
    `bash -c - '${READ}'`,
  ]) {
    denied(text, 'bash')
    denied(text, undefined)
  }
})

test('a script that names no read after -c and its options is let through (item 4)', () => {
  for (const text of [`bash -c -- 'ls -l'`, `bash -c -e 'echo hello'`, `sh -c -o errexit 'true'`, `bash -c -O extglob 'ls'`, `bash -c -- 'echo ${READ}'`]) {
    allowed(text, 'bash')
  }
})

test('a long run of option words after -c is read in time proportional to its length (item 4)', () => {
  const options = '-e '.repeat(200000)
  const start = Date.now()
  const found = checkCommand('bash '.repeat(2000) + '-c ' + options + `'${READ}'`, SAVED, 'bash')
  assert.ok(found, 'a read at the end of 200,000 options is refused')
  assert.ok(Date.now() - start < 6000, `took ${Date.now() - start} ms`)
})

// --- Item 10: `security -p` takes a value ---------------------------------------------------------------------

test("`security`'s -p takes the next word as its prompt, so the subcommand comes after it (item 10)", () => {
  for (const text of [
    `security -p x find-generic-password -s keyprompt -w`,
    `security -px find-generic-password -s keyprompt -w`,
    `security -qp x find-generic-password -s keyprompt -w`,
    `security -qpx find-generic-password -s keyprompt -w`,
    `security -i -p prompt find-generic-password -s keyprompt -w`,
    `security -v -p x -q find-generic-password -g -s keyprompt`,
    `security -p x dump-keychain -d`,
    `security -p x -p y find-generic-password -s keyprompt -w`,
    `sudo security -p x find-generic-password -s keyprompt -w`,
    `security -p find-generic-password -s keyprompt -w`,
    `security -p x find-generic-password -s OPENAI_API_KEY -w`,
  ]) {
    denied(text, 'bash')
    denied(text, undefined)
  }
})

test('`security -p` with another subcommand, or one that does not name keyprompt, is let through (item 10)', () => {
  for (const text of [
    `security -p x find-generic-password -s other -w`,
    `security -p x list-keychains`,
    `security -q -p x default-keychain`,
    `security find-generic-password -s other -w`,
  ]) {
    allowed(text, 'bash')
  }
})

test('a long chain of `-p` options is read in time proportional to its length (item 10)', () => {
  const chain = 'security -p '.repeat(100000)
  const start = Date.now()
  const found = checkCommand(chain + 'x find-generic-password -s keyprompt -w', SAVED, 'bash')
  assert.ok(found, 'a read behind the last -p value is refused')
  assert.ok(Date.now() - start < 6000, `took ${Date.now() - start} ms`)
})

// --- Item 12: zsh's precommand modifiers and `repeat` --------------------------------------------------------

test('eval behind a zsh precommand modifier, or `repeat N`, is read as the command (item 12)', () => {
  for (const text of [
    `noglob eval "${READ}"`,
    `nocorrect eval "${READ}"`,
    `coproc eval "${READ}"`,
    `- eval "${READ}"`,
    `repeat 1 eval "${READ}"`,
    `repeat 2 eval ${READ}`,
    `repeat $((1+1)) eval "${READ}"`,
    `repeat $(true) eval "${READ}"`,
    `repeat "$(true)" eval "${READ}"`,
    `repeat n eval "${READ}"`,
    `repeat $n eval "${READ}"`,
    `repeat 1 repeat 1 eval "${READ}"`,
    `repeat 1 noglob eval "${READ}"`,
    `noglob repeat 1 eval "${READ}"`,
    `repeat $(true) sudo -u root eval "${READ}"`,
    `repeat $(true) noglob eval "${READ}"`,
    `repeat $(true) env -i eval "${READ}"`,
    `repeat eval eval "${READ}"`,
    `builtin noglob eval "${READ}"`,
    `sudo noglob eval "${READ}"`,
    `FOO=1 noglob eval "${READ}"`,
    `repeat 1 do eval "${READ}"; done`,
  ]) {
    denied(text, 'bash')
    denied(text, undefined)
  }
})

test('a precommand modifier or `repeat` before a command that names no read is let through (item 12)', () => {
  for (const text of [`noglob ls *.txt`, `nocorrect git status`, `repeat 3 echo hi`, `repeat 2 eval "ls"`, `coproc cat`]) {
    allowed(text, 'bash')
  }
})

test('the modifiers only help find `eval`: text-only commands behind them are refused as before (item 12, tighten only)', () => {
  // Main refuses these, because the command's first word is `noglob` or `repeat`, which is not text-only. They stay refused.
  for (const text of [`noglob echo ${READ}`, `repeat 1 echo ${READ}`, `nocorrect grep ${READ} file`]) {
    denied(text, 'bash')
  }
})

test('eval behind a modifier is read word by word as well, because joining the words can change how they read (item 12, tighten only)', () => {
  // Read as PowerShell, the stray quote closes the first string and the rest is plain words, so main reads a store read there. Joined with
  // blanks and read as bash text, the same words start with `echo`, which is text-only. Reading the joined script alone would let it through.
  for (const text of [
    'noglob eval "echo \\" eval security find-generic-password -g -s OPENAI_API_KEY"',
    'repeat 1 eval "echo \\" eval security find-generic-password -g -s OPENAI_API_KEY"',
    'nocorrect eval "echo \\" eval secret-tool lookup service keyprompt"',
  ]) {
    denied(text, 'powershell')
    denied(text, undefined)
  }
})

// --- The pieces behind the rules, pinned one by one --------------------------------------------------------------

test('splitShell says a text defines a function or alias only for a word that does (item 1)', () => {
  const defines = (/** @type {string} */ text, powershell = false) => splitShell(text, powershell).defines
  for (const text of ['f() { :; }', 'f () { :; }', 'f ( ) { :; }', 'f\t()', 'f( )', 'f(\t)', 'f(  \t )', 'f ( \t) ', 'x; f() :', 'echo() ( x )', 'e\'\'cho()', 'function x', 'FUNCTION x', 'Function x', 'alias a=b', 'Set-Alias a b', 'new-alias a b', 'sal a b', 'NAL a b', 'fun""ction x', 'fun\\ction x']) {
    assert.equal(defines(text), true, text)
  }
  for (const text of ['', 'echo hi', 'a=()', 'a=( )', 'cat <()', 'cat >()', 'true; ()', 'true;()', 'true\n()', 'true | ()', '(())', '(( x ))', ' ()', '\t ()', '()', '{ () }', 'echo $()', 'echo $( )', 'functions x', 'aliases', 'xalias', '"my function"', "'alias a'", 'echo "f()"', 'echo \'f()\'', 'x (y)', 'x ( y )', 'a & ()', 'a && ()']) {
    assert.equal(defines(text), false, JSON.stringify(text))
  }
  // Read as PowerShell, `()` is an empty argument list or group, not a definition; the words still count.
  assert.equal(defines('f()', true), false)
  assert.equal(defines('Get-Date ( )', true), false)
  assert.equal(defines('function f { }', true), true)
  assert.equal(defines('Set-Alias a b', true), true)
})

test('a blank run before or after `(` is read once, however long (item 1)', () => {
  const start = Date.now()
  const text = 'f' + ' '.repeat(300000) + '(' + ' '.repeat(300000) + 'x ' + '('.repeat(1000)
  assert.equal(splitShell(text).defines, false)
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`)
})

test('definitions that stay text-only, and separators around a text-only command, do not refuse it (item 1)', () => {
  for (const text of [
    `echo ${READ}; ls`,
    `echo ${READ} | cat`,
    `echo ${READ} && true`,
    `(echo ${READ})`,
    `a=(1); echo ${READ}`,
    `cat <(true); echo ${READ}`,
    `true; ( ); echo ${READ}`,
    `echo $(true) ${READ}`,
    `( ) echo ${READ}`,
    `{ echo ${READ}; }`,
    `echo ${READ}\nls`,
  ]) {
    allowed(text, 'bash')
  }
})

test('a text-only word is read like eval only in a command that defines something (item 1)', () => {
  // `alias echo=eval; echo "…"` makes the quoted read one word that nothing but eval-style reading looks into.
  denied(`alias echo=eval; echo "${READ}"`, 'bash')
  denied(`echo() { eval "$@"; }; echo "${READ}"`, 'bash')
  denied(`function cat { eval "$@" }; cat "${READ}"`, 'bash')
  denied(`Set-Alias Write-Output iex; Write-Output "${PS_READ}"`, 'powershell')
  allowed(`echo "${READ}"`, 'bash')
  allowed(`Write-Output "${PS_READ}"`, 'powershell')
  // The definition and the text-only command are in different commands: the whole command is read again.
  denied(`alias a=b
echo "${READ}"`, 'bash')
  denied(`echo "${READ}"; alias a=b`, 'bash')
})

test('words after the script of -c are arguments, not scripts (item 4)', () => {
  for (const text of [
    `bash -c 'ls' '${READ}'`,
    `bash -c -e 'ls' '${READ}'`,
    `bash -c -o errexit 'ls' '${READ}'`,
    `bash -c -- 'ls' '${READ}'`,
    `bash -c -e -- 'ls' -o '${READ}'`,
    `bash -c -O extglob 'ls' -O '${READ}'`,
    `zsh -c -e 'ls' -o -O '${READ}'`,
    `bash -c +e 'ls' -e '${READ}'`,
  ]) {
    allowed(text, 'bash')
  }
  // Options, and the value an option takes, can come after the flag with no script at all.
  for (const text of ['bash -c', 'bash -c -e', 'bash -c -e -e', 'bash -c --', 'bash -c -e --', 'bash -c -o', 'bash -co', 'bash -c -o errexit']) {
    allowed(text, 'bash')
  }
})

test('the value of -o, -O, +o and +O can be the script, as zsh runs it (item 4)', () => {
  for (const text of [`zsh -c -O '${READ}'`, `zsh -c +o '${READ}'`, `zsh -c -o '${READ}'`, `zsh -co '${READ}'`, `zsh -c +O -e '${READ}'`, `zsh -c -e +o '${READ}'`]) {
    denied(text, 'bash')
  }
})

test('the flag can carry capital letters (item 4)', () => {
  for (const text of [`bash -cO extglob '${READ}'`, `bash -Oc extglob '${READ}'`]) denied(text, 'bash')
})

test('`security` options that are not -p are skipped as before, and -p needs its value (item 10)', () => {
  for (const text of [
    `security -p x find-generic-password -s keyprompt -w`,
    `security -q -v -i -p x -l find-generic-password -s keyprompt -w`,
    `security -vp x find-generic-password -g -s keyprompt`,
    `security -lqp x -h dump-keychain -d`,
  ]) {
    denied(text, 'bash')
  }
  // `-pp` and `-px` carry their value; the next word is the subcommand.
  allowed('security -pp list-keychains', 'bash')
  allowed('security -p', 'bash')
  allowed('security -q -p', 'bash')
  allowed('security', 'bash')
  denied(`security -pp find-generic-password -s keyprompt -w`, 'bash')
  denied(`sudo -u root security -p x find-generic-password -s keyprompt -w`, 'bash')
  denied(`security -p x find-generic-password -s keyprompt -w; ls`, 'bash')
  denied(`ls; security -p x find-generic-password -s keyprompt -w`, 'bash')
  denied(`security -p x security find-generic-password -s keyprompt -w`, 'bash')
  denied(`security -p x -p y -p z find-generic-password -s keyprompt -w`, 'bash')
  denied(`security -p dump-keychain -p x dump-keychain -d`, 'bash')
})

test('a read behind a modifier and a launcher is found (item 12)', () => {
  for (const text of [
    `keyprompt run X -- noglob eval "${READ}"`,
    `keyprompt run X -- repeat 1 eval "${READ}"`,
    `npx keyprompt run X -- nocorrect eval "${READ}"`,
    `node x.mjs -- coproc eval "${READ}"`,
  ]) {
    denied(text, 'bash')
  }
})

test('`repeat` with no count, a count that is another `repeat`, or at the end of the command (item 12)', () => {
  for (const text of ['repeat', 'echo hi; repeat', 'noglob repeat', 'repeat 1', 'sudo repeat']) allowed(text, 'bash')
  for (const text of [`repeat $(true) repeat 1 eval "${READ}"`, `repeat repeat 1 eval "${READ}"`, `repeat $(a) repeat $(b) eval "${READ}"`, `noglob repeat $(true) noglob eval "${READ}"`]) {
    denied(text, 'bash')
  }
})

test('an `eval` word that is not the command is not joined with the words after it (item 12)', () => {
  // Read as PowerShell the stray quote closes the string, so the read is plain words there; joined and read as bash text it starts with `echo`.
  for (const text of [
    'ls eval "echo \\" eval security find-generic-password -g -s OPENAI_API_KEY"',
    'x=1 ls eval "echo \\" eval security find-generic-password -g -s OPENAI_API_KEY"',
    'find . -name eval "echo \\" eval secret-tool lookup service keyprompt"',
  ]) {
    denied(text, 'powershell')
  }
})

test('the pieces of the -c and `security` readings that only the exact shapes pin (items 4, 10)', () => {
  // `--` ends the options: the word after it is the script even when it looks like an option.
  allowed(`bash -c -- -e '${READ}'`, 'bash')
  denied(`bash -c -- '${READ}' -e`, 'bash')
  // An option that starts with two dashes takes no value, so `ls` is the script and the next word an argument.
  allowed(`bash -c --norc 'ls' '${READ}'`, 'bash')
  // A word that only ends like the flag is not the flag.
  allowed(`bash a-c '${READ}'`, 'bash')
  allowed(`bash -x-c '${READ}'`, 'bash')
  // Two `-c` flags in one command are each read.
  denied(`bash -c ls bash -c '${READ}'`, 'bash')
  denied(`sh -c true; bash -c -e '${READ}'`, 'bash')
  // `-px` carries its value, so the word after it is the subcommand (and is not a read).
  allowed('security -px x find-generic-password -s keyprompt -w', 'bash')
  // Both readings of where the subcommand is count, each once, and one that finds a read is not overwritten by one that finds none.
  denied('security -p dump-keychain find-generic-password -s keyprompt -w', 'bash')
  denied('security -p find-generic-password dump-keychain -s keyprompt -w', 'bash')
  denied('security -p find-generic-password dump-keychain -d x', 'bash')
})

test('an `eval` word that is not the command runs nothing, so what follows it is not read as its script (item 12)', () => {
  for (const text of [`ls eval "${READ}"`, `find . -name eval "${READ}"`, `x=1 ls eval '${READ}'`]) allowed(text, 'bash')
})

test('the -c words are listed once per flag however many shell words come before it (items 4, 10)', () => {
  const start = Date.now()
  const found = checkCommand('bash '.repeat(20000) + '-c ' + '-e '.repeat(100000) + `'${READ}'`, SAVED, 'bash')
  assert.ok(found, 'a read at the end of 100,000 options is refused')
  assert.ok(Date.now() - start < 6000, `took ${Date.now() - start} ms`)
})
