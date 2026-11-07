import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  addGuard,
  guardEntries,
  guardInstalled,
  isGuardHandler,
  nodeCommand,
  removeGuard,
  runsFromNpxCache,
  settingsPath,
} from '../src/install-guard.mjs'

const BIN = fileURLToPath(new URL('../bin/keyprompt.mjs', import.meta.url))
const ENTRIES = guardEntries('/usr/local/bin/node', '/usr/local/lib/node_modules/keyprompt/bin/keyprompt.mjs')

/** Settings with someone else's hooks and other keys, which must come back untouched. */
const THEIRS = {
  permissions: { allow: ['Bash(git status)'] },
  env: { A: '1' },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk-rewrite.sh' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/context.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
  },
}

/** @param {Record<string, any>} settings @param {string} event */
function guardCount(settings, event) {
  return (settings.hooks?.[event] ?? []).flatMap((/** @type {any} */ g) => g.hooks).filter(isGuardHandler).length
}

test('the entries run node directly with the guard script, a 10 s timeout, and match Bash and PowerShell (R-10)', () => {
  assert.deepEqual(ENTRIES.PreToolUse, {
    matcher: 'Bash|PowerShell',
    hooks: [{ type: 'command', command: '/usr/local/bin/node', args: ['/usr/local/lib/node_modules/keyprompt/bin/keyprompt.mjs', 'guard', 'pre-tool-use'], timeout: 10 }],
  })
  assert.equal(ENTRIES.UserPromptSubmit.hooks[0].args[2], 'user-prompt-submit')
  assert.equal('onFailure' in ENTRIES.PreToolUse.hooks[0], false, 'fails open on purpose (D-17)')
})

test('adding to empty settings creates both entries', () => {
  const added = addGuard({}, ENTRIES)
  assert.deepEqual(added, { hooks: { PreToolUse: [ENTRIES.PreToolUse], UserPromptSubmit: [ENTRIES.UserPromptSubmit] } })
  assert.ok(guardInstalled(added, ENTRIES))
})

test('adding keeps every other setting and hook, and removing gives the original back (G3)', () => {
  const added = addGuard(THEIRS, ENTRIES)
  assert.equal(guardCount(added, 'PreToolUse'), 1)
  assert.equal(guardCount(added, 'UserPromptSubmit'), 1)
  assert.deepEqual(added.hooks.Stop, THEIRS.hooks.Stop)
  assert.deepEqual(added.permissions, THEIRS.permissions)
  const { settings, removed } = removeGuard(added)
  assert.equal(removed, 2)
  assert.deepEqual(settings, THEIRS)
  assert.deepEqual(removeGuard(addGuard({}, ENTRIES)).settings, {})
})

test('a second install adds nothing, and a new node path replaces the old entry', () => {
  const once = addGuard(THEIRS, ENTRIES)
  assert.deepEqual(addGuard(once, ENTRIES), once)
  const moved = guardEntries('/opt/homebrew/bin/node', '/opt/homebrew/lib/node_modules/keyprompt/bin/keyprompt.mjs')
  assert.equal(guardInstalled(once, moved), false)
  const again = addGuard(once, moved)
  assert.equal(guardCount(again, 'PreToolUse'), 1)
  assert.ok(guardInstalled(again, moved))
})

test('removing touches only the guard: a group shared with another handler keeps that handler', () => {
  const shared = { hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [ENTRIES.PreToolUse.hooks[0], { type: 'command', command: 'mine.sh' }] }] } }
  assert.deepEqual(removeGuard(shared), {
    settings: { hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'mine.sh' }] }] } },
    removed: 1,
  })
  assert.deepEqual(removeGuard(THEIRS), { settings: THEIRS, removed: 0 })
  assert.equal(isGuardHandler({ type: 'command', command: 'guard.sh', args: ['x.js', 'guard', 'pre-tool-use'] }), false)
})

test('settings whose hooks are the wrong shape are refused, not rewritten', () => {
  assert.throws(() => addGuard({ hooks: [] }, ENTRIES), /"hooks" is not a JSON object/)
  assert.throws(() => addGuard({ hooks: { PreToolUse: {} } }, ENTRIES), /"hooks.PreToolUse" is not a list/)
})

test('the settings file is the one Claude Code reads, CLAUDE_CONFIG_DIR included (R-11)', () => {
  assert.equal(settingsPath({}, '/home/a'), join('/home/a', '.claude', 'settings.json'))
  const dir = join(tmpdir(), 'claude-work')
  assert.equal(settingsPath({ CLAUDE_CONFIG_DIR: dir }, '/home/a'), join(dir, 'settings.json'))
  assert.throws(() => settingsPath({ CLAUDE_CONFIG_DIR: 'relative/dir' }, '/home/a'), /absolute path/)
})

test("npx's temporary folder is recognised on every OS (R-13)", () => {
  assert.ok(runsFromNpxCache('/Users/a/.npm/_npx/0903da37d389af6c/node_modules/keyprompt'))
  assert.ok(runsFromNpxCache('C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\1415fee7\\node_modules\\keyprompt'))
  assert.equal(runsFromNpxCache('/usr/local/lib/node_modules/keyprompt'), false)
})

test('the hook uses a link on PATH that points at the running node, so an upgrade does not break it (R-13)', { skip: process.platform === 'win32' && 'symlinks need extra rights on Windows' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'keyprompt-node-'))
  mkdirSync(join(root, 'Cellar', '25.9.0', 'bin'), { recursive: true })
  mkdirSync(join(root, 'bin'))
  const real = join(root, 'Cellar', '25.9.0', 'bin', 'node')
  writeFileSync(real, '')
  symlinkSync(real, join(root, 'bin', 'node'))
  assert.equal(nodeCommand(real, join(root, 'bin'), 'darwin'), join(root, 'bin', 'node'))
  assert.equal(nodeCommand(real, join(root, 'elsewhere'), 'darwin'), real)
})

/**
 * Run keyprompt with HOME (and USERPROFILE) in a new temporary folder, so the
 * real ~/.claude is never touched.
 *
 * @param {string[]} args
 * @param {string} [settingsText] written to .claude/settings.json first
 */
function cli(args, settingsText) {
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-home-'))
  const file = join(home, '.claude', 'settings.json')
  if (settingsText !== undefined) {
    mkdirSync(join(home, '.claude'))
    writeFileSync(file, settingsText)
  }
  const { CLAUDE_CONFIG_DIR, ...env } = process.env
  const run = (/** @type {string[]} */ more) =>
    spawnSync(process.execPath, [BIN, ...more], {
      encoding: 'utf8',
      env: { ...env, HOME: home, USERPROFILE: home, KEYPROMPT_HOME: join(home, '.keyprompt') },
    })
  return { result: run(args), file, run, read: () => (existsSync(file) ? readFileSync(file, 'utf8') : undefined) }
}

test('install-guard --yes writes both entries, and a second run changes nothing', () => {
  const { result, file, run, read } = cli(['install-guard', '--yes'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /adds these hook entries/)
  const written = JSON.parse(/** @type {string} */ (read()))
  const handler = written.hooks.PreToolUse[0].hooks[0]
  assert.ok(isAbsolute(handler.command) && existsSync(handler.command), 'command is an absolute path to node')
  assert.equal(handler.args[0], BIN)
  const before = readFileSync(file, 'utf8')
  const second = run(['install-guard', '--yes'])
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /already installed/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('the installed hook command really runs the guard', () => {
  const { result, read } = cli(['install-guard', '--yes'])
  assert.equal(result.status, 0, result.stderr)
  const handler = JSON.parse(/** @type {string} */ (read())).hooks.PreToolUse[0].hooks[0]
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'security find-generic-password -s keyprompt -w' } })
  const hook = spawnSync(handler.command, handler.args, { input, encoding: 'utf8' })
  assert.equal(hook.status, 0, hook.stderr)
  assert.equal(JSON.parse(hook.stdout).hookSpecificOutput.permissionDecision, 'deny')
})

test('install-guard keeps the rest of an existing settings file', () => {
  const { result, read } = cli(['install-guard', '--yes'], JSON.stringify(THEIRS, null, 2))
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(removeGuard(JSON.parse(/** @type {string} */ (read()))).settings, THEIRS)
})

test('without a terminal and without --yes, install-guard shows the plan and changes nothing', () => {
  const original = JSON.stringify(THEIRS, null, 2)
  const { result, read } = cli(['install-guard'], original)
  assert.equal(result.status, 2)
  assert.match(result.stdout, /adds these hook entries/)
  assert.match(result.stderr, /Run it in your own terminal, or add --yes/)
  assert.equal(read(), original)
})

test('an empty settings file is treated as empty settings', () => {
  const { result, read } = cli(['install-guard', '--yes'], '  \n')
  assert.equal(result.status, 0, result.stderr)
  const written = JSON.parse(/** @type {string} */ (read()))
  assert.equal(guardCount(written, 'PreToolUse'), 1)
  assert.equal(guardCount(written, 'UserPromptSubmit'), 1)
})

test('a symlinked settings file stays a link, and its target gets the entries', { skip: process.platform === 'win32' && 'symlinks need extra rights on Windows' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-home-'))
  const dotfiles = join(home, 'dotfiles')
  mkdirSync(dotfiles)
  mkdirSync(join(home, '.claude'))
  writeFileSync(join(dotfiles, 'settings.json'), JSON.stringify(THEIRS))
  symlinkSync(join(dotfiles, 'settings.json'), join(home, '.claude', 'settings.json'))
  const { CLAUDE_CONFIG_DIR, ...env } = process.env
  const result = spawnSync(process.execPath, [BIN, 'install-guard', '--yes'], { encoding: 'utf8', env: { ...env, HOME: home, USERPROFILE: home } })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(lstatSync(join(home, '.claude', 'settings.json')).isSymbolicLink())
  assert.equal(guardCount(JSON.parse(readFileSync(join(dotfiles, 'settings.json'), 'utf8')), 'PreToolUse'), 1)
})

test('a settings file that is not valid JSON is left byte for byte', () => {
  const broken = '{ "theme": "dark", // a comment\n}'
  const { result, read } = cli(['install-guard', '--yes'], broken)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not valid JSON, so keyprompt left it alone/)
  assert.equal(read(), broken)
})

test('uninstall-guard refuses without a terminal, so an agent cannot switch the guard off (D-15)', () => {
  const installed = JSON.stringify(addGuard(THEIRS, ENTRIES), null, 2)
  const { result, read } = cli(['uninstall-guard'], installed)
  assert.equal(result.status, 2)
  assert.match(result.stderr, /works only in your own terminal/)
  assert.equal(read(), installed)
  const none = cli(['uninstall-guard'], JSON.stringify(THEIRS))
  assert.equal(none.result.status, 0)
  assert.match(none.result.stdout, /not installed/)
  assert.equal(cli(['uninstall-guard', '--yes'], installed).result.status, 2)
})

test('--yes is refused outside install-guard', () => {
  const { result } = cli(['list', '--yes'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--yes works only with install-guard/)
})
