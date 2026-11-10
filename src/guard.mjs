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
 * here-document body fed to one of these is text too (B-26, S-58; see
 * splitShell).
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
 * Words after which the guard no longer trusts that a here-document body, or
 * `$(cat <<'EOF' …)`, is only text, for the rest of the text (S-58). Each can
 * send later output to a shell or change what a name runs: a group, an `if`
 * or a loop's `do` can be piped on after it closes (`{ … } | bash`), `exec`
 * and `coproc` rewire output, and `eval`, `source`, `alias`, `hash`,
 * `enable`, `trap` and `autoload` define or redirect commands. A function
 * definition, a `case` pattern and a subshell bring a `(`, `)` or `{`, which
 * count too, and every closing word follows one of these. The flag never goes
 * back down, so no later word can make a group look closed (S-58's
 * `/code-review`).
 */
const UNTRUSTED = new Set(['{', 'if', 'do', 'exec', 'coproc', 'eval', 'source', 'alias', 'hash', 'enable', 'trap', 'autoload'])
/** zsh's tables of functions, aliases and command paths: `functions[cat]=…`, `commands[cat]=/bin/sh`. */
const ZSH_TABLES = /^(?:functions|aliases|galiases|saliases|builtins|commands)\[/

/**
 * A here-document operator (`<<WORD` or `<<-WORD`) at `at`: its delimiter
 * after quote removal, whether any part of WORD is quoted (then bash expands
 * nothing in the body), and whether `<<-` strips leading tabs. Null for a
 * WORD the guard does not read with confidence (one that crosses a line or
 * holds `$`, a backtick or a backslash inside quotes): the `<<` then stays
 * plain text, as it was before S-58.
 *
 * @param {string} text
 * @param {number} at index of the first `<`
 * @returns {{ delim: string, quoted: boolean, strip: boolean, next: number } | null}
 */
function heredocAt(text, at) {
  let k = at + 2
  const strip = text[k] === '-'
  if (strip) k++
  while (text[k] === ' ' || text[k] === '\t') k++
  let delim = ''
  let quoted = false
  // Bash's metacharacters end WORD; a carriage return does not, so `EOF\r` needs a line `EOF\r`, as in bash.
  while (k < text.length && !' \t\n;&|()<>'.includes(text[k])) {
    const c = text[k]
    if (c === "'" || c === '"') {
      const close = text.indexOf(c, k + 1)
      if (close === -1 || /[\n\\$`]/.test(text.slice(k + 1, close))) return null
      delim += text.slice(k + 1, close)
      quoted = true
      k = close + 1
    } else if (c === '\\') {
      if (k + 1 >= text.length || text[k + 1] === '\n') return null
      delim += text[k + 1]
      quoted = true
      k += 2
    } else if (c === '$' || c === '`') {
      return null
    } else {
      delim += c
      k++
    }
  }
  return delim ? { delim, quoted, strip, next: k } : null
}

/**
 * Where a here-document's body ends: at the first line equal to its
 * delimiter (after leading tabs, for `<<-`). In an unquoted body a
 * backslash-newline first joins two lines, as bash and zsh do (`EO\` then `F`
 * ends the body), so the guard never reads as text a line the shell runs.
 *
 * @param {string} text
 * @param {number} from index where the body starts
 * @param {{ delim: string, quoted: boolean, strip: boolean }} doc
 * @param {number} [limit] where the text it may run to ends (the end of a `$( )` inside a body)
 * @returns {{ end: number, next: number }} where the body's text ends, and the index after the delimiter line (both `limit` when there is none)
 */
function bodyEnd(text, from, doc, limit = text.length) {
  let start = from
  let line = ''
  let pos = from
  while (pos < limit) {
    const nl = text.indexOf('\n', pos)
    const stop = nl === -1 || nl > limit ? limit : nl
    let piece = text.slice(pos, stop)
    if (doc.strip) piece = piece.replace(/^\t+/, '')
    pos = stop + 1
    if (!doc.quoted && nl !== -1 && (piece.length - piece.replace(/\\+$/, '').length) % 2 === 1) {
      line += piece.slice(0, -1)
      continue
    }
    if (line + piece === doc.delim) return { end: start, next: Math.min(pos, limit) }
    line = ''
    start = pos
  }
  return { end: limit, next: limit }
}

/**
 * Whether a `$( )` script is only `cat` fed one here-document that runs
 * nothing: a quoted delimiter, or an unquoted one whose body holds no `$`,
 * backtick or backslash. Its output is then that text and nothing else.
 *
 * @param {string} script
 */
function catText(script) {
  const head = /^[ \t\n]*cat[ \t]+(?=<<)/.exec(script)
  const doc = head && heredocAt(script, head.index + head[0].length)
  const line = doc && /^[ \t]*\n/.exec(script.slice(doc.next))
  if (!doc || !line) return false
  const from = doc.next + line[0].length
  const { end, next } = bodyEnd(script, from, doc)
  if (end === script.length || !/^[ \t\n]*$/.test(script.slice(next))) return false
  return doc.quoted || !/[$`\\]/.test(script.slice(from, end))
}

/** `git` and `gh` subcommands that take a message or a body as text and run none of their arguments. */
const MESSAGE_TAKERS = { git: ['commit', 'tag', 'notes'], gh: ['pr', 'issue', 'release'] }

/**
 * Whether a command takes the output of a `$( )` in its words as text only:
 * a text-only command, or `git commit`, `git tag`, `git notes`, `gh pr`,
 * `gh issue` or `gh release`, with the subcommand right after the program.
 * Commands that run a string they are given (`eval`, `bash -c`, `env -S`,
 * `watch`, `ssh`, `xargs`) are not, nor is a command not yet named.
 *
 * @param {string[]} words the command's words so far
 */
function takesText(words) {
  if (textOnly(words)) return true
  const start = commandStart(words)
  const subcommands = start < words.length ? MESSAGE_TAKERS[base(words[start])] : undefined
  return Boolean(subcommands?.includes(words[start + 1]) && !optionBefore(words, start))
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
 * Bash here-documents (S-58, B-26). A `<<WORD` or `<<-WORD` that starts a
 * word, with no `${` before it in the text (bash starts none inside `${…}`),
 * has a body: the lines after the end of its line, up to the delimiter line.
 * The body is text, skipped, only when every here-document on the line feeds
 * a command that only prints or stores text (`cat`, `tee`: TEXT_ONLY), no
 * command on the line pipes its output on (`| bash`), no `(`, `)` or word in
 * UNTRUSTED came before it anywhere in the text (a group, a loop, `exec`,
 * `eval`, a function or an alias), and the text is not `strict`. An unquoted text body still runs `$( )` and
 * backticks, which are checked. Otherwise the body is read as commands, as
 * before S-58, and so is every here-document after it in the text. `$( )`
 * and backtick scripts are read `strict`, because their output can be run;
 * one exception: `$(cat <<'EOF' … EOF)` that runs nothing (catText), in a
 * command that takes it as text only (takesText: a commit message, a pull
 * request body), on the same terms as a body, is not read at all.
 *
 * @param {string} text
 * @param {boolean} [powershell]
 * @param {boolean} [comments] skip comments
 * @param {boolean} [strict] the text's output may be run, so no here-document body is text
 * @returns {{ commands: string[][], nested: string[], runs: boolean[] }}
 */
export function splitShell(text, powershell = false, comments = true, strict = false) {
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
  /** @type {{ delim: string, quoted: boolean, strip: boolean, words: string[] }[]} here-documents whose body starts after this line */
  let pending = []
  /** @type {string[]} `$( )` scripts on this line not read, as text (see takesText) */
  let texts = []
  let piped = false
  let rest = strict
  /** @type {boolean[]} for each command, whether its output may be run: its own scripts are then read strict */
  const runs = []
  let lineStart = 0
  const braced = powershell ? 0 : text.indexOf('${')
  const endWord = () => {
    if (inWord) {
      // `.` only as a command (`git add .` is common); the rest anywhere, quoted or not, which only errs towards refusing.
      if (!powershell && (UNTRUSTED.has(word) || ZSH_TABLES.test(word) || (word === '.' && words.length === 0))) rest = true
      words.push(word)
    }
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) {
      commands.push(words)
      runs.push(rest)
    }
    words = []
  }
  /**
   * @param {number} start index just after `$(`
   * @param {number} [limit] where the text it can run to ends (a here-document body's end)
   * @returns {number} index after the matching `)`
   */
  const subshell = (start, limit = text.length) => {
    let depth = 1
    let j = start
    /** @type {{ delim: string, quoted: boolean, strip: boolean }[]} */
    let docs = []
    while (j < limit && depth > 0) {
      if (text[j] === escape) j++
      else if (text[j] === '(') depth++
      else if (text[j] === ')') depth--
      else if (!powershell && text[j] === '<' && text[j + 1] === '<') {
        // A here-document's body can hold any `)` (`item 1)` in a commit message), so it is passed over to its delimiter line.
        const doc = heredocAt(text, j)
        if (doc) docs.push(doc)
        j = doc ? doc.next - 1 : j + 1
      } else if (text[j] === '\n' && docs.length > 0) {
        let next = j + 1
        for (const doc of docs) next = bodyEnd(text, next, doc, limit).next
        docs = []
        j = next - 1
      }
      j++
    }
    nested.push(text.slice(start, depth === 0 ? j - 1 : j))
    return j
  }
  /**
   * `$( )`: its script is nested, unless it is only text for a command that takes it as text (catText, takesText), on
   * the same terms as a here-document body: not in a strict text, a group or a loop. @param {number} start index just
   * after `$(` @returns {number}
   */
  const substitute = (start) => {
    const at = nested.length
    const end = subshell(start)
    // A command with more than 64 words before it is read as before S-58: checking its start for every `$( )` would not be linear.
    if (!powershell && !rest && words.length <= 64 && takesText(words) && catText(nested[at])) texts.push(...nested.splice(at))
    return end
  }
  /**
   * An unquoted text body: its `$( )` and backticks run, so they are nested. Bash expands the body only once it has
   * read it, so neither runs past the body's end; stopping there also keeps many unclosed ones linear.
   * @param {number} from @param {number} to
   */
  const expansions = (from, to) => {
    for (let j = from; j < to; ) {
      if (text[j] === '\\') j += 2
      else if (text[j] === '$' && text[j + 1] === '(') j = subshell(j + 2, to)
      else if (text[j] === '`') j = backtick(j + 1, to)
      else j++
    }
  }
  /**
   * The end of a line: decide its here-documents (see above) and, when the line pipes its output on, read the `$( )`
   * scripts it took as text after all. @param {number} at index after the newline @returns {number} where reading goes on
   */
  const endLine = (at) => {
    if (piped) {
      nested.push(...texts)
      runs.fill(true, lineStart)
    }
    texts = []
    let next = at
    if (pending.length > 0) {
      // Each command is checked once, however many here-documents it has.
      if (!rest && !piped && [...new Set(pending.map((doc) => doc.words))].every(textOnly)) {
        for (const doc of pending) {
          const body = bodyEnd(text, next, doc)
          if (!doc.quoted) expansions(next, body.end)
          next = body.next
        }
      } else {
        rest = true
      }
      pending = []
    }
    piped = false
    lineStart = commands.length
    return next
  }
  /** @param {number} start index just after the opening backtick @param {number} [limit] @returns {number} */
  const backtick = (start, limit = text.length) => {
    const end = text.indexOf('`', start)
    const stop = end === -1 || end > limit ? limit : end
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
      i = end === -1 ? text.length : end + 2
    } else if (c === "'") {
      inWord = true
      i++
      while (i < text.length && (text[i] !== "'" || (powershell && text[i + 1] === "'"))) {
        word += text[i]
        i += text[i] === "'" ? 2 : 1
      }
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
          i = substitute(i + 2)
        } else if (text[i] === '`') {
          i = backtick(i + 1)
        } else {
          word += text[i]
          i++
        }
      }
      i++
    } else if (c === '$' && text[i + 1] === '(') {
      i = substitute(i + 2)
    } else if (c === '`') {
      i = backtick(i + 1)
    } else if (!powershell && c === '<' && text[i + 1] === '<' && !inWord && (braced === -1 || braced > i)) {
      // Only where a word starts: bash starts no here-document inside `a[x<<EOF]=1`. A `<<<` here-string has no WORD, so heredocAt gives null.
      const doc = heredocAt(text, i)
      if (doc) {
        pending.push({ ...doc, words })
        i = doc.next
      } else {
        word += '<<'
        inWord = true
        i += 2
      }
    } else if (separators.includes(c)) {
      if (c === '(' || (c === '|' && text[i + 1] !== '|' && text[i - 1] !== '|')) piped = true
      // A subshell, a process substitution, a function's `()` or a `case` pattern's `)`: see UNTRUSTED.
      if (!powershell && (c === '(' || c === ')')) rest = true
      endCommand()
      i++
      if (c === '\n') i = endLine(i)
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
  endLine(text.length)
  return { commands, nested, runs }
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

/**
 * Whether a command only prints, searches or stores text (S-57): its first
 * word past wrappers is in TEXT_ONLY, and no option skipped before that word
 * could have taken it as its value (`env -u echo …`).
 *
 * @param {string[]} words
 */
function textOnly(words) {
  const start = commandStart(words)
  return start < words.length && TEXT_ONLY.has(base(words[start])) && !optionBefore(words, start)
}

/**
 * Whether an option comes before the command's first word, where it may have
 * taken that word as its value (`env -u echo …`).
 *
 * @param {string[]} words
 * @param {number} start
 */
function optionBefore(words, start) {
  return words.slice(0, start).some((w) => w.startsWith('-'))
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
 * @param {boolean} strict the command's output may be run (see splitShell)
 * @returns {string | null} the reason, when the command is a direct read
 */
function readInWords(words, names, depth, comments, strict) {
  let start = commandStart(words)
  if (start >= words.length || textOnly(words)) return null
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
      return readScript(words.slice(i + 1).join(' '), names, depth + 1, false, comments, strict)
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
      /** @type {[string, () => string][]} each script to read, under the key that marks it read; built only when read, so a skipped one costs nothing */
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
        pwshWords ??= nextMatch(words, (w) => SHELLS.has(base(w)) && /^(pwsh|powershell)/.test(base(w)))
        const stop = pwshWords[flag + 1]
        scripts.push([`powershell ${flag}`, () => words.slice(flag + 1, stop).join(' ')])
        if (stop === words.length) checked.add('powershell tail')
        else scripts.push(['powershell tail', () => words.slice(flag + 1).join(' ')])
      }
      for (const [key, script] of scripts) {
        if (found || checked.has(key)) continue
        checked.add(key)
        found = readScript(script(), names, depth + 1, powershell, comments, strict)
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
 * @param {boolean} strict the text's output may be run; `$( )` and backtick scripts always are read so (S-58)
 * @returns {string | null}
 */
function readInShell(text, names, depth, powershell, comments, strict) {
  if (depth > 4) return null
  const { commands, nested, runs } = splitShell(text, powershell, comments, strict)
  for (const [k, words] of commands.entries()) {
    const found = readInWords(words, names, depth, comments, runs[k])
    if (found) return found
  }
  // Windows: CredRead through Add-Type (how keyprompt itself reads, `src/store/windows.mjs`), naming a keyprompt target or a saved name.
  const runsAddType = commands.some((words) => base(words[commandStart(words)] ?? '') === 'add-type')
  if (runsAddType && /credread/i.test(text)) {
    const lower = text.toLowerCase()
    if (lower.includes(`${SERVICE}:`) || [...names].some((name) => wordIn(text, name))) return READS
  }
  for (const script of nested) {
    const found = readScript(script, names, depth + 1, powershell, comments, true)
    if (found) return found
  }
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
 * @param {boolean} strict
 * @returns {string | null}
 */
function readBoth(text, names, depth, powershell, strict) {
  return readInShell(text, names, depth, powershell, true, strict) || readInShell(text, names, depth, powershell, false, strict)
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
 * @param {boolean} strict
 * @returns {string | null}
 */
function readScript(text, names, depth, powershell, comments, strict) {
  return comments ? readInShell(text, names, depth, powershell, true, strict) : readBoth(text, names, depth, powershell, strict)
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
 * @returns {{ reason: string } | null}
 */
export function checkCommand(command, savedNames = [], shell) {
  const names = new Set(savedNames)
  const found = (shell !== 'powershell' && readBoth(command, names, 0, false, false)) || (shell !== 'bash' && readBoth(command, names, 0, true, false))
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
