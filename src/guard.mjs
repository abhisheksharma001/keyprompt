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
/** The reason when the guard cannot finish reading a command that names a read tool: nested too deep, or more work than the budget (S-67, D-25). */
const UNREAD =
  "keyprompt guard: this command is too long or too deeply nested for the guard to read, and it names the OS password store's read tool, so it is refused."
/** The reason when the text after a PowerShell `-c` opens a quote or block comment and never closes it (S-67, B-32 item 11). */
const UNCLOSED =
  "keyprompt guard: this command has text after a PowerShell `-c` or `-Command` flag that opens a quote or block comment and never closes it, so the guard cannot finish reading it, and it names the OS password store's read tool, so it is refused."
/** What a text names when it names a store's read tool, in lower case. */
const READ_TOOLS = ['find-generic-password', 'dump-keychain', 'secret-tool', 'get-storedcredential', 'credread']
/**
 * The work budget (S-67, B-32 item 17): the most characters all the readings of one command may scan together,
 * `WORK_PER_CHAR` for each character of the command plus `WORK_BASE`, and never more than `WORK_MOST`. Measured
 * on the builder's machine: reading takes 20 to 60 ms per million characters scanned, and 1 MB of the worst
 * shape known (a later word named `pwsh` after each nested call) scans 64 characters per character read both
 * ways. The step's 64 per character let that shape take 2 to 4 s; 12 per character, which still covers the
 * nested shapes the timing tests use (12 per character read both ways), cuts it off in about 0.8 s, and the cap
 * keeps any command under about 1 s of reading, far inside the hook's 10 seconds.
 */
const WORK_PER_CHAR = 12
const WORK_BASE = 1000000
const WORK_MOST = 16000000
/** Thrown when the budget runs out, to stop reading at once. */
const OUT_OF_WORK = Symbol('out of work')
const RUN_INSTEAD =
  "Run the command that needs the secret with `keyprompt run NAME -- COMMAND` instead: the value then goes only into that command's environment, and exact copies of it in the output are masked. If the command only quotes such a read as text (a commit message, a pull request body), write that text to a file with your file tool and pass the file instead (`git commit -F FILE`, `gh pr create --body-file FILE`)."

/** Words that come before the real command without changing which command runs. */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'time', 'nohup', 'nice', 'rtk', '{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until'])
/**
 * Commands that only print, search or store text, so a read they mention is
 * text (S-57). None runs a command line from its options; `rg --pre COMMAND`
 * runs one program with a file path as its only argument (ripgrep's
 * `--pre` docs), so a read through it needs a script file, which the guard
 * cannot see anyway. Two limits, both logged in docs/bugs.md (B-27, B-32):
 * a command can define its own `echo` or `grep` as a function or alias, and
 * zsh's `printf -v` runs the command substitution inside a name it is
 * given. `git` and `gh` are not
 * here: `git bisect run` or `git rebase --exec` runs a command, and a
 * mention inside a quoted commit message or pull request body (`-m "…"`,
 * `--body "…"`) is one word, which the read check never matches. A
 * here-document body is read as commands (B-26, S-58).
 */
const TEXT_ONLY = new Set(['echo', 'printf', 'cat', 'tee', 'grep', 'egrep', 'fgrep', 'rg', 'write-output', 'write-host'])
/** Shells whose `-c` argument is a script that runs. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'powershell.exe', 'pwsh.exe'])
/** Commands whose words after `--` are another command (`keyprompt run X -- COMMAND`), where main's reading looks. */
const LAUNCHERS = new Set(['keyprompt', 'keyprompt.mjs', 'npx', 'node'])
/** Tools whose `tool_input.command` is shell text (R-12: PowerShell has the same fields as Bash). */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor'])
/** `security find-generic-password` options that take a value (`man security`, macOS 27.0). */
const SECURITY_VALUES = new Set(['a', 'c', 'C', 'D', 'G', 'j', 'l', 's'])

/** @param {string} word */
function base(word) {
  return word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1).toLowerCase()
}

/**
 * Whether a text names one of the store's read tools, with quotes, backslashes, backticks and line breaks taken
 * out of it first (`find-generic-"password"`). It looks at the text as it stands, so it answers for a text the
 * guard could not read to the end. One pass per tool name with `includes`, no regular expression.
 *
 * @param {string} text
 */
function mentionsRead(text) {
  let flat = text.toLowerCase()
  for (const dropped of ['\\', '`', "'", '"', '\r', '\n']) flat = flat.replaceAll(dropped, '')
  return READ_TOOLS.some((tool) => flat.includes(tool))
}

/**
 * Split shell text into simple commands (lists of words, quotes removed) at
 * `;`, `&`, `|`, newlines and parentheses. Text inside `$(...)` or backticks,
 * even within double quotes, comes back as a nested script, because the shell
 * runs it; a single- or double-quoted string otherwise stays one word. A `#`
 * at the start of the text or after a blank, `;`, `&`, `|` or a newline
 * comments out the rest of the line; after anything else, such as `)` or `}`,
 * it can be part of a word (`cat <(true)#`, `a=(x)#`, zsh's `(#i)`,
 * PowerShell's `${a}#`), so it is read as text. A line continuation joins two
 * lines. With `comments` false, `#` and `<#` are plain characters, as main
 * read them.
 *
 * With `powershell`, the text is read the way PowerShell reads it
 * (about_Quoting_Rules, about_Parsing): the backtick is the escape character
 * and `\` is a plain character, a doubled quote inside quotes is a quote,
 * curly quotes are quotes (CharTraits.cs), braces also end a command,
 * backticks run nothing, and `<#` where a word starts opens a comment that
 * ends at the first `#>` (about_Comments; tokenizer.cs, ScanBlockComment).
 *
 * `open` is true when the text ends inside something it opened and never
 * closed: a quote, a `<#` comment, `$(` or a backtick (S-67).
 *
 * @param {string} text
 * @param {boolean} [powershell]
 * @param {boolean} [comments] skip comments
 * @param {{ left: number }} [limit] the work budget: the text's length is taken off `left`, and reading stops (throws `OUT_OF_WORK`) when it goes below 0
 * @returns {{ commands: string[][], nested: string[], open: boolean }}
 */
export function splitShell(text, powershell = false, comments = true, limit) {
  if (limit && (limit.left -= text.length) < 0) throw OUT_OF_WORK
  if (powershell) text = text.replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"')
  const escape = powershell ? '`' : '\\'
  /** @type {string[][]} */
  const commands = []
  /** @type {string[]} */
  const nested = []
  /** @type {string[]} */
  let words = []
  let word = ''
  let inWord = false
  let open = false
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
      if (text[j] === escape) j++
      else if (text[j] === '(') depth++
      else if (text[j] === ')') depth--
      j++
    }
    if (depth > 0) open = true
    nested.push(text.slice(start, depth === 0 ? j - 1 : j))
    return j
  }
  /** @param {number} start index just after the opening backtick @returns {number} */
  const backtick = (start) => {
    const end = text.indexOf('`', start)
    const stop = end === -1 ? text.length : end
    if (end === -1) open = true
    nested.push(text.slice(start, stop))
    return stop + 1
  }

  /**
   * A line continuation: Bash drops a backslash-newline, PowerShell a backtick at the end of a line.
   * @param {number} at index of the escape character @returns {number} characters to skip, or 0
   */
  const continuation = (at) => {
    if (text[at + 1] === '\n') return 2
    return powershell && text.startsWith('\r\n', at + 1) ? 3 : 0
  }
  const separators = powershell ? ';&|\n(){}' : ';&|\n()'

  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === escape) {
      const skip = continuation(i)
      if (skip === 0) {
        word += text[i + 1] ?? ''
        inWord = true
      }
      i += skip || 2
    } else if (comments && c === '#' && !inWord && (i === 0 || ' \t\n;&|'.includes(text[i - 1]))) {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
    } else if (comments && powershell && c === '<' && text[i + 1] === '#' && !inWord) {
      const end = text.indexOf('#>', i + 2)
      if (end === -1) open = true
      i = end === -1 ? text.length : end + 2
    } else if (c === "'") {
      inWord = true
      i++
      while (i < text.length && (text[i] !== "'" || (powershell && text[i + 1] === "'"))) {
        word += text[i]
        i += text[i] === "'" ? 2 : 1
      }
      if (i >= text.length) open = true
      i++
    } else if (c === '"') {
      inWord = true
      i++
      while (i < text.length && (text[i] !== '"' || (powershell && text[i + 1] === '"'))) {
        if (text[i] === '"') {
          word += '"'
          i += 2
        } else if (text[i] === escape && i + 1 < text.length) {
          // In Bash a backslash inside double quotes escapes only $ ` " \ and a newline; before anything else it stays.
          const skip = continuation(i)
          if (skip === 0) word += powershell || '$`"\\'.includes(text[i + 1]) ? text[i + 1] : text[i] + text[i + 1]
          i += skip || 2
        } else if (text[i] === '$' && text[i + 1] === '(') {
          i = subshell(i + 2)
        } else if (text[i] === '`') {
          i = backtick(i + 1)
        } else {
          word += text[i]
          i++
        }
      }
      if (i >= text.length) open = true
      i++
    } else if (c === '$' && text[i + 1] === '(') {
      i = subshell(i + 2)
    } else if (c === '`') {
      i = backtick(i + 1)
    } else if (separators.includes(c)) {
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
  return { commands, nested, open }
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
    // `security` reads options the getopt way: `-wskeyprompt` is `-w -s keyprompt`, and `-skeyprompt` is `-s keyprompt`.
    let prints = false
    let named = false
    for (let k = 0; k < rest.length; k++) {
      const w = rest[k]
      if (!/^-[^-]/.test(w)) {
        named ||= namesKeyprompt(w, names)
        continue
      }
      for (let j = 1; j < w.length; j++) {
        if (SECURITY_VALUES.has(w[j])) {
          named ||= namesKeyprompt(j + 1 < w.length ? w.slice(j + 1) : (rest[++k] ?? ''), names)
          break
        }
        if (w[j] === 'g' || w[j] === 'w') prints = true
      }
    }
    return prints && named ? READS : null
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
 * @param {number} [from] where the command's words begin
 */
function commandStart(words, from = 0) {
  let i = words.length > from + 2 && words[from + 1] === '=' ? from + 2 : from
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

/** @type {Record<string, string[]>} the subcommands of each store's read tool that read */
const READ_SUBCOMMANDS = { security: ['find-generic-password', 'dump-keychain'], 'secret-tool': ['lookup', 'search'] }

/**
 * For each index, the first index at or after it whose word passes `test`
 * (`words.length` when none does).
 *
 * @param {string[]} words
 * @param {(word: string) => boolean} test
 */
function nextMatch(words, test) {
  const next = new Array(words.length + 1).fill(words.length)
  for (let k = words.length - 1; k >= 0; k--) next[k] = test(words[k]) ? k : next[k + 1]
  return next
}

/**
 * A read anywhere among a command's words, so that no list of wrappers is
 * needed (`timeout 5 …`, `xargs …`, `find … -exec …`), unless the command only
 * prints, searches or stores text (S-57).
 *
 * Each kind of read is checked once, at its first word: a later one sees only
 * the tail of the same words, read the same way, so it can find nothing new.
 * A shell's script is read once per `-c` word, and a PowerShell tail once (see
 * below). That keeps the check linear in the command's length, because the
 * hook times out after 10 seconds and Claude Code then runs the command
 * (`src/install-guard.mjs`).
 *
 * With `comments` false this is main's reading: only the command's own word is
 * looked at (with its options, a shell's `-c` script and `eval`'s words), or
 * for a launcher the command after its `--`.
 *
 * @param {string[]} words one simple command
 * @param {Set<string>} names
 * @param {number} depth
 * @param {boolean} comments the words come from a reading that skips comments
 * @param {{ left: number }} [limit] the work budget
 * @returns {string | null} the reason, when the command is a direct read
 */
function readInWords(words, names, depth, comments, limit) {
  let start = commandStart(words)
  if (start >= words.length) return null
  // An option skipped before the first word may have taken it as its value (`env -u echo …`), so only a start past no option counts as text.
  if (TEXT_ONLY.has(base(words[start])) && !words.slice(0, start).some((w) => w.startsWith('-'))) return null
  let end = words.length
  if (!comments) {
    // Followed in one pass, so `keyprompt -- keyprompt -- …` stays linear.
    for (let dash; LAUNCHERS.has(base(words[start])) && (dash = words.indexOf('--', start + 1)) !== -1; ) {
      start = commandStart(words, dash + 1)
      if (start >= words.length) return null
    }
    end = start + 1
  }
  const from = comments ? 0 : start
  const checked = new Set()
  const plain = nextMatch(words, (w) => !w.startsWith('-'))
  /** @type {Record<string, number[]>} */
  const flags = {}
  /** @type {number[] | undefined} */
  let pwshWords
  for (let i = from; i < end; i++) {
    const command = base(words[i])
    /** @type {string | null} */
    let found = null
    if (command === 'eval' && i === start) {
      // eval, as the command, runs every word after it as one script, which settles the rest of the command.
      // A word that only ends in `eval` (`X=/bin/eval`, `find -name eval`, an option's value) runs nothing, and joining the words after it would drop their quoting.
      return readScript(words.slice(i + 1).join(' '), names, depth + 1, false, comments, limit)
    } else if (command === 'security' || command === 'secret-tool') {
      const sub = plain[i + 1]
      const key = `${command} ${words[sub]}`
      if (READ_SUBCOMMANDS[command].includes(words[sub]) && !checked.has(key)) {
        checked.add(key)
        found = (command === 'security' ? securityRead : secretToolRead)(words.slice(sub), names)
      }
    } else if (command === 'get-storedcredential' && !checked.has(command)) {
      // Windows: the CredentialManager module's cmdlet, naming a keyprompt target or a saved name (R-12).
      checked.add(command)
      found = words.slice(i + 1).some((w) => namesKeyprompt(w, names)) ? READS : null
    } else if (SHELLS.has(command)) {
      // PowerShell: everything after -Command (or -c) is the script. Other shells: the one word after -c (or -lc, -ec ...).
      const powershell = command.startsWith('pwsh') || command.startsWith('powershell')
      const kind = powershell ? 'powershell' : 'shell'
      flags[kind] ??= nextMatch(words, (w) => (powershell ? /^-c(ommand)?$/i.test(w) : /^-[a-z]{0,3}c[a-z]{0,3}$/.test(w)))
      const flag = flags[kind][i + 1]
      /** @type {[string, () => string, boolean?][]} each script to read, under the key that marks it read, and whether to refuse one that ends open; built only when read, so a skipped one costs nothing */
      const scripts = []
      if (flag + 1 >= words.length) {
        // No script follows.
      } else if (!powershell) {
        scripts.push([`shell ${flag}`, () => words[flag + 1]])
      } else if (i === start) {
        // As the command, pwsh takes every word after the flag as its script, so that check settles the rest.
        scripts.push([`powershell ${flag}`, () => words.slice(flag + 1).join(' ')])
        end = Math.min(end, flag + 1)
      } else {
        // Elsewhere (`find … -exec pwsh -c …`) it may be no call at all (`find -name pwsh -o -name -c`), and its words can open a quote or a
        // block comment that hides a real call after it. So the words up to the next PowerShell word are read on their own, once per flag:
        // those stretches never overlap, which keeps this linear. The whole tail is read once too, for a script that runs past a later
        // word named pwsh (one whole-tail read per `pwsh -c`, over 200 of them, took minutes). With no PowerShell word after the
        // flag, the stretch is the tail, so it is read once for both: reading it twice doubled the work at each nesting level.
        // Reading the tail once assumes a later flag would see the same words the same way. A tail that ends inside a quote or a block
        // comment breaks that: a later `pwsh -c` starts outside it, so what runs after it was never read. Such a tail is refused when
        // the text names a read tool (S-67, B-32 item 11). The stretch needs no such check: a read it leaves out sits behind a later word
        // named pwsh, which the tail covers.
        pwshWords ??= nextMatch(words, (w) => SHELLS.has(base(w)) && /^(pwsh|powershell)/.test(base(w)))
        const stop = pwshWords[flag + 1]
        scripts.push([`powershell ${flag}`, () => words.slice(flag + 1, stop).join(' ')])
        if (stop === words.length) checked.add('powershell tail')
        else scripts.push(['powershell tail', () => words.slice(flag + 1).join(' '), true])
      }
      for (const [key, script, refuseOpen] of scripts) {
        if (found || checked.has(key)) continue
        checked.add(key)
        found = readScript(script(), names, depth + 1, powershell, comments, limit, refuseOpen)
      }
    }
    if (found) return found
  }
  return null
}

/**
 * @param {string} text
 * @param {Set<string>} names
 * @param {number} depth
 * @param {boolean} powershell read the text as PowerShell, not as a POSIX shell
 * @param {boolean} comments skip comments and look for a read anywhere in a command; false is main's reading
 * @param {{ left: number }} [limit] the work budget
 * @param {boolean} [refuseOpen] refuse a text that ends inside a quote or block comment and names a read tool, when nothing else was found
 * @returns {string | null}
 */
function readInShell(text, names, depth, powershell, comments, limit, refuseOpen) {
  // Past the depth limit the text is not read. A text that names a read tool is refused (S-67, B-32 item 5), so too much nesting never reads as "no read".
  if (depth > 4) return mentionsRead(text) ? UNREAD : null
  const { commands, nested, open } = splitShell(text, powershell, comments, limit)
  for (const words of commands) {
    const found = readInWords(words, names, depth, comments, limit)
    if (found) return found
  }
  // Windows: CredRead through Add-Type (how keyprompt itself reads, `src/store/windows.mjs`), naming a keyprompt target or a saved name.
  const runsAddType = commands.some((words) => base(words[commandStart(words)] ?? '') === 'add-type')
  if (runsAddType && /credread/i.test(text)) {
    const lower = text.toLowerCase()
    if (lower.includes(`${SERVICE}:`) || [...names].some((name) => wordIn(text, name))) return READS
  }
  for (const script of nested) {
    const found = readScript(script, names, depth + 1, powershell, comments, limit)
    if (found) return found
  }
  if (refuseOpen && open && mentionsRead(text)) return UNCLOSED
  return null
}

/**
 * Read a text two ways, and refuse if either finds a read: skipping comments
 * and looking for a read anywhere in a command, then with main's rules, no
 * comments and only each command's own word. A `#` starts no comment inside
 * `${…}`, `(( ))`, an unquoted here-document line or PowerShell's `${…}`, so
 * the first reading can miss a read there that main, which read no comments,
 * refused. The second reads a comment as main did: `ls # see <read>` passes,
 * and `ls # see; <read>` is refused (S-57 senior review, round 2).
 *
 * @param {string} text
 * @param {Set<string>} names
 * @param {number} depth
 * @param {boolean} powershell
 * @param {{ left: number }} [limit] the work budget
 * @param {boolean} [refuseOpen]
 * @returns {string | null}
 */
function readBoth(text, names, depth, powershell, limit, refuseOpen) {
  return readInShell(text, names, depth, powershell, true, limit, refuseOpen) || readInShell(text, names, depth, powershell, false, limit, refuseOpen)
}

/**
 * A script that a command runs, or one in `$( )` or backticks, read the same
 * way as the text it came from; but a script main's rules reach is read both
 * ways, because checking only its first word would hide a wrapper inside it
 * (`# $(timeout 5 <read>)` on a here-document line).
 *
 * @param {string} text
 * @param {Set<string>} names
 * @param {number} depth
 * @param {boolean} powershell
 * @param {boolean} comments
 * @param {{ left: number }} [limit] the work budget
 * @param {boolean} [refuseOpen]
 * @returns {string | null}
 */
function readScript(text, names, depth, powershell, comments, limit, refuseOpen) {
  return comments ? readInShell(text, names, depth, powershell, true, limit, refuseOpen) : readBoth(text, names, depth, powershell, limit, refuseOpen)
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
 * @param {'bash' | 'powershell'} [shell] which shell runs the text; when not known, it is read both ways
 * @param {number} [workLimit] the characters all the readings may scan together (tests lower it); by default the work budget for the command's length
 * @returns {{ reason: string } | null}
 */
export function checkCommand(command, savedNames = [], shell, workLimit = Math.min(WORK_PER_CHAR * command.length + WORK_BASE, WORK_MOST)) {
  const names = new Set(savedNames)
  const limit = { left: workLimit }
  /** @type {string | null | false} */
  let found
  try {
    found = (shell !== 'powershell' && readBoth(command, names, 0, false, limit)) || (shell !== 'bash' && readBoth(command, names, 0, true, limit))
  } catch (error) {
    if (error !== OUT_OF_WORK) throw error
    // The budget ran out before a read was found: slowness must never turn into a pass, so a command that names a read tool is refused.
    found = mentionsRead(command) ? UNREAD : null
  }
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
  // The Bash tool runs Bash and the PowerShell tool PowerShell; a Monitor command is read both ways.
  const shell = input.tool_name === 'Bash' ? 'bash' : input.tool_name === 'PowerShell' ? 'powershell' : undefined
  const found = checkCommand(command, savedNames, shell)
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
