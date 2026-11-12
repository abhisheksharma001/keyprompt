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
/** What each script that S-68 reads besides the word right after `-c` costs besides its characters, so the number of those readings is bounded too (1.6 million one-character option values after `-c` were 1.6 million readings and took 8 s). Main's readings cost their characters only, as the S-67 tests pin. */
const WORK_PER_EXTRA_SCRIPT = 64
/**
 * What the readings of one command share: `left`, the work budget, and three marks for S-68 (B-32 item 1). `exempted` is set when a text-only
 * command was let through unread, `defines` when any text read has a word that defines a function or alias, and `strict` makes the next
 * reading read a text-only command word like `eval` instead of exempting it. For S-69, `copies` counts the split copies the reading is inside,
 * and `read` holds, for each way of reading (a small number), the texts read inside a copy that held no read.
 * @typedef {{ left: number, defines?: boolean, exempted?: boolean, strict?: boolean, copies?: number, read?: Set<string>[] }} Limit
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
/**
 * Command words that define a function or an alias, or change what a name runs, so a later command word may mean something else (S-68, B-32
 * item 1): `function`, `alias`, PowerShell's `Set-Alias`, `New-Alias`, `sal`, `nal` and `filter`, and `hash` (bash `hash -p PATH NAME`, zsh
 * `hash NAME=PATH`). Only a word where a command word is expected counts, so `grep function src/` does not (`definesSomething`).
 */
const DEFINERS = new Set(['function', 'filter', 'alias', 'set-alias', 'new-alias', 'sal', 'nal', 'hash'])
/** Commands whose words after `--` are another command (`keyprompt run X -- COMMAND`), where main's reading looks. */
const LAUNCHERS = new Set(['keyprompt', 'keyprompt.mjs', 'npx', 'node'])
/** Tools whose `tool_input.command` is shell text (R-12: PowerShell has the same fields as Bash). */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor'])
/**
 * For each split copy of a command (S-69), the index of its first word made by a split. Words before it are the command's own, so a script
 * read from a flag before it is the script the original command reads too, and the nested reading splits its words again: reading it from
 * the copy would only repeat that work (it took a nested text full of split words past the work budget).
 * @type {WeakMap<string[], number>}
 */
const FIRST_SPLIT = new WeakMap()
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
 *   - a `$` that stands before a `'`, or before line continuations and a `'` (S-70: the Bash reading takes `$'…'` out of a word);
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
 * The Bash reading with the dollar forms (S-70) also leaves out a `$` that stands before a `'` (`$'…'`; line continuations may stand
 * between them), so a name written `fi$'nd'-generic-password` is one piece away from `find-generic-password`: that is the second
 * piece in the list above. It leaves out nothing else, and decodes nothing (`\x73` stays four characters), so no character is made up.
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
    // A `$` that stands before a `'`, or before line continuations and a `'`, is the start of `$'…'`, and the Bash reading leaves it out (S-70).
    const before = kind === DOLLAR && lower[dollarJoin(lower, i)] === "'"
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
        if (before) now |= was
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
 * A command with a word PowerShell splits (`-Name:value`, `$x=Cmdlet`; S-69) comes back twice in `commands`: the words as Bash reads
 * them, then the words with the splits made. The first is what main read, so nothing main refused can be lost.
 *
 * `open` is true when the text ends inside something it opened and never
 * closed: a quote, a `<#` comment, `$(` or a backtick (S-67).
 *
 * `defines` is true when, read as a POSIX shell, a word is followed by `()` (S-68, B-32 item 1: a function definition). Quotes and escapes
 * are already taken out of the words, so `e\cho()` counts. It is a coarse sign: it can be true when nothing is defined. The other
 * sign, a command word like `function` or `alias`, is looked for in `readInWords`.
 *
 * Three Bash forms are read only with `dollarForms` (S-70, B-32 items 2, 3 and 20); without it the text is read as main read it, so a
 * caller that reads both loses nothing main read. (1) `$'…'` is an ANSI-C string: it runs to the first `'` that no `\` escapes, `\'`
 * and `\\` give `'` and `\`, any other escape stays as written (nothing is decoded, so `\x73` stays four characters), and the `$` is
 * left out. (2) The end of a `$( )` is found with its quotes, `$'…'` strings, double quotes (with a nested `$( )` in them), backslash
 * pairs and comments skipped. (3) A `$` that line continuations (backslash and newline) join to a `(` or a `'` is a `$(` or a `$'`.
 * `dollar` is true when the text holds one of the three in a place where this reading and main's can differ: while it is false,
 * both readings are the same, word for word, so a caller reads the text a second time only when it is true.
 *
 * @param {string} text
 * @param {boolean} [powershell]
 * @param {boolean} [comments] skip comments
 * @param {Limit} [limit] the work budget: the text's length is taken off `left`, and reading stops (throws `OUT_OF_WORK`) when it goes below 0
 * @param {boolean} [dollarForms] read the three Bash forms above (Bash only: read as PowerShell, nothing changes)
 * @returns {{ commands: string[][], nested: string[], open: boolean, defines: boolean, dollar: boolean }}
 */
export function splitShell(text, powershell = false, comments = true, limit, dollarForms = false) {
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
  let dollar = false
  dollarForms &&= !powershell
  /** where `dollarJoin` found a `(` or `'` */
  let look = -1
  /** the last word of the command so far, for the `(` that may follow it */
  let lastWord = ''
  /** @type {string[] | null} the command's words with the PowerShell splits made, once the command has a word that splits (S-69) */
  let split = null
  let firstSplit = 0
  const endWord = () => {
    if (inWord) {
      // PowerShell splits two kinds of word that Bash keeps whole (S-69, B-32 items 6 and 16), quoted or not. `-Name:value` is the parameter
      // `-Name` and its value (about_Parameters). `$x=Cmdlet` is a variable, an assignment operator and the cmdlet (about_Assignment_Operators:
      // `=` `+=` `-=` `*=` `/=` `%=` `??=`); the operator is pushed as a plain `=`, which is where `commandStart` looks for it. The split words
      // are a second copy of the command, read as well as the first, so nothing main read is read any less (shared rule 7, tighten only).
      const pieces = powershell ? pieceWords(word) : null
      if (pieces && !split) {
        split = words.slice()
        firstSplit = split.length
      }
      words.push(word)
      // Pushed one at a time: spreading a word of 100,000 or more pieces into `push` throws, and a guard that throws lets the command run.
      if (split) for (const piece of pieces ?? [word]) split.push(piece)
      lastWord = word
    }
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) {
      commands.push(words)
      if (split) {
        commands.push(split)
        FIRST_SPLIT.set(split, firstSplit)
      }
    }
    words = []
    split = null
    lastWord = ''
  }
  /** @param {number} start index just after `$(` @returns {number} index after the matching `)` */
  const subshell = (start) => {
    let depth = 1
    let j = start
    // Main's scan counts parentheses and skips the character after a backslash. It notes a quote or a `#`: only with one in the span can the
    // Bash scan below (S-70, B-32 item 3) end it anywhere else, so a span without one costs no second scan.
    let quoted = false
    while (j < text.length && depth > 0) {
      const ch = text[j]
      if (ch === escape) j++
      else if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === "'" || ch === '"' || ch === '#') quoted = true
      j++
    }
    if (!powershell && quoted) {
      const bash = bashSubshellEnd(text, start)
      if (bash.end !== Math.min(j, text.length) || bash.closed !== (depth === 0)) {
        if (dollarForms) {
          j = bash.end
          depth = bash.closed ? 0 : 1
        } else dollar = true
      }
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
        } else if (text[i] === '$' && !powershell && (look = dollarJoin(text, i)) !== -1 && text[look] === '(') {
          // Line continuations between the `$` and the `(` are taken out before the shell reads the substitution (B-32 item 20).
          if (dollarForms) i = subshell(look + 1)
          else {
            dollar = true
            word += '$'
            i++
          }
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
    } else if (c === '$' && !powershell && (look = dollarJoin(text, i)) !== -1) {
      if (!dollarForms) {
        // Main's reading: a plain character. The text holds a form that only the other reading takes, which the caller is told.
        dollar = true
        word += '$'
        inWord = true
        i++
      } else if (text[look] === '(') i = subshell(look + 1)
      else {
        // `$'…'`: an ANSI-C string (bash and zsh). `\'` and `\\` give `'` and `\`; any other escape stays as written.
        inWord = true
        i = look + 1
        while (i < text.length && text[i] !== "'") {
          if (text[i] === '\\' && i + 1 < text.length) {
            word += text[i + 1] === "'" || text[i + 1] === '\\' ? text[i + 1] : text[i] + text[i + 1]
            i += 2
          } else {
            word += text[i]
            i++
          }
        }
        if (i >= text.length) open = true
        i++
      }
    } else if (c === '`') {
      i = backtick(i + 1)
    } else if (separators.includes(c)) {
      if (c === '(' && !powershell && !defines && followsWord(inWord ? word : lastWord) && closesAtOnce(text, i)) defines = true
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
  return { commands, nested, open, defines, dollar }
}

/**
 * Bash: where the `$` at `at` ends up when line continuations (backslash and newline) between it and the next character are taken out: the
 * index of that character if it is a `'` (the start of `$'…'`) or, only when a continuation was taken out, a `(` (a `$(` joined by one;
 * a `$(` with nothing between is found by the caller). -1 when it is neither (S-70, B-32 items 2 and 20). Each continuation is looked at
 * by the one `$` before it, so this is linear in the text.
 *
 * @param {string} text
 * @param {number} at
 */
function dollarJoin(text, at) {
  let k = at + 1
  while (text[k] === '\\' && text[k + 1] === '\n') k += 2
  return text[k] === "'" || (k > at + 1 && text[k] === '(') ? k : -1
}

/**
 * Bash: where a `$( )` that starts at `start` (just after the `$(`) ends, with the shell's own quoting taken into account (S-70, B-32
 * item 3). Parentheses count only in code: not in single quotes, `$'…'` strings (where `\'` does not end the string), double quotes
 * (where a `$(` opens code again, and a backslash escapes the next character) or a comment (a `#` at the start of the span, or after a
 * blank, `;`, `&`, `|`, `(` or a newline, to the end of the line). A backslash escapes the next character in code. One pass; each
 * character is looked at once, apart from the line a comment skips (found with `indexOf`).
 *
 * @param {string} text
 * @param {number} start
 * @returns {{ end: number, closed: boolean }} the index after the `)` that ends it, or the text's length when it does not end
 */
function bashSubshellEnd(text, start) {
  const n = text.length
  // What is open, innermost last: 0 is code (the span itself, a `(` or a nested `$(`), 1 is a double quote.
  const open = [0]
  let j = start
  while (j < n && open.length > 0) {
    const ch = text[j]
    if (open[open.length - 1] === 1) {
      if (ch === '\\') j += 2
      else if (ch === '"') {
        open.pop()
        j++
      } else if (ch === '$' && text[j + 1] === '(') {
        open.push(0)
        j += 2
      } else if (ch === '$' && dollarJoin(text, j) !== -1 && text[dollarJoin(text, j)] === '(') {
        open.push(0)
        j = dollarJoin(text, j) + 1
      } else j++
    } else if (ch === '\\') j += 2
    else if (ch === "'") {
      const close = text.indexOf("'", j + 1)
      j = close === -1 ? n : close + 1
    } else if (ch === '"') {
      open.push(1)
      j++
    } else if (ch === '$' && dollarJoin(text, j) !== -1 && text[dollarJoin(text, j)] === "'") {
      j = dollarJoin(text, j) + 1
      while (j < n && text[j] !== "'") j += text[j] === '\\' ? 2 : 1
      j++
    } else if (ch === '#' && (j === start || ' \t\n;&|('.includes(text[j - 1]))) {
      const newline = text.indexOf('\n', j)
      j = newline === -1 ? n : newline
    } else if (ch === '(') {
      open.push(0)
      j++
    } else if (ch === ')') {
      open.pop()
      j++
    } else j++
  }
  return { end: Math.min(j, n), closed: open.length === 0 }
}

/**
 * The words PowerShell sees where Bash sees one (S-69, B-32 items 6 and 16): `-Name:value` is `-Name` and `value`; `$x=Cmdlet` (or any assignment
 * operator) is `$x`, `=` and `Cmdlet`, and `$a=$b=Cmdlet` is each name and `=` in turn. The first colon and each `=` are found with `indexOf` from
 * where the last stopped, so this is linear in the word.
 *
 * @param {string} word
 * @returns {string[] | null} the pieces, or null when the word does not split
 */
function pieceWords(word) {
  if (word[0] === '-') {
    const colon = word.indexOf(':')
    if (colon <= 0) return null
    return colon + 1 < word.length ? [word.slice(0, colon), word.slice(colon + 1)] : [word.slice(0, colon)]
  }
  if (word[0] !== '$') return null
  const pieces = []
  let from = 0
  // Each name is the text from `from` up to the operator, and the operator is a plain `=` (`commandStart` looks for that one).
  for (let equals; word[from] === '$' && (equals = word.indexOf('=', from)) > from; from = equals + 1) {
    const name = word.slice(from, equals)
    pieces.push(name.endsWith('??') ? name.slice(0, -2) : '-+*/%'.includes(name[name.length - 1]) ? name.slice(0, -1) : name, '=')
  }
  if (pieces.length === 0) return null
  if (from < word.length) pieces.push(word.slice(from))
  return pieces
}

/**
 * Whether the word right before a `(` can be a function's name, as in `echo() {` or `f ( ) {` (S-68). The parser has already taken
 * quotes, escapes and line continuations out of the word, so `e''cho` and `echo\` + newline count. `a=()` and `<()` are not definitions.
 *
 * @param {string} word the last word before the `(`, or '' when a separator comes first
 */
function followsWord(word) {
  return word !== '' && !'=<>'.includes(word[word.length - 1])
}

/**
 * Whether the `(` at `at` is followed by only blanks and then `)`. Each blank run is read at most once, by the `(` before it, so this is linear.
 *
 * @param {string} text
 * @param {number} at index of the `(`
 */
function closesAtOnce(text, at) {
  let after = at + 1
  while (after < text.length && (text[after] === ' ' || text[after] === '\t' || (text[after] === '\\' && text[after + 1] === '\n'))) after += text[after] === '\\' ? 2 : 1
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
    // `-` is a modifier only where a command word is expected; after a wrapper it is that wrapper's option, as main read it (`sudo - -u x …`).
    if (WRAPPERS.has(base(w)) || (zsh && ZSH_MODIFIERS.has(base(w)) && (w !== '-' || wrapper === ''))) wrapper = base(w)
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
 * `--` ends the options. An option with `o` or `O` in it (`-o`, `+o`, `-O`, `-co`) takes the next word as its value. The value of `-o`
 * is an option name, never a script (both shells say "no such option" for one that is not), but zsh runs the value of `-O` as the script
 * (`zsh -c -O extglob 'echo'` runs `extglob`), so that value is read too. When the name is glued to the option (`-oerrexit`), zsh and ksh
 * run the next word as the script and bash takes it as the name, so that word is read as well. The word right after the flag is always read, as main read it.
 * An index can be listed twice; the caller reads each once.
 *
 * What a walk finds from a word on depends only on that word and on what the last option took (nothing, an option name, a script).
 * `seen` (three marks per word, shared by every walk over the same words) stops a walk where an earlier one went, so many flags over one
 * long run of option words cost no more than the run (a chain of `sh -c +/sh -c …` took the walk quadratic time before).
 *
 * @param {string[]} words
 * @param {number} flag index of the `-c` word
 * @param {Uint8Array} seen
 * @returns {number[]} indexes of the words to read as scripts
 */
function shellScripts(words, flag, seen) {
  const out = [flag + 1]
  const kind = (/** @type {string} */ w) => (/^[-+][A-Za-z]*O/.test(w) ? 2 : /^[-+][A-Za-z]*o/.test(w) ? 1 : 0)
  let value = kind(words[flag])
  for (let k = flag + 1; k < words.length; k++) {
    const mark = 3 * k + value
    if (seen[mark]) break
    seen[mark] = 1
    const w = words[k]
    if (value) {
      if (value === 2) out.push(k)
      value = 0
    } else if (w === '--') {
      if (k + 1 < words.length) out.push(k + 1)
      break
    } else if (w.startsWith('-') || w.startsWith('+')) {
      value = kind(w)
      // `-oerrexit`: zsh and ksh take the option name from the word itself and run the next word as the script; bash takes the next word as
      // the name. The walk goes on as bash reads it, and the next word is a candidate too.
      if (value === 1 && /[oO][A-Za-z]/.test(w) && k + 1 < words.length) out.push(k + 1)
    } else {
      out.push(k)
      break
    }
  }
  return out
}

/**
 * Whether a command, whose real command word is at `at`, defines a function or alias or changes what a name runs (S-68, B-32 item 1): its
 * word is one of `DEFINERS` with a word that is not an option after it (a bare `alias` or `hash -r` only lists or clears), or it assigns to
 * zsh's `functions` or `aliases` or bash's `BASH_ALIASES` or `BASH_CMDS` (`functions[echo]=…`, `functions+=(…)`), which may stand before
 * the command word as an assignment.
 *
 * @param {string[]} words
 * @param {number} at
 */
function definesSomething(words, at) {
  for (let k = 0; k <= at && k < words.length; k++) if (/^(functions|aliases|bash_aliases|bash_cmds)(\[|\+?=)/i.test(words[k])) return true
  if (at >= words.length || !DEFINERS.has(base(words[at]))) return false
  for (let k = at + 1; k < words.length; k++) if (!words[k].startsWith('-')) return true
  return false
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
 * @param {Limit} limit the work budget, and the marks of S-68 (`checkCommand` always passes it)
 * @returns {string | null} the reason, when the command is a direct read
 */
function readInWords(words, names, depth, comments, limit) {
  let start = commandStart(words)
  // zsh's modifiers and `repeat COUNT` move this start only; it is used to find `eval` and nothing else (S-68, B-32 item 12). Main's start stays the
  // start for everything else, so a text-only command behind a modifier is refused as before, and a reading never depends on it.
  let evalStart = commandStart(words, 0, true)
  if (definesSomething(words, start) || definesSomething(words, evalStart)) limit.defines = true
  if (start >= words.length) return null
  // An option skipped before the first word may have taken it as its value (`env -u echo …`), so only a start past no option counts as text.
  const text = TEXT_ONLY.has(base(words[start])) && !words.slice(0, start).some((w) => w.startsWith('-'))
  // In a split copy (S-69), a script after a word that is not a split is read from the original command, so it is not read again here.
  const firstSplit = FIRST_SPLIT.get(words) ?? -1
  // A command that defines a function or alias may have redefined the text-only name (S-68, B-32 item 1). The first reading uses the exemption and
  // notes that it did; `checkCommand` reads again without it when the command also defines something, and then such a word is read like `eval`.
  if (text && !limit.strict) {
    limit.exempted = true
    return null
  }
  let end = words.length
  if (!comments) {
    // Followed in one pass, so `keyprompt -- keyprompt -- …` stays linear.
    for (let dash; LAUNCHERS.has(base(words[start])) && (dash = words.indexOf('--', start + 1)) !== -1; ) {
      start = commandStart(words, dash + 1)
      evalStart = commandStart(words, dash + 1, true)
      if (start >= words.length) return null
    }
    end = Math.min(words.length, Math.max(start, evalStart) + 1)
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
  /** @type {Uint8Array | undefined} the places the walks over option words have been, for `shellScripts` */
  let seen
  for (let i = from; i < end; i++) {
    const command = base(words[i])
    /** @type {string | null} */
    let found = null
    if ((command === 'eval' && (i === start || i === evalStart)) || (limit.strict && TEXT_ONLY.has(command) && i === start)) {
      // eval, as the command, runs every word after it as one script, which settles the rest of the command.
      // A word that only ends in `eval` (`X=/bin/eval`, `find -name eval`, an option's value) runs nothing, and joining the words after it would drop their quoting.
      found = readScript(words.slice(i + 1).join(' '), names, depth + 1, false, comments, limit)
      // Only main's own case ends the reading here. Behind one of zsh's modifiers (S-68), and for a text-only word read like `eval`, main read the
      // words one by one, and joining them can change how they read (a quote that was inside a word is open again), so the script is read as well
      // and the words are still looked at.
      if (found || (command === 'eval' && i === start)) return found
    } else if (command === 'security' || command === 'secret-tool') {
      // `security` also gets the subcommand found past the value of each `-p` (S-68, B-32 item 10); the first word that is not an option stays a
      // candidate too, so nothing main refuses is let through. Whether `security -p x find-generic-password …` runs the subcommand was not checked (F14).
      if (command === 'security') securitySub ??= securitySubs(words)
      for (const sub of command === 'security' ? [plain[i + 1], securitySub[i + 1]] : [plain[i + 1]]) {
        // The candidate found past a `-p` has its own key: it reads from a different word than main's candidate, which must not be skipped
        // because this one was read first. It is not read again where it is main's candidate (the same word).
        const key = sub === plain[i + 1] ? `${command} ${words[sub]}` : `${command} -p ${words[sub]}`
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
      flags[kind] ??= nextMatch(words, (w) => (powershell ? /^-c(ommand)?$/i.test(w) : /^-[a-z]{0,3}c[a-z]{0,3}$/.test(w)))
      const flag = flags[kind][i + 1]
      /** @type {[string, () => string, boolean?, boolean?][]} each script to read, under the key that marks it read, whether to refuse one that ends open, and whether it is one of the scripts S-68 adds (charged `WORK_PER_EXTRA_SCRIPT`); built only when read, so a skipped one costs nothing */
      const scripts = []
      if (!powershell) {
        // Main's flag (lowercase letters only) and the first flag with capital letters too (`-Ec`, `-cO`; S-68, B-32 item 4), which may come
        // before it: `bash -Ec 'eval "$1"' -c '<read>'` runs the first script, and main read the second. Each flag's script words are the
        // first word that is not an option and what item 4 adds, listed once per flag.
        flags.shellCapitals ??= nextMatch(words, (w) => /^-[A-Za-z]{0,3}c[A-Za-z]{0,3}$/.test(w))
        for (const at of [flag, flags.shellCapitals[i + 1]]) {
          if (at + 1 >= words.length || checked.has(`shell words ${at}`)) continue
          checked.add(`shell words ${at}`)
          for (const k of shellScripts(words, at, (seen ??= new Uint8Array(3 * words.length + 3)))) scripts.push([`shell ${k}`, () => words[k], false, k !== at + 1])
        }
      } else if (flag + 1 >= words.length) {
        // No script follows.
      } else if (i === start) {
        // As the command, pwsh takes every word after the flag as its script, so that check settles the rest.
        if (flag >= firstSplit) scripts.push([`powershell ${flag}`, () => words.slice(flag + 1).join(' ')])
        end = Math.min(end, flag + 1)
      } else if (flag >= firstSplit) {
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
      for (const [key, script, refuseOpen, extra] of scripts) {
        if (found || checked.has(key)) continue
        checked.add(key)
        if (extra && (limit.left -= WORK_PER_EXTRA_SCRIPT) < 0) throw OUT_OF_WORK
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
 * @param {Limit} limit the work budget, and the marks of S-68 (`checkCommand` always passes it)
 * @param {boolean} [refuseOpen] refuse a text that ends inside a quote, a block comment or `$(` and names a read tool, when nothing else was found
 * @returns {string | null}
 */
function readInShell(text, names, depth, powershell, comments, limit, refuseOpen) {
  // Past the depth limit the text is not read. A text that names a read tool is refused (S-67, B-32 item 5), so too much nesting never reads as "no read".
  if (depth > 4) {
    // Not read, so it may define something too (S-68): a text-only command that was let through is read again without the exemption.
    limit.defines = true
    return mentionsRead(text) ? UNREAD : null
  }
  // A split copy (S-69) can reach a text that was already read the same way and held no read. Reading it again finds nothing new, and it made
  // the copy's work double at each nesting level (senior review, B2). Only a reading inside a copy skips: every reading main makes is still
  // made, so this never does less work than main, and a text main refused as too long to read is still refused. A skip is not charged: its
  // text was just built from part of a text already charged (words joined, a `$( )` slice, the word after `bash -c`), and main builds each
  // script it reads uncharged too, so the work stays in step. Only readings inside a copy are remembered, so a text with no split word keeps
  // nothing (remembering every reading tripled the memory of an 8 MB Bash text; round-2 review).
  const how = depth * 16 + (powershell ? 8 : 0) + (comments ? 4 : 0) + (refuseOpen ? 2 : 0) + (limit.strict ? 1 : 0)
  if (limit.copies && limit.read?.[how]?.has(text)) return null
  let { commands, nested, open, defines, dollar } = splitShell(text, powershell, comments, limit)
  if (dollar) {
    // The text holds a Bash form that main read as plain characters (S-70, B-32 items 2, 3 and 20). It is read a second time with the forms
    // read, and whatever that finds that the first reading did not is read as well: the first reading is main's, so nothing main refused
    // is let through (tighten only, by construction). Without such a form (the mark is false) there is no second reading and no cost.
    const more = splitShell(text, powershell, comments, limit, true)
    const known = new Set(commands.map((words) => JSON.stringify(words)))
    commands = commands.concat(more.commands.filter((words) => !known.has(JSON.stringify(words))))
    const scripts = new Set(nested)
    nested = nested.concat(more.nested.filter((script) => !scripts.has(script)))
    open ||= more.open
    defines ||= more.defines
  }
  if (defines) limit.defines = true
  for (const words of commands) {
    const copy = FIRST_SPLIT.has(words)
    if (copy) limit.copies = (limit.copies ?? 0) + 1
    const found = readInWords(words, names, depth, comments, limit)
    // A found read, like a throw, ends the whole check, so the count needs putting back only here.
    if (found) return found
    if (copy) limit.copies--
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
  if (limit.copies) ((limit.read ??= [])[how] ??= new Set()).add(text)
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
