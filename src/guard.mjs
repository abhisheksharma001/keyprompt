/**
 * The checks behind keyprompt's two Claude Code hooks (S-38, docs/prd/v0-3.md).
 *
 * PreToolUse: refuse a shell command that reads a keyprompt secret straight
 * from the OS password store. Only the command's text is read, so this stops
 * the obvious direct reads; a script, an encoded command or another tool can
 * still get past it. It is a guardrail, not a wall.
 *
 * UserPromptSubmit: when a message looks like it contains an API key, say
 * which kind (never the text) to the person and the agent. It never blocks
 * (D-12).
 *
 * Pure functions, no I/O: the CLI reads stdin and the saved names.
 */

const SERVICE = 'keyprompt'

const READS =
  'keyprompt guard: this command reads a secret saved by keyprompt straight from the OS password store.'
const DUMPS = 'keyprompt guard: this command prints every secret in the keychain, including any saved by keyprompt.'
const RUN_INSTEAD =
  "Run the command that needs the secret with `keyprompt run NAME -- COMMAND` instead: the value then goes only into that command's environment, and exact copies of it in the output are masked."

/** Words that come before the real command without changing which command runs. */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'time', 'nohup', 'nice', 'rtk', '{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until'])
/** Shells whose `-c` argument is a script that runs. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'powershell.exe', 'pwsh.exe'])
/** Commands whose words after `--` are another command (`keyprompt run X -- COMMAND`). */
const LAUNCHERS = new Set(['keyprompt', 'keyprompt.mjs', 'npx', 'node'])
/** Tools whose `tool_input.command` is shell text (R-12: PowerShell has the same fields as Bash). */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor'])

/** @param {string} word */
function base(word) {
  return word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1).toLowerCase()
}

/**
 * Split shell text into simple commands (lists of words, quotes removed) at
 * `;`, `&`, `|`, newlines and parentheses. Text inside `$(...)` or backticks,
 * even within double quotes, comes back as a nested script, because the shell
 * runs it; a single- or double-quoted string otherwise stays one word.
 *
 * @param {string} text
 * @returns {{ commands: string[][], nested: string[] }}
 */
export function splitShell(text) {
  /** @type {string[][]} */
  const commands = []
  /** @type {string[]} */
  const nested = []
  /** @type {string[]} */
  let words = []
  let word = ''
  let inWord = false
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  /** @param {number} start index just after `$(` @returns {number} index after the matching `)` */
  const subshell = (start) => {
    let depth = 1
    let j = start
    while (j < text.length && depth > 0) {
      if (text[j] === '\\') j++
      else if (text[j] === '(') depth++
      else if (text[j] === ')') depth--
      j++
    }
    nested.push(text.slice(start, depth === 0 ? j - 1 : j))
    return j
  }
  /** @param {number} start index just after the opening backtick @returns {number} */
  const backtick = (start) => {
    const end = text.indexOf('`', start)
    const stop = end === -1 ? text.length : end
    nested.push(text.slice(start, stop))
    return stop + 1
  }

  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      word += text[i + 1] ?? ''
      inWord = true
      i += 2
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1)
      const stop = end === -1 ? text.length : end
      word += text.slice(i + 1, stop)
      inWord = true
      i = stop + 1
    } else if (c === '"') {
      inWord = true
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          word += text[i + 1]
          i += 2
        } else if (text[i] === '$' && text[i + 1] === '(') {
          i = subshell(i + 2)
        } else if (text[i] === '`') {
          i = backtick(i + 1)
        } else {
          word += text[i]
          i++
        }
      }
      i++
    } else if (c === '$' && text[i + 1] === '(') {
      i = subshell(i + 2)
    } else if (c === '`') {
      i = backtick(i + 1)
    } else if (';&|\n()'.includes(c)) {
      endCommand()
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
    } else {
      word += c
      inWord = true
      i++
    }
  }
  endCommand()
  return { commands, nested }
}

/**
 * @param {string} word
 * @param {Set<string>} names
 */
function namesKeyprompt(word, names) {
  return word === SERVICE || word.toLowerCase().startsWith(`${SERVICE}:`) || names.has(word)
}

/**
 * macOS: `security find-generic-password` with -g or -w (the two options that
 * print the value) naming keyprompt's service, label or a saved name; or
 * `security dump-keychain -d`.
 *
 * @param {string[]} args the words after `security`
 * @param {Set<string>} names
 */
function securityRead(args, names) {
  const sub = args.findIndex((w) => !w.startsWith('-'))
  if (sub === -1) return null
  const rest = args.slice(sub + 1)
  if (args[sub] === 'find-generic-password') {
    const prints = rest.some((w) => /^-[A-Za-z]*[gw][A-Za-z]*$/.test(w))
    return prints && rest.some((w) => namesKeyprompt(w, names)) ? READS : null
  }
  if (args[sub] === 'dump-keychain') return rest.some((w) => /^-[A-Za-z]*d[A-Za-z]*$/.test(w)) ? DUMPS : null
  return null
}

/**
 * Linux: `secret-tool lookup` or `search` (search prints `secret = ...`, R-12)
 * naming keyprompt's service or a saved name.
 *
 * @param {string[]} args the words after `secret-tool`
 * @param {Set<string>} names
 */
function secretToolRead(args, names) {
  const sub = args.findIndex((w) => !w.startsWith('-'))
  if (sub === -1 || (args[sub] !== 'lookup' && args[sub] !== 'search')) return null
  return args.slice(sub + 1).some((w) => namesKeyprompt(w, names)) ? READS : null
}

/**
 * Where the real command starts: past wrappers (`sudo`, `env`, `rtk` ...),
 * their options, `NAME=value` assignments, and PowerShell's `$x =`.
 *
 * @param {string[]} words
 */
function commandStart(words) {
  let i = words.length > 2 && words[1] === '=' ? 2 : 0
  let wrapper = ''
  while (i < words.length) {
    const w = words[i]
    if (WRAPPERS.has(base(w))) wrapper = base(w)
    else if (wrapper && w.startsWith('-')) {
      // sudo and doas options that take a value: `sudo -u root security ...`
      if ((wrapper === 'sudo' || wrapper === 'doas') && /^-[ugUCDhprt]$/.test(w)) i++
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) break
    i++
  }
  return i
}

/**
 * @param {string[]} words one simple command
 * @param {Set<string>} names
 * @param {number} depth
 * @returns {string | null} the reason, when the command is a direct read
 */
function readInWords(words, names, depth) {
  const i = commandStart(words)
  if (i >= words.length) return null
  const command = base(words[i])
  const args = words.slice(i + 1)

  if (command === 'security') return securityRead(args, names)
  if (command === 'secret-tool') return secretToolRead(args, names)
  // Windows: the CredentialManager module's cmdlet, naming a keyprompt target or a saved name (R-12).
  if (command === 'get-storedcredential') return args.some((w) => namesKeyprompt(w, names)) ? READS : null
  if (command === 'eval') return readInShell(args.join(' '), names, depth + 1)
  if (SHELLS.has(command)) {
    // PowerShell: everything after -Command (or -c) is the script. Other shells: the one word after -c (or -lc, -ec ...).
    const powershell = command.startsWith('pwsh') || command.startsWith('powershell')
    const flag = args.findIndex((w) => (powershell ? /^-c(ommand)?$/i.test(w) : /^-[a-z]{0,3}c[a-z]{0,3}$/.test(w)))
    if (flag === -1 || args[flag + 1] === undefined) return null
    return readInShell(powershell ? args.slice(flag + 1).join(' ') : args[flag + 1], names, depth + 1)
  }
  if (LAUNCHERS.has(command)) {
    const dash = args.indexOf('--')
    if (dash !== -1) return readInWords(args.slice(dash + 1), names, depth)
  }
  return null
}

/**
 * @param {string} text
 * @param {Set<string>} names
 * @param {number} depth
 * @returns {string | null}
 */
function readInShell(text, names, depth) {
  if (depth > 4) return null
  const { commands, nested } = splitShell(text)
  for (const words of commands) {
    const found = readInWords(words, names, depth)
    if (found) return found
  }
  // Windows: CredRead through Add-Type (how keyprompt itself reads, `src/store/windows.mjs`), naming a keyprompt target or a saved name.
  const runsAddType = commands.some((words) => base(words[commandStart(words)] ?? '') === 'add-type')
  if (runsAddType && /credread/i.test(text)) {
    const lower = text.toLowerCase()
    if (lower.includes(`${SERVICE}:`) || [...names].some((name) => wordIn(text, name))) return READS
  }
  for (const script of nested) {
    const found = readInShell(script, names, depth + 1)
    if (found) return found
  }
  return null
}

/**
 * @param {string} text
 * @param {string} word
 */
function wordIn(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(text)
}

/**
 * @param {string} command shell text from a Bash or PowerShell tool call
 * @param {Iterable<string>} [savedNames] names from the catalog (never values)
 * @returns {{ reason: string } | null}
 */
export function checkCommand(command, savedNames = []) {
  const found = readInShell(command, new Set(savedNames), 0)
  return found ? { reason: `${found} ${RUN_INSTEAD}` } : null
}

/**
 * Key formats each provider documents (R-12). A match is "looks like", never
 * proof. Order matters: the Anthropic and OpenAI forms are checked before the
 * plain `sk-` form, which cannot match them (it allows no `-` after `sk-`).
 */
const KEY_FORMATS = [
  { kind: 'an Anthropic API key', pattern: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'an OpenAI API key', pattern: /(?<![A-Za-z0-9_-])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
  { kind: 'a secret key that starts with sk-', pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{32,}/ },
  { kind: 'a GitHub token', pattern: /(?<![A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/ },
  { kind: 'a Stripe live secret key', pattern: /(?<![A-Za-z0-9_-])(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { kind: 'a Slack token', pattern: /(?<![A-Za-z0-9_-])(?:xoxb|xoxp|xapp|xwfp)-[A-Za-z0-9-]{20,}/ },
  { kind: 'a private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

/**
 * @param {string} text
 * @returns {string[]} the kinds of key the text looks like it contains, each once
 */
export function checkPrompt(text) {
  const kinds = []
  for (const { kind, pattern } of KEY_FORMATS) {
    if (pattern.test(text) && !kinds.includes(kind)) kinds.push(kind)
  }
  return kinds
}

/** @param {string[]} items */
function listOf(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * @param {any} input the PreToolUse hook's JSON
 * @param {Iterable<string>} [savedNames]
 * @returns {object | null} the JSON to print, or null for "no decision"
 */
export function preToolUse(input, savedNames = []) {
  if (!SHELL_TOOLS.has(input?.tool_name)) return null
  const command = input?.tool_input?.command
  if (typeof command !== 'string') return null
  const found = checkCommand(command, savedNames)
  if (!found) return null
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: found.reason },
  }
}

/**
 * @param {any} input the UserPromptSubmit hook's JSON
 * @returns {object | null} the JSON to print, or null when nothing looks like a key
 */
export function userPromptSubmit(input) {
  const kinds = typeof input?.prompt === 'string' ? checkPrompt(input.prompt) : []
  if (kinds.length === 0) return null
  const what = listOf(kinds)
  return {
    systemMessage: `keyprompt: this message looks like it contains ${what}. It goes to Claude as written, so treat any key in it as exposed: rotate each one at the provider, then save the new one with keyprompt set NAME.`,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `keyprompt guard: this message looks like it contains ${what}. Do not repeat it, write it to a file or put it in a command. Suggest rotating it at the provider and saving the new one with \`keyprompt set NAME\`, then using it through \`keyprompt run NAME -- COMMAND\`.`,
    },
  }
}
