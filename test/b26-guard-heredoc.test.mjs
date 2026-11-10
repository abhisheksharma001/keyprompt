import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { preToolUse, splitShell } from '../src/guard.mjs'

// B-26 (docs/bugs.md), step S-58: a here-document body that bash leaves as text is not a command.
// Every input here is a string handed to the guard; none is run.

const SAVED = ['OPENAI_API_KEY']
const READ = 'security find-generic-password -s keyprompt -w'
const PS_READ = 'Get-StoredCredential -Target keyprompt:X'

/** @param {string} tool @param {string} command */
const decision = (tool, command) => preToolUse({ tool_name: tool, tool_input: { command } }, SAVED)?.hookSpecificOutput.permissionDecision

/** A commit message body that quotes reads in every way this repo's own messages do. */
const BODY = [
  'S-58: the guard reads here-documents',
  '',
  `The guard refused \`${READ}\` in a commit message.`,
  READ,
  `- refuses ${READ} in the middle of a line`,
  `$(${READ})`,
  `# ${READ}`,
  `item 1) an unbalanced ) and a "double" and a 'single' quote`,
  PS_READ,
  'Co-Authored-By: Claude <noreply@anthropic.com>',
].join('\n')

const TEXT = [
  // Claude Code's own form for a commit message and a pull request body.
  `git commit -m "$(cat <<'EOF'\n${BODY}\nEOF\n)"`,
  `gh pr create --title "S-58" --body "$(cat <<'EOF'\n${BODY}\nEOF\n)"`,
  // The other ways to quote the delimiter (bash: if any part of it is quoted, the body is not expanded).
  `git commit -m "$(cat <<"EOF"\n${BODY}\nEOF\n)"`,
  `git commit -m "$(cat <<\\EOF\n${BODY}\nEOF\n)"`,
  `git commit -m "$(cat <<E"O"F\n${BODY}\nEOF\n)"`,
  // <<- strips leading tabs, from the body and from the delimiter line.
  `git commit -m "$(cat <<-'EOF'\n\t${READ}\n\tEOF\n)"`,
  // An unquoted delimiter whose body holds no $, backtick or backslash runs nothing.
  `git commit -m "$(cat <<EOF\n${READ}\n- refuses ${READ}\nEOF\n)"`,
  // A body fed to a command that only prints or stores text.
  `cat <<'EOF'\n${BODY}\nEOF`,
  `cat > notes.md <<'EOF'\n${BODY}\nEOF`,
  `tee notes.md <<'EOF' >/dev/null\n${BODY}\nEOF`,
  `cat <<EOF\n${READ}\nEOF\necho done`,
  // Found by mutation testing (StrykerJS 10.1.1): each rule below changes an answer, so each is pinned.
  `cat << 'EOF'\n${READ}\nEOF`,
  `cat <<\t'EOF'\n${READ}\nEOF`,
  `git commit -m "$(cat  <<'EOF'\n${READ}\nEOF\n)"`,
  `git commit -m "$(cat <<'EOF'\n${READ}\nEOF\n\n)"`,
  `git commit -m "$(cat <<-'EOF'\n\t${READ}\n\t\tEOF\n)"`,
  // Without <<- a tab before the delimiter is part of the line, and <<- strips only leading tabs.
  `cat <<'EOF'\n\tEOF\n${READ}\nEOF`,
  `cat <<-'EOF'\nEO\tF\n${READ}\nEOF`,
  // A quoted body joins no lines; in an unquoted one \$( is text, and so is a ( alone.
  `cat <<'EOF'\nEO\\\nF\n${READ}\nEOF`,
  `cat <<EOF\nKey: \\$(${READ})\nEOF`,
  `cat <<EOF\nitem (${READ})\nEOF`,
  `cat <<'A' <<'B'\nx\nA\n${READ}\nB`,
  `git tag -a v1 -m "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  `git notes add -m "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  `gh issue create --title x --body "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  `gh release create v1 --notes "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  `echo "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  // A shell that runs cat only prints the body.
  `bash -c "cat <<'EOF'\n${READ}\nEOF"`,
  // || is not a pipe; a group or loop that has closed, or a keyword that is not a command's first word, no longer counts.
  `cat <<'EOF' || bash\n${READ}\nEOF`,
  `(true)\ncat <<'EOF'\n${READ}\nEOF`,
  `echo if while\ncat <<'EOF'\n${READ}\nEOF`,
  `if true; then echo; fi\ncat <<'EOF'\n${READ}\nEOF`,
  `for i in 1; do echo; done\ncat <<'EOF'\n${READ}\nEOF`,
  `case x in x) echo ;; esac\ncat <<'EOF'\n${READ}\nEOF`,
  `{ echo; }\ncat <<'EOF'\n${READ}\nEOF`,
  `echo concat(x)\ncat <<'EOF'\n${READ}\nEOF`,
  '{ echo hi; }',
]

for (const command of TEXT) {
  test(`a here-document body that is only text passes (Bash): ${JSON.stringify(command.slice(0, 60))}`, () => {
    assert.equal(decision('Bash', command), undefined)
  })
}

const FED = [
  // A body fed to a shell or an interpreter is a script, with either delimiter.
  ...['bash', 'sh', 'zsh', 'python3', 'node', 'eval', 'bash -s', 'sh -s --'].flatMap((shell) => [
    `${shell} <<'EOF'\n${READ}\nEOF`,
    `${shell} <<EOF\n${READ}\nEOF`,
  ]),
  `pwsh <<'EOF'\n${PS_READ}\nEOF`,
  `pwsh -Command - <<EOF\n${PS_READ}\nEOF`,
  `while read -r line; do eval "$line"; done <<'EOF'\n${READ}\nEOF`,
  // Text whose output is run: by eval, as a shell's script, or as the command itself.
  `eval "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  `eval $(cat <<'EOF'\n${READ}\nEOF\n)`,
  `bash -c "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  `sh -c "$(cat <<EOF\n${READ}\nEOF\n)"`,
  `pwsh -c "$(cat <<'EOF'\n${PS_READ}\nEOF\n)"`,
  `$(cat <<'EOF'\n${READ}\nEOF\n)`,
  `eval "\`cat <<'EOF'\n${READ}\nEOF\n\`"`,
  `eval "$(cat <<'EOF'\n${READ}\nEOF\necho)"`,
  `eval "$(echo "$(cat <<'EOF'\n${READ}\nEOF\n)")"`,
  // Text piped or handed into a shell.
  `cat <<'EOF' | bash\n${READ}\nEOF`,
  `cat <<'EOF' 2>&1 | sh\n${READ}\nEOF`,
  `cat <<'EOF' |\n${READ}\nEOF\nbash`,
  `cat <<'EOF' > >(bash)\n${READ}\nEOF`,
  `source <(cat <<'EOF'\n${READ}\nEOF\n)`,
  `(cat <<'EOF'\n${READ}\nEOF\n) | bash`,
  `bash <<'X' | sh\ncat <<'Y'\n${READ}\nY\nX`,
  // A text-only name the command itself redefines.
  `cat() { bash; }; cat <<'EOF'\n${READ}\nEOF`,
  `function cat { bash; }; cat <<'EOF'\n${READ}\nEOF`,
  `cat() { bash; }; git commit -m "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  // An unquoted body still runs $( ) and backticks.
  `cat <<EOF\nKey: \`${READ}\`\nEOF`,
  `cat > notes.md <<EOF\nKey: $(${READ})\nEOF`,
  `git commit -m "$(cat <<EOF\nKey: $(${READ})\nEOF\n)"`,
  `git commit -m "$(cat <<EOF\nKey: \`${READ}\`\nEOF\n)"`,
  // Where bash starts no here-document, or ends it earlier than the guard would.
  `echo \${x:-<<EOF}\n${READ}\nEOF}`,
  `echo \${x:- <<EOF}\n${READ}\nEOF}`,
  `cat <<EOF\nEO\\\nF\n${READ}\nEOF`,
  `cat <<'EOF'\nEOF\n${READ}`,
  `cat <<'EOF'\n${READ}\n\tEOF\nEOF\n${READ}`,
  `cat <<EOF\nEO\\\\\nEOF\n${READ}`,
  `a[x<<EOF]=1\n${READ}\nEOF]=1`,
  `cat <<<'x'\n${READ}`,
  // Found by mutation testing: each rule below keeps a read refused.
  // A text-only name the command redefines, in each way REDEFINES knows.
  `cat () { bash; }; cat <<'EOF'\n${READ}\nEOF`,
  `true;cat(){ bash;}; cat <<'EOF'\n${READ}\nEOF`,
  `function tee { bash; }; tee <<'EOF'\n${READ}\nEOF`,
  `alias cat=bash\ncat <<'EOF'\n${READ}\nEOF`,
  `alias -- 'cat=bash'\ncat <<'EOF'\n${READ}\nEOF`,
  `hash -p /bin/bash cat; cat <<'EOF'\n${READ}\nEOF`,
  `functions[cat]=bash; cat <<'EOF'\n${READ}\nEOF`,
  `aliases[cat]=bash; cat <<'EOF'\n${READ}\nEOF`,
  // A group or loop piped on after it closes, on a later line.
  `{\ncat <<'EOF'\n${READ}\nEOF\n} | bash`,
  `if true; then\ncat <<'EOF'\n${READ}\nEOF\nfi | bash`,
  `while true; do\ncat <<'EOF'\n${READ}\nEOF\ndone | bash`,
  `until false; do\ncat <<'EOF'\n${READ}\nEOF\ndone | sh`,
  `select x in a; do\ncat <<'EOF'\n${READ}\nEOF\ndone | bash`,
  `case x in x)\ncat <<'EOF'\n${READ}\nEOF\n;; esac | bash`,
  `(\ncat <<'EOF'\n${READ}\nEOF\n) | bash`,
  // A shell's script whose output is piped on, there or after its group closes.
  `bash -c "cat <<'EOF'\n${READ}\nEOF" | sh`,
  `{\nbash -c "cat <<'EOF'\n${READ}\nEOF"\n} | sh`,
  `(\nbash -c "cat <<'EOF'\n${READ}\nEOF"\n) | sh`,
  // Output sent on by exec or a coprocess, with no pipe on the line.
  `bash < f & exec 1> f\ncat <<'EOF'\n${READ}\nEOF`,
  `coproc bash\ncat <<'EOF' >&p\n${READ}\nEOF`,
  // $(cat <<…) taken as text, then piped or grouped.
  `echo "$(cat <<'EOF'\n${READ}\nEOF\n)" | bash`,
  `{ echo "$(cat <<'EOF'\n${READ}\nEOF\n)"; } | bash`,
  // A $( ) script that runs more than cat, or is not cat, is read.
  `git commit -m "$(${READ}; cat <<'EOF'\nx\nEOF\n)"`,
  `git commit -m "$(cat <<'EOF'\nx\nEOF\n${READ}\n)"`,
  `git commit -m "$(cat <<'EOF'; ${READ}\nx\nEOF\n)"`,
  `git commit -m "$(xcat <<'EOF'\n${READ}\nEOF\n)"`,
  `eval "$(cat <<'EOF'\n${READ}\n)"`,
  // Lines read one by one by a loop that runs them: a here-document among them is not one.
  `while read -r l; do eval "$l"; done <<'X'\ncat <<'Y'\n${READ}\nY\nX`,
  `cat <<'A' && bash <<'B'\nx\nA\n${READ}\nB`,
  // Kept as before S-58, on the safe side: an option before the command, and a delimiter the guard does not read.
  `env -u FOO git commit -m "$(cat <<'EOF'\n${READ}\nEOF\n)"`,
  `git commit -m "$(cat <<'EOF'\n${READ}\n)"`,
  `cat <<$X\n${READ}\n$X`,
  `cat <<'E\nX'\n${READ}\nE\nX`,
]

test('splitShell reads here-documents and comments by default', () => {
  assert.deepEqual(splitShell(`cat <<'EOF' # note\n${READ}\nEOF`).commands, [['cat']])
})

for (const command of FED) {
  test(`a here-document that runs a read is refused: ${JSON.stringify(command.slice(0, 70))}`, () => {
    for (const tool of ['Bash', 'Monitor']) assert.equal(decision(tool, command), 'deny', tool)
  })
}

test('here-documents are read in linear time, inside the hook timeout', () => {
  // The hook times out after 10 seconds (src/install-guard.mjs) and Claude Code then lets the command run.
  const code = `
    const { checkCommand } = await import(${JSON.stringify(new URL('../src/guard.mjs', import.meta.url).href)})
    const read = ${JSON.stringify(READ)}
    const cases = [
      ['git commit -m "$(cat <<\\'EOF\\'\\n' + (read + ' x) "\\n').repeat(20000) + 'EOF\\n)"', false],
      [("cat <<'E'\\n" + read + '\\nE\\n').repeat(20000), false],
      ['bash <<E\\n'.repeat(20000) + read, true],
      ["cat <<'E' ".repeat(20000) + '\\n' + 'x\\n'.repeat(20000), false],
      ['echo "' + "$(cat <<'E'\\nx\\nE\\n)".repeat(20000) + '"', false],
      // Found by the builder's own review: an unclosed $( or backtick in a body once ran to the end of the text, every time,
      // and the start of a command was worked out again for every $( ).
      ['cat <<E\\n$(\\nE\\n'.repeat(20000), false],
      ['cat <<E\\n\`\\nE\\n'.repeat(20000), false],
      ['sudo '.repeat(10000) + 'echo ' + "\\"$(cat <<'E'\\nx\\nE\\n)\\" ".repeat(10000), false],
      ['sudo ' + "sudo $(cat <<'E'\\nx\\nE\\n) ".repeat(20000), false],
      ['sudo '.repeat(20000) + "cat <<'E' ".repeat(20000) + '\\nx\\nE\\n', false],
      // Time only: past the depth cap the answer is B-32's item 5, not this step's.
      ['$('.repeat(5000) + "cat <<'E'\\n" + read + '\\nE\\n' + ')'.repeat(5000), undefined],
    ]
    const results = cases.map(([command, denied]) => {
      const start = Date.now()
      const found = checkCommand(command, ['OPENAI_API_KEY'], 'bash')
      return { ms: Date.now() - start, ok: denied === undefined || Boolean(found) === denied }
    })
    process.stdout.write(JSON.stringify(results))
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 8000 })
  assert.equal(child.status, 0, `the check did not finish within 8 seconds (signal ${child.signal}) ${child.stderr}`)
  for (const [index, { ms, ok }] of JSON.parse(child.stdout).entries()) {
    assert.ok(ok, `case ${index}: wrong answer`)
    assert.ok(ms < 2000, `case ${index}: took ${ms} ms`)
  }
})
