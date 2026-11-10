import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { checkCommand, preToolUse } from '../src/guard.mjs'

// B-25 (docs/bugs.md), step S-57: plain forms of a direct read that the guard let through.

const BIN = fileURLToPath(new URL('../bin/keyprompt.mjs', import.meta.url))
const SAVED = ['OPENAI_API_KEY']

/** Bash forms: each runs the store's read tool on a keyprompt item. */
const BASH_READS = [
  'timeout 5 secret-tool lookup service keyprompt account X',
  'nice -n 10 security find-generic-password -s keyprompt -w',
  'env -u FOO security find-generic-password -s keyprompt -w',
  'security \\\nfind-generic-password -s keyprompt -w',
  'bash -c "security \\\nfind-generic-password -s keyprompt -w"',
  'security find-generic-password -skeyprompt -w',
  'security find-generic-password -wskeyprompt',
  'security find-generic-password -gaOPENAI_API_KEY',
  'keyprompt list | xargs -I{} security find-generic-password -s keyprompt -a {} -w',
  'stdbuf -oL security find-generic-password -s keyprompt -w',
  'setsid security find-generic-password -s keyprompt -w',
  'flock /tmp/kp.lock security find-generic-password -s keyprompt -w',
  'find . -maxdepth 0 -exec security find-generic-password -s keyprompt -w \\;',
  "timeout 5 sh -c 'security find-generic-password -s keyprompt -w'",
  'git bisect run security find-generic-password -s keyprompt -w',
  // Found by the PR's /code-review: a # glued to $( ) or backticks starts no comment, and a wrapper's option can take `echo` as its value.
  'true $(true)# ; security find-generic-password -s keyprompt -w',
  'true `true`# ; security find-generic-password -s keyprompt -w',
  'env -u echo security find-generic-password -s keyprompt -w',
  'exec -a echo security find-generic-password -s keyprompt -w',
]

/** PowerShell forms: read with PowerShell's own escape character, the backtick. */
const POWERSHELL_READS = [
  'Set-Location "C:\\proj\\"; Get-StoredCredential -Target keyprompt:X',
  'CredentialManager\\Get-StoredCredential -Target keyprompt:X',
  'Get-StoredCredential `\n  -Target keyprompt:X',
  'Get-StoredCredential `\r\n  -Target keyprompt:X',
  "Invoke-Command {Get-StoredCredential -Target 'keyprompt:X'}",
  '$(1)# ; Get-StoredCredential -Target keyprompt:X',
  // PowerShell also takes curly quotes as quotes (CharTraits.cs, IsSingleQuote and IsDoubleQuote).
  'Get-StoredCredential -Target ‘keyprompt:X’',
  'Get-StoredCredential -Target “keyprompt:X”',
]

test('refuses each plain form of a direct read in B-25 (G1)', () => {
  for (const command of BASH_READS) {
    const found = checkCommand(command, SAVED)
    assert.ok(found, `should refuse: ${command}`)
    assert.match(found.reason, /keyprompt run NAME -- COMMAND/, command)
    assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny', command)
  }
})

test('refuses each PowerShell form, read as PowerShell reads it (G1)', () => {
  for (const command of POWERSHELL_READS) {
    const found = checkCommand(command, SAVED)
    assert.ok(found, `should refuse: ${command}`)
    assert.match(found.reason, /keyprompt run NAME -- COMMAND/, command)
    assert.equal(preToolUse({ tool_name: 'PowerShell', tool_input: { command } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny', command)
  }
  const nested = 'pwsh -NoProfile -Command "Set-Location C:\\proj\\; CredentialManager\\Get-StoredCredential -Target keyprompt:X"'
  assert.ok(checkCommand(nested, SAVED), nested)
  assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command: nested } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny')
})

test('lets through a command that only prints, searches or stores text, even when it mentions a read (G1b)', () => {
  const read = 'security find-generic-password -s keyprompt -w'
  const quiet = [
    `echo ${read}`,
    `printf '%s ' ${read}`,
    `cat ${read}`,
    `tee ${read}`,
    `grep -e ${read}`,
    `rg -e ${read}`,
    `env A=1 echo ${read}`,
    `git grep -n "${read}"`,
    `git commit -m "S-57: refuse timeout 5 ${read}"`,
    `gh pr create --title "S-57" --body "refuses nice -n 10 ${read}"`,
    `ls # then ${read}`,
    `ls\n# ${read}`,
  ]
  for (const command of quiet) {
    assert.equal(checkCommand(command, SAVED), null, `should let through: ${command}`)
    assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command } }, SAVED), null, command)
  }
  for (const command of [`Write-Output ${read}`, `Write-Host ${read}`, `echo ${read}`]) {
    assert.equal(preToolUse({ tool_name: 'PowerShell', tool_input: { command } }, SAVED), null, command)
  }
})

test('a Bash command is read with Bash quoting, and a PowerShell command with PowerShell quoting', () => {
  // In Bash, \" inside double quotes is a quote, so the ; and the read stay inside the commit message.
  const escaped = 'git commit -m "say \\"hi\\"; security find-generic-password -s keyprompt -w"'
  assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command: escaped } }, SAVED), null)
  // Backticks run a command in Bash and only escape the next character in PowerShell.
  const backticks = 'Write-Output "run `security find-generic-password -s keyprompt -w` later"'
  assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command: backticks } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(preToolUse({ tool_name: 'PowerShell', tool_input: { command: backticks } }, SAVED), null)
})

// Found by the senior review of PR #60: reads that main refused and the first version of this fix let through,
// and PowerShell block comments, which hid the code after them.
const REVIEW_BASH_READS = [
  // A # straight after ) or } is still part of a word, in bash and in zsh.
  'cat <(true)# ; security find-generic-password -s keyprompt -w',
  'tee >(cat)# ; security find-generic-password -s keyprompt -w',
  'diff <(true) <(true)# ; security find-generic-password -s keyprompt -w',
  'a=(x)# ; security find-generic-password -s keyprompt -w',
  'ls (#i)README ; security find-generic-password -s keyprompt -w',
  // A word that only ends in eval or pwsh, or is an option's value, is not the command, so it ends nothing.
  `X=/bin/eval Y="'" security find-generic-password -s keyprompt -w`,
  'X=/bin/eval Y="a #" security find-generic-password -s keyprompt -w',
  'env X=/x/eval Y="a #" security find-generic-password -s keyprompt -w',
  `sudo -u eval Y="'" security find-generic-password -s keyprompt -w`,
  `find . -maxdepth 0 -name eval -o -name "'" -o -exec security find-generic-password -s keyprompt -w \\;`,
  `find . -maxdepth 0 -name pwsh -o -name -c -o -name "'" -o -exec security find-generic-password -s keyprompt -w \\;`,
]

const REVIEW_POWERSHELL_READS = [
  // `${a}#` is one argument (PowerShell's tokenizer.cs), so the ; still ends the command.
  'Write-Output ${a}# ; Get-StoredCredential -Target keyprompt:X',
  // Code after a <# … #> block comment runs (about_Comments).
  '<# x #> Get-StoredCredential -Target keyprompt:X',
  '<#\n#> Get-StoredCredential -Target keyprompt:X',
]

test('refuses the reads the senior review found: a # after ) or }, a word ending in eval, a block comment (G1)', () => {
  for (const command of REVIEW_BASH_READS) {
    assert.ok(checkCommand(command, SAVED), `should refuse: ${command}`)
    assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny', command)
  }
  for (const command of REVIEW_POWERSHELL_READS) {
    assert.ok(checkCommand(command, SAVED), `should refuse: ${command}`)
    assert.equal(preToolUse({ tool_name: 'PowerShell', tool_input: { command } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny', command)
  }
  // A block comment is a comment: a read inside one does not run.
  const inside = 'Get-ChildItem <# Get-StoredCredential -Target keyprompt:X #>'
  assert.equal(preToolUse({ tool_name: 'PowerShell', tool_input: { command: inside } }, SAVED), null)
})

// Found by the second /code-review of PR #60: a fake pwsh -c whose words open a quote or a block comment
// hid a real one after it, because only the first pwsh -c away from the command start was read.
const FAKE_THEN_REAL_PWSH = [
  `find . -maxdepth 0 -name pwsh -o -name -c -o -name "'" -o -exec pwsh -c "Get-StoredCredential -Target keyprompt:X" \\;`,
  `xargs -a /dev/null pwsh -c "<#" -o pwsh -c "Get-StoredCredential -Target keyprompt:X"`,
  `xargs -a /dev/null pwsh -c "'" -o pwsh -c "Get-StoredCredential -Target keyprompt:X"`,
  `find . -exec pwsh -c "<#" \\; -exec pwsh -c "Get-StoredCredential -Target keyprompt:X" \\;`,
]

test('refuses a real pwsh -c behind a fake one whose words open a quote or a comment (G1)', () => {
  for (const command of FAKE_THEN_REAL_PWSH) {
    assert.ok(checkCommand(command, SAVED), `should refuse: ${command}`)
    assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny', command)
  }
  // Kept: a script that runs past a later word named pwsh is still read whole.
  const past = `find . -exec pwsh -c Write-Output pwsh '; Get-StoredCredential -Target keyprompt:X' \\;`
  assert.equal(preToolUse({ tool_name: 'Bash', tool_input: { command: past } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny')
})

test('a long command is checked well inside the hook timeout, so it cannot time the guard out', () => {
  // The hook times out after 10 seconds (src/install-guard.mjs) and Claude Code then lets the command run.
  // Run in a child process, so a slow check is killed and fails this test instead of hanging the suite.
  const code = `
    const { checkCommand } = await import(${JSON.stringify(new URL('../src/guard.mjs', import.meta.url).href)})
    const read = 'security find-generic-password -s keyprompt -w'
    const cases = [
      ['eval '.repeat(60) + 'x; ' + read, 'bash', true],
      ['pwsh -c '.repeat(200) + 'x', 'bash', false],
      // Away from the command start each pwsh -c could read its whole tail again (S-57 senior review fix).
      ['x ' + 'pwsh -c y '.repeat(200), 'bash', false],
      // …and a script is built only when it is read, or 8,000 of them cost seconds.
      ['x ' + 'pwsh -c y '.repeat(8000), 'bash', false],
      ['sh '.repeat(5000) + '-c x', 'bash', false],
      ['security find-generic-password '.repeat(2000), 'bash', false],
      ['secret-tool lookup '.repeat(2000), 'bash', false],
      ['Get-StoredCredential '.repeat(5000), 'powershell', false],
      ['security '.repeat(2000) + '-a '.repeat(2000), 'bash', false],
    ]
    const results = cases.map(([command, shell, denied]) => {
      const start = Date.now()
      const found = checkCommand(command, ['OPENAI_API_KEY'], shell)
      return { ms: Date.now() - start, ok: Boolean(found) === denied }
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

// Found by the senior review of PR #60, round 2: a # read as a comment where bash, zsh or PowerShell starts none
// (an unquoted here-document line, `${…}`, `(( ))`, PowerShell's `${…}` variable name) hid the read after it.
// Main read no comments, so it refused every one of these.
const READ = 'security find-generic-password -s keyprompt -w'
const FAKE_COMMENT_BASH = [
  `cat > notes.md <<EOF\n# Notes $(${READ})\nEOF`,
  `cat > notes.md <<EOF\n## Key: \`${READ}\`\nEOF`,
  `git commit -F - <<EOF\n# $(${READ})\nEOF`,
  `true \${x:-a #}; ${READ}`,
  `true \${x:- #}; ${READ}`,
  `true \${x/ #/}; ${READ}`,
  `(( 1 #)); ${READ}`,
  `EOF [ in( #; ${READ}`,
  // Found while fixing it: main also looked past such a # for a read's options, a shell's -c script and a launcher's --.
  `security find-generic-password \${x:+ #} -s keyprompt -w`,
  `bash \${x:+ #} -c '${READ}'`,
  `keyprompt run X \${y:+ #} -- ${READ}`,
  `npx \${y:+ #} -- ${READ}`,
]
const FAKE_COMMENT_POWERSHELL = [
  'Write-Output ${a #}; Get-StoredCredential -Target keyprompt:X',
  '${a #} = 1; Get-StoredCredential -Target keyprompt:X',
  'Write-Output ${<#}; Get-StoredCredential -Target keyprompt:X',
]

for (const [tool, list] of [['Bash', FAKE_COMMENT_BASH], ['PowerShell', FAKE_COMMENT_POWERSHELL]]) {
  for (const command of list) {
    test(`refuses a read after a # that starts no comment (${tool}): ${JSON.stringify(command)}`, () => {
      for (const name of [tool, 'Monitor']) {
        assert.equal(preToolUse({ tool_name: name, tool_input: { command } }, SAVED)?.hookSpecificOutput.permissionDecision, 'deny', name)
      }
    })
  }
}

test('nested pwsh -c calls away from the command start are each read once, inside the hook timeout', () => {
  // Found by the senior review of PR #60, round 2: with no later PowerShell word, a pwsh -c's own stretch and the tail
  // are the same text, and reading both doubled the work at each nesting level (2.4 s for 1 MB as Bash, before the fix).
  const code = `
    const { checkCommand } = await import(${JSON.stringify(new URL('../src/guard.mjs', import.meta.url).href)})
    const nest = (filler) => {
      const l3 = 'x pwsh -c ' + filler
      const l2 = "x pwsh -c '" + l3 + "'"
      const l1 = "x pwsh -c '" + l2.replace(/'/g, "''") + "'"
      return 'x pwsh -c "' + l1.replace(/"/g, '\\\\"') + '"'
    }
    const results = [250000, 500000].map((n) => {
      const start = Date.now()
      const found = checkCommand(nest('z '.repeat(n)), ['OPENAI_API_KEY'])
      return { ms: Date.now() - start, ok: found === null }
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

test('keyprompt guard pre-tool-use denies a B-25 form end to end', () => {
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-b25-'))
  writeFileSync(join(home, 'catalog.json'), JSON.stringify({ MY_SAVED_NAME: { store: 'test', updatedAt: '2026-11-10T00:00:00.000Z' } }))
  for (const [tool, command] of [
    ['Bash', 'timeout 5 security find-generic-password -a MY_SAVED_NAME -w'],
    ['PowerShell', 'CredentialManager\\Get-StoredCredential -Target MY_SAVED_NAME'],
  ]) {
    const result = spawnSync(process.execPath, [BIN, 'guard', 'pre-tool-use'], {
      input: JSON.stringify({ tool_name: tool, tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, KEYPROMPT_HOME: home },
    })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny', command)
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /keyprompt run NAME -- COMMAND/)
  }
})
