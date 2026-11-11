import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCommand } from '../src/guard.mjs'

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
