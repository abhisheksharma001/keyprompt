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
/** The reason when the words after a PowerShell `-c` flag, read as PowerShell, open a quote, a block comment or `$(` and never close it (S-67, B-32 item 11). It says "read as PowerShell" because the quote may be opened only by the guard's reading of those words as PowerShell, not by the text as written (an apostrophe inside bash double quotes in a later word of a `find` command). */
const UNCLOSED =
  "keyprompt guard: read as PowerShell, the words after a `-c` or `-Command` flag in this command open a quote, a block comment or `$(` that never closes, so the guard cannot finish reading them, and the command names the OS password store's read tool, so it is refused."
/** What a text names when it names a store's read tool, in lower case. Keep in step with `READ_SUBCOMMANDS`, the `get-storedcredential` branch of `readInWords` and the `credread` rule of `readInShell`: a read added there and not here is refused when read, but not past the depth or work limit. */
const READ_TOOLS = ['find-generic-password', 'dump-keychain', 'secret-tool', 'get-storedcredential', 'credread']
/**
 * The work budget (S-67, B-32 item 17): the most characters all the readings of one command may scan together,
 * `WORK_PER_CHAR` for each character of the command plus `WORK_BASE`, and never more than `WORK_MOST`. Measured
 * on the builder's machine: reading takes 20 to 60 ms per million characters scanned, and 1 MB of the worst
 * shape known (a later word named `pwsh` after each nested call) scans 64 characters per character read both
 * ways. The step's 64 per character let that shape take 2 to 4 s; 12 per character, which still covers the
 * nested shapes the timing tests use (12 per character read both ways), cuts it off in about 0.8 s, and the cap
 * keeps the reading of any command under about 1 s, far inside the hook's 10 seconds. The name check that answers
 * after the budget runs out (`mentionsRead`) is not charged to it: it is one pass of 3 to 50 ns per character, measured on
 * the worst shapes found (CPU time, not wall time), so even 60 MB, more than a model can emit, costs under 3 seconds.
 */
const WORK_PER_CHAR = 12
const WORK_BASE = 1000000
const WORK_MOST = 16000000
/**
 * What the readings of one command share: `left`, the work budget, and three marks for S-68 (B-32 item 1). `exempted` is set when a text-only
 * command was let through unread, `defines` when any text read has a word that defines a function or alias, and `strict` makes the next
 * reading read a text-only command word like `eval` instead of exempting it.
 * @typedef {{ left: number, defines?: boolean, exempted?: boolean, strict?: boolean }} Limit
 */
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
 * cannot see anyway. A command that defines a function or alias is read again
 * without this exemption, each such word read like `eval` (S-68, B-32 item 1).
 * One limit stays, logged in docs/bugs.md (B-27): zsh's `printf -v` runs the
 * command substitution inside a name it is
 * given. `git` and `gh` are not
 * here: `git bisect run` or `git rebase --exec` runs a command, and a
 * mention inside a quoted commit message or pull request body (`-m "…"`,
 * `--body "…"`) is one word, which the read check never matches. A
 * here-document body is read as commands (B-26, S-58).
 */
const TEXT_ONLY = new Set(['echo', 'printf', 'cat', 'tee', 'grep', 'egrep', 'fgrep', 'rg', 'write-output', 'write-host'])
/** Shells whose `-c` argument is a script that runs. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'powershell.exe', 'pwsh.exe'])
/**
 * zsh's precommand modifiers that `WRAPPERS` does not hold (zsh manual, "Precommand Modifiers" and "Complex Commands"; S-68, B-32 item 12). They only
 * help find `eval` (`noglob eval "…"` runs it): a text-only command behind one is refused as before, so `commandStart` is told when to count them.
 */
const ZSH_MODIFIERS = new Set(['noglob', 'nocorrect', 'coproc', '-'])
/** Words that define a function or an alias, so any later command word may mean something else (S-68, B-32 item 1). */
const DEFINERS = new Set(['function', 'alias', 'set-alias', 'new-alias', 'sal', 'nal'])
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

/** For each read tool and each character code below 128, the places in the tool's name where that character stands, one bit per place. */
const NAME_BITS = READ_TOOLS.map((tool) => {
  const bits = new Int32Array(128)
  for (let i = 0; i < tool.length; i++) bits[tool.charCodeAt(i)] |= 1 << i
  return bits
})
/** For each character code below 128, the tools (one bit each) whose name starts with it. */
const STARTS = new Int32Array(128)
READ_TOOLS.forEach((tool, t) => (STARTS[tool.charCodeAt(0)] |= 1 << t))
/**
 * What `splitShell` can do with a character it does not keep in a word, for each character code below 128. `mentionsRead` is
 * built from this table alone, and test/b32-guard-unfinished.test.mjs checks the table against `splitShell` itself (every text
 * of up to 4 special characters, every two letters with up to 4 of them between, and 20,000 longer texts, each read all four
 * ways), so a parser that learns to take something new out of a word fails that test until this table knows it too.
 *
 * DROPPED: taken out one at a time: the backslash, `'`, `"`, and the CR and LF of a line continuation. The curly quotes U+2018
 * to U+201E, which PowerShell reads as quotes, are DROPPED too (they are above 128, so `mentionsRead` names them itself).
 * TICK: the backtick, which is taken out one at a time (PowerShell's escape character) and also opens or ends a span.
 * DOLLAR and then OPENS: `$(` opens a span. ENDS: `)` ends one.
 */
const KEPT = 0
const DROPPED = 1
const TICK = 2
const DOLLAR = 3
const OPENS = 4
const ENDS = 5
const KIND = new Uint8Array(128)
for (const c of '\\\'"\r\n') KIND[c.charCodeAt(0)] = DROPPED
KIND[96] = TICK
KIND[36] = DOLLAR
KIND[40] = OPENS
KIND[41] = ENDS

/**
 * Whether a text holds one of the store's read tools' names in a way that a reading of it, at any nesting level, could put
 * together into the name. It answers for a text the guard could not read to the end, so it has to say yes for every text the
 * full reading would refuse.
 *
 * The rule. The letters of a name stand in the text in order, and what stands between two letters that are next to each other
 * in the name (a gap) is made only of these pieces, any number of them in a row:
 *   - a DROPPED character or a backtick;
 *   - a `$`, then anything, then a `(`, then anything, then a `)` or a backtick;
 *   - a backtick, then anything, then a backtick or a `)`.
 *
 * Why that covers the parser. Every text a deeper reading sees is made from the text one level up in one of two ways: it is a
 * piece cut out of it (a `$( )` or backtick span), or it is words of one command, as `splitShell` gives them, joined with a
 * blank (`eval`, a shell's `-c`). `splitShell` never moves or copies a character and makes up none but a blank or a straight
 * quote: it only leaves characters out. Out of the middle of a word it leaves a character in two ways only: one at a time (the
 * DROPPED ones and the backtick), or inside a span that starts at `$(` or a backtick and ends at a `)` or a backtick, whatever
 * is in it. So after one reading a gap is made of the pieces above, with the `$` and the `(` next to each other. A second
 * reading can find a `$(` whose two characters had something between them that the first reading left out (`$''(`, `\$\(`,
 * `$$(true)(`), which is why the rule allows anything between them; and a blank that a join put in can only be left out as
 * part of a span, where anything is allowed already. A gap made of these pieces, with more such pieces between its characters,
 * is again made of these pieces, so the rule holds for any number of readings: no way of quoting a read for an outer shell
 * steps outside it. The test file checks the two halves of this: `splitShell` against the rule, and this function against the
 * rule written out the slow way.
 *
 * It is not exact in the other direction: it also refuses a text that only looks like a split name, such as "`secret-` and
 * `tool`" in a pull request body, or `secret-$x (y)tool`. That is the cost of refusing when unsure, and it applies only where
 * this function is asked: a command too long or too deeply nested to read, or a PowerShell tail left open.
 *
 * One pass over the text, three numbers per tool, nothing allocated per character, no regular expression.
 *
 * @param {string} text
 */
function mentionsRead(text) {
  const lower = text.toLowerCase()
  const tools = READ_TOOLS.length
  // Per tool, bit j set: the first j letters of its name have been read, and what came after them is whole pieces (bit 0 is always set, since a name can start anywhere).
  const plain = new Int32Array(tools).fill(1)
  // The same, with a `$` read after those letters and its `(` not yet. Once set it stays: anything may stand before the `(`.
  const dollar = new Int32Array(tools)
  // The same, with a span opened after those letters. Once set it stays: anything may stand before the character that ends it.
  const span = new Int32Array(tools)
  // The tools (one bit each) with a letter read in `plain`, in `dollar` and in `span`: only they, and the ones this character starts, need work.
  let inPlain = 0
  let inDollar = 0
  let inSpan = 0
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i)
    const ascii = c < 128
    const kind = ascii ? KIND[c] : c >= 0x2018 && c <= 0x201e ? DROPPED : KEPT
    const todo = inPlain | (ascii ? STARTS[c] : 0) | (kind === OPENS ? inDollar : kind === ENDS || kind === TICK ? inSpan : 0)
    if (todo === 0) continue
    for (let t = 0; t < tools; t++) {
      const bit = 1 << t
      if ((todo & bit) === 0) continue
      const was = plain[t]
      let now = ascii ? 1 | ((was & NAME_BITS[t][c]) << 1) : 1
      if (kind === DROPPED) now |= was
      else if (kind === TICK) {
        now |= was | span[t]
        if ((span[t] |= was) > 1) inSpan |= bit
      } else if (kind === DOLLAR) {
        if ((dollar[t] |= was) > 1) inDollar |= bit
      } else if (kind === OPENS) {
        if ((span[t] |= dollar[t]) > 1) inSpan |= bit
      } else if (kind === ENDS) now |= span[t]
      plain[t] = now
      if (now & (1 << READ_TOOLS[t].length)) return true
      if (now > 1) inPlain |= bit
      else inPlain &= ~bit
    }
  }
  return false
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
 * `defines` is true when the text, outside quotes, has a word that defines a function or an alias (`function`, `alias`,
 * `Set-Alias` …) or, read as a POSIX shell, a word followed by `()` (S-68, B-32 item 1). Quotes and escapes are already taken
 * out of the words, so `fun''ction` and `e\cho()` count. It is a coarse sign: it can be true when nothing is defined.
 *
 * @param {string} text
 * @param {boolean} [powershell]
 * @param {boolean} [comments] skip comments
 * @param {Limit} [limit] the work budget: the text's length is taken off `left`, and reading stops (throws `OUT_OF_WORK`) when it goes below 0
 * @returns {{ commands: string[][], nested: string[], open: boolean, defines: boolean }}
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
  let defines = false
  const endWord = () => {
    if (inWord) {
      words.push(word)
      if (word.length <= 9 && DEFINERS.has(word.toLowerCase())) defines = true
    }
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
      if (c === '(' && !powershell && !defines && emptyParensAfterWord(text, i)) defines = true
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
  return { commands, nested, open, defines }
}

/**
 * Whether the `(` at `at` closes right away (`)` after only blanks) and a word comes right before it (only blanks between), as in
 * `echo() {` or `f ( ) {`: the shape of a function definition (S-68). `a=()`, `<()` and `$()` are not, and a `(` after `;`, `|`, a
 * newline or another bracket is not. Each blank run is read at most once by the `(` next to it, so this is linear.
 *
 * @param {string} text
 * @param {number} at index of the `(`
 */
function emptyParensAfterWord(text, at) {
  let before = at - 1
  while (before >= 0 && (text[before] === ' ' || text[before] === '\t')) before--
  if (before < 0 || ';&|\n\r(){}=<>$'.includes(text[before])) return false
  let after = at + 1
  while (after < text.length && (text[after] === ' ' || text[after] === '\t')) after++
  return text[after] === ')'
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
 * With `zsh`, also past zsh's precommand modifiers and `repeat COUNT` (S-68, B-32 item 12). The count is skipped unless it is
 * `eval`, `repeat` or a wrapper: a count written `$(…)` or in backticks leaves no word (`splitShell` keeps nothing of a span
 * outside quotes), and then the next word is the command, which must not be taken for the count.
 *
 * @param {string[]} words
 * @param {number} [from] where the command's words begin
 * @param {boolean} [zsh] count zsh's modifiers and `repeat`
 */
function commandStart(words, from = 0, zsh = false) {
  let i = words.length > from + 2 && words[from + 1] === '=' ? from + 2 : from
  let wrapper = ''
  while (i < words.length) {
    const w = words[i]
    if (zsh && base(w) === 'repeat') {
      const count = words[i + 1]
      i += count !== undefined && base(count) !== 'eval' && base(count) !== 'repeat' && !WRAPPERS.has(base(count)) && !ZSH_MODIFIERS.has(base(count)) ? 2 : 1
      wrapper = ''
      continue
    }
    if (WRAPPERS.has(base(w)) || (zsh && ZSH_MODIFIERS.has(base(w)))) wrapper = base(w)
    else if (wrapper && w.startsWith('-')) {
      // sudo and doas options that take a value: `sudo -u root security ...`
      if ((wrapper === 'sudo' || wrapper === 'doas') && /^-[ugUCDhprt]$/.test(w)) i++
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) break
    i++
  }
  return i
}

/**
 * For each index, where `security`'s subcommand is if its options start there: the first word that does not start with `-`, past
 * the value of each `-p` (`man security`: `security [-hilqv] [-p prompt] [command] …`, so `-p` is the only global option that takes a
 * value; S-68, B-32 item 10, open flag F2). `-p x`, `-px`, `-qp x` and `-qpx` all give `x` as the prompt. Made in one pass from the
 * end, so a long chain of `-p` options costs no more than its length.
 *
 * @param {string[]} words
 */
function securitySubs(words) {
  const sub = new Array(words.length + 2).fill(words.length)
  for (let k = words.length - 1; k >= 0; k--) {
    const w = words[k]
    sub[k] = !w.startsWith('-') ? k : sub[k + (/^-(?:[^p-][^p]*)?p$/.test(w) ? 2 : 1)]
  }
  return sub
}

/**
 * The words after a POSIX shell's `-c` flag that can be its script (S-68, B-32 item 4; open flag F4: bash and zsh, checked with
 * `echo` on bash 3.2 and zsh 5.9, and the GNU Bash manual, "Invoking Bash"). The script is the first word that is not an option;
 * `--` ends the options; an option with `o` or `O` in it (`-o`, `+o`, `-O`, `-co`) takes the next word as its value, which is read
 * as a script too (zsh takes the value of `-O` as the script). The word right after the flag is always read, as main read it.
 *
 * @param {string[]} words
 * @param {number} flag index of the `-c` word
 * @returns {number[]} indexes of the words to read as scripts
 */
function shellScripts(words, flag) {
  const out = [flag + 1]
  const takesValue = (/** @type {string} */ w) => /^[-+][A-Za-z]*[oO]/.test(w)
  let value = takesValue(words[flag])
  for (let k = flag + 1; k < words.length; k++) {
    const w = words[k]
    if (value) {
      value = false
      if (k !== flag + 1) out.push(k)
    } else if (w === '--') {
      if (k + 1 < words.length) out.push(k + 1)
      break
    } else if (w.startsWith('-') || w.startsWith('+')) {
      value = takesValue(w)
    } else {
      if (k !== flag + 1) out.push(k)
      break
    }
  }
  return out
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
 * @param {Limit} [limit] the work budget
 * @returns {string | null} the reason, when the command is a direct read
 */
function readInWords(words, names, depth, comments, limit) {
  const textStart = commandStart(words)
  let start = commandStart(words, 0, true)
  if (start >= words.length) return null
  // An option skipped before the first word may have taken it as its value (`env -u echo …`), so only a start past no option counts as text.
  // zsh's modifiers do not count here, so a text-only command behind one is refused as before.
  const text = textStart < words.length && TEXT_ONLY.has(base(words[textStart])) && !words.slice(0, textStart).some((w) => w.startsWith('-'))
  // A command that defines a function or alias may have redefined the text-only name (S-68, B-32 item 1). The first reading uses the exemption and
  // notes that it did; `checkCommand` reads again without it when the command also defines something, and then such a word is read like `eval`.
  if (text && !limit?.strict) {
    if (limit) limit.exempted = true
    return null
  }
  let end = words.length
  if (!comments) {
    // Followed in one pass, so `keyprompt -- keyprompt -- …` stays linear.
    for (let dash; LAUNCHERS.has(base(words[start])) && (dash = words.indexOf('--', start + 1)) !== -1; ) {
      start = commandStart(words, dash + 1, true)
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
  /** @type {number[] | undefined} */
  let securitySub
  for (let i = from; i < end; i++) {
    const command = base(words[i])
    /** @type {string | null} */
    let found = null
    if ((command === 'eval' || (limit?.strict && TEXT_ONLY.has(command))) && i === start) {
      // eval, as the command, runs every word after it as one script, which settles the rest of the command.
      // A word that only ends in `eval` (`X=/bin/eval`, `find -name eval`, an option's value) runs nothing, and joining the words after it would drop their quoting.
      return readScript(words.slice(i + 1).join(' '), names, depth + 1, false, comments, limit)
    } else if (command === 'security' || command === 'secret-tool') {
      // `security` also gets the subcommand found past the value of each `-p` (S-68, B-32 item 10); the first word that is not an option stays a
      // candidate too, so nothing main refuses is let through. Whether `security -p x find-generic-password …` runs the subcommand was not checked (F14).
      if (command === 'security') securitySub ??= securitySubs(words)
      for (const sub of command === 'security' && securitySub[i + 1] !== plain[i + 1] ? [plain[i + 1], securitySub[i + 1]] : [plain[i + 1]]) {
        const key = `${command} ${words[sub]}`
        if (READ_SUBCOMMANDS[command].includes(words[sub]) && !checked.has(key)) {
          checked.add(key)
          found = (command === 'security' ? securityRead : secretToolRead)(words.slice(sub), names)
          if (found) break
        }
      }
    } else if (command === 'get-storedcredential' && !checked.has(command)) {
      // Windows: the CredentialManager module's cmdlet, naming a keyprompt target or a saved name (R-12).
      checked.add(command)
      found = words.slice(i + 1).some((w) => namesKeyprompt(w, names)) ? READS : null
    } else if (SHELLS.has(command)) {
      // PowerShell: everything after -Command (or -c) is the script. Other shells: the one word after -c (or -lc, -ec ...).
      const powershell = command.startsWith('pwsh') || command.startsWith('powershell')
      const kind = powershell ? 'powershell' : 'shell'
      flags[kind] ??= nextMatch(words, (w) => (powershell ? /^-c(ommand)?$/i.test(w) : /^-[A-Za-z]{0,3}c[A-Za-z]{0,3}$/.test(w)))
      const flag = flags[kind][i + 1]
      /** @type {[string, () => string, boolean?][]} each script to read, under the key that marks it read, and whether to refuse one that ends open; built only when read, so a skipped one costs nothing */
      const scripts = []
      if (flag + 1 >= words.length) {
        // No script follows.
      } else if (!powershell) {
        // Past `--`, option words and option values (S-68, B-32 item 4). The words depend on the flag alone, so they are listed once per flag.
        if (!checked.has(`shell words ${flag}`)) {
          checked.add(`shell words ${flag}`)
          for (const k of shellScripts(words, flag)) scripts.push([`shell ${k}`, () => words[k]])
        }
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
 * @param {Limit} [limit] the work budget
 * @param {boolean} [refuseOpen] refuse a text that ends inside a quote, a block comment or `$(` and names a read tool, when nothing else was found
 * @returns {string | null}
 */
function readInShell(text, names, depth, powershell, comments, limit, refuseOpen) {
  // Past the depth limit the text is not read. A text that names a read tool is refused (S-67, B-32 item 5), so too much nesting never reads as "no read".
  if (depth > 4) return mentionsRead(text) ? UNREAD : null
  const { commands, nested, open, defines } = splitShell(text, powershell, comments, limit)
  if (defines && limit) limit.defines = true
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
 * @param {Limit} [limit] the work budget
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
 * @param {Limit} [limit] the work budget
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
    const read = () => (shell !== 'powershell' && readBoth(command, names, 0, false, limit)) || (shell !== 'bash' && readBoth(command, names, 0, true, limit))
    found = read()
    // The command defines a function or alias and a text-only command was let through unread: that word may mean something else, so read the
    // command again with no exemption (S-68, B-32 item 1). The same budget runs on, and if it runs out the answer is the usual one below.
    if (!found && limit.defines && limit.exempted) {
      limit.strict = true
      found = read()
    }
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
