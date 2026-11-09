# v0.3 feature-end audit (S-56)

Every acceptance line in `docs/prd/v0-3.md`, judged against main at 2e50630 (the 0.3.0 release), as of 2026-11-09. The register's ticks are not evidence here (mystandard section 22).

## How it was done

- Four fresh, read-only Opus reviewers, one per area: the guard (G1 to G4), `--json` and `setup` (J, F), the activity log (L), `keyprompt mcp` (M). None had built the code. Each was told not to read `docs/steps.md`, `docs/bugs.md` or `CHANGELOG.md`, to split its lines into clauses, to judge each from the code, the tests and the shipped docs, and to try inputs that should break it. Probes ran with a throwaway HOME and `KEYPROMPT_HOME`, a browser path that does not exist, and (for card flows) the test suite's in-memory store. Nothing touched the real password store, a real browser, `~/.keyprompt` or `~/.claude/settings.json`.
- The session that ran the release (and built most of v0.3) did not judge alone. It re-ran or re-read every unmet clause below before writing it down, and spot-checked met ones: the deny and warning code, the JSON writer, `helperError`, every stdout write in `src/`, and the dependency list.
- **The rule for a verdict.** A line is **unmet** when the person or the agent can reach, through keyprompt's own interface (arguments, the files it is asked to read, the settings file), an input where the code does not do what the line says. A file that another program running as the person plants at keyprompt's own paths is outside the threat model (`SECURITY.md`, "Malware or anything else running as you"); those cases are listed, not counted. So is a difference nobody can observe.
- **Reach** says how likely the gap is in use: **everyday** (a form agents or people write routinely), **unusual** (a mistake or a rare file), or **Windows** (seen only there).
- `npm test` on 2e50630: 241 tests, 232 pass, 9 skipped (the real-store tests, which need `KEYPROMPT_STORE_TEST=1`), 0 fail.

## Verdicts

| Line | Verdict | Reach of the gap | Bug |
|---|---|---|---|
| G1 — a direct read is denied | **unmet** | everyday | B-25 |
| G1b — a mention passes | **unmet** | everyday | B-26 |
| G2 — a key in a message gets a warning | met | — | — |
| G3 — install-guard and uninstall-guard | met | — | — |
| G4 — the guard's docs | **unmet** | everyday (follows from G1) | B-27 |
| J — `--json` results | **unmet** | unusual | B-28 |
| F — `keyprompt setup` | **unmet** | unusual | B-29 |
| L — the activity log | **unmet** | Windows | B-30 |
| M — `keyprompt mcp` | met | — | — |

Found on the way, not on an acceptance line: B-31 (the PRD's detail sections say five things the code does not do) and R-14 (MCP clients may give up on a card long before its 5 minutes).

## G1 — a direct read is denied: unmet

Met:

| Clause | Code | Test |
|---|---|---|
| macOS `find-generic-password` with `-w`/`-g`, naming the service, the account (`-a NAME`) or the label | `src/guard.mjs:141-160` | `test/guard.test.mjs:23-41`, 87-90 |
| `security dump-keychain -d` | `src/guard.mjs:161` | `test/guard.test.mjs:28` |
| `secret-tool lookup` or `search` naming the service or a saved name | `src/guard.mjs:172-176` | `test/guard.test.mjs:42-44` (search with a saved name: no test) |
| `Get-StoredCredential`, CredRead through `Add-Type` | `src/guard.mjs:214`, 243-248 | `test/guard.test.mjs:45-49` (CredRead naming only a saved name: no test) |
| Chains, `$( )`, backticks, `sudo -u`, `env A=1`, `bash -c`, `pwsh -Command`, `keyprompt run -- …` | `src/guard.mjs:47-135`, 184-228 | `test/guard.test.mjs:29-41`, 48 |
| The answer is `permissionDecision: "deny"` with exit 0 | `src/guard.mjs:318-320`, `src/cli.mjs:969-971` | `test/guard.test.mjs:98-112`, 171-177 |
| The reason points to `keyprompt run` | `src/guard.mjs:21-22`, 272 | `test/guard.test.mjs:77`, 176 |
| PowerShell: the matcher is `Bash\|PowerShell` and `tool_name` PowerShell is checked | `src/install-guard.mjs:20`, 94; `src/guard.mjs:31` | `test/install-guard.test.mjs:38-45`; `test/guard.test.mjs:100` |

**Unmet.** Each of these printed nothing and exited 0 through `node bin/keyprompt.mjs guard pre-tool-use` (re-run 2026-11-09 23:50 IST; the plain read was denied in the same run, as a control):

- `timeout 5 secret-tool lookup service keyprompt account X`
- `nice -n 10 security find-generic-password -s keyprompt -w`, and `env -u FOO security …`
- `security \` then a line break, then `find-generic-password -s keyprompt -w`
- `security find-generic-password -skeyprompt -w` (the value written against its flag, which `security` accepts)
- `keyprompt list | xargs -I{} security find-generic-password -s keyprompt -a {} -w`
- PowerShell: `Set-Location "C:\proj\"; Get-StoredCredential -Target keyprompt:X`, and `CredentialManager\Get-StoredCredential -Target keyprompt:X`

Causes: `timeout` and `xargs` are not in `WRAPPERS` (`src/guard.mjs:25`), and only `sudo` and `doas` options that take a value are skipped (`src/guard.mjs:192`), so `nice`'s `10` or `env`'s `FOO` is read as the command. `splitShell` (`src/guard.mjs:47-135`: a backslash at lines 89-92, `\"` inside double quotes at 104-106) keeps a backslash-newline as a character of the next word, and reads PowerShell text with POSIX escapes, where `\"` is an escaped quote (in PowerShell `\` is a plain character). A module-qualified cmdlet name is not matched. These are plain command text, not the "script file, encoded command or another tool" the limits name.

Not counted, as the PRD's "Honest limits" allow: `echo "<read>" | bash`, `security -i` fed on stdin, a value in a shell variable (`S=keyprompt; … -s $S`), PowerShell string building (`('keyprompt:'+$n)`).

## G1b — a mention passes: unmet

Met: `git grep …` and `echo …` pass (`src/guard.mjs:205-228`; `test/guard.test.mjs:53-57`, 179-183); a plain `git commit -m "…"` passes (`test/guard.test.mjs:58`); a pass prints nothing and exits 0 (`src/cli.mjs:969-971`).

**Unmet.** A commit message written with a here-document is refused (re-run 2026-11-09 23:50 IST, deny with exit 0):

```
git commit -m "$(cat <<'EOF'
Guard: refuse `security find-generic-password -s keyprompt -w`
EOF
)"
```

The same happens when a line of the here-document starts with the read, and with `gh pr create --body "$(cat <<'EOF' …)"`. Cause: `splitShell` does not know here-documents, so it parses the body as shell, and backticks inside a quoted (`'EOF'`) body, which bash leaves as text, become a command. `README.md:285` admits a false refusal for "a `cat <<EOF` block written to a file", but G1b names commit messages, and this repo's own commit messages quote these reads.

## G2 — a key in a message gets a warning: met

| Clause | Code | Test |
|---|---|---|
| Names the kind to the person (`systemMessage`) | `src/guard.mjs:332` | `test/guard.test.mjs:154`, 189 |
| Names the kind to the agent (`additionalContext`) | `src/guard.mjs:333-336` | no test (line 155 checks only `hookEventName`) |
| Does not repeat the text | `src/guard.mjs:327-337` | `test/guard.test.mjs:151-152`, 190, 199 |
| Writes and sends nothing | `src/guard.mjs` has no imports; the guard branch (`src/cli.mjs:958-972`) calls no writer | no test |
| Does not block (no `decision`, never exit 2) | `src/guard.mjs:331-337`, `src/cli.mjs:959-963` | `test/guard.test.mjs:153`, 193-202 |

Google (`AIza…`) and Hugging Face (`hf_…`) keys get no warning; R-12 leaves them out on purpose and `README.md:281` lists the kinds covered.

## G3 — install-guard and uninstall-guard: met

| Clause | Code | Test |
|---|---|---|
| Install, once confirmed, adds the two entries to `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`) | `src/cli.mjs:974-1008`, `src/install-guard.mjs:35-45`, 90-97, 163-170 | `test/install-guard.test.mjs:137-150` (`--yes` only; the typed "y" has no test) |
| Every other setting and hook keeps its value | `src/install-guard.mjs:130-170` | `test/install-guard.test.mjs:53-63`, 162-166 |
| A second run adds nothing | `src/cli.mjs:985-988`, `src/install-guard.mjs:178-186` | `test/install-guard.test.mjs:65-67`, 137-150 |
| Uninstall removes only those entries | `src/install-guard.mjs:130-154`, `src/cli.mjs:1010-1032` | unit tests `test/install-guard.test.mjs:53-63`, 75-83; at the CLI only the refusals (207-217) |

Two edges, not counted: a pre-existing empty `"hooks": {}` or `"PreToolUse": []` is gone after install then uninstall (`src/install-guard.mjs:148-151`), which Claude Code reads the same (the PRD's wording is in B-31); and an integer above 2^53 anywhere in the file is rounded by `JSON.parse` on any rewrite (no Claude Code setting is known to hold one; not checked against a schema).

## G4 — the guard's docs: unmet

Met: what it refuses, that it fails open and that it covers Claude Code only are in `SECURITY.md:19`, 21, 22 and `README.md:280`, 286, 237. "nothing stops it" is gone from both (`git grep` finds it only in the PRD's own history line).

**Unmet: the new words are not literally true.** `SECURITY.md:19` and `README.md:280` say the guard refuses "a Bash or PowerShell command that runs the store's own read tool on a keyprompt item", and the limits they list (`SECURITY.md:20`, `README.md:285`) name only a script file, an encoded command and another tool. The G1 forms above run the store's read tool on a keyprompt item and are none of those. No test pins this wording.

## J — `--json` results: unmet

| Clause | Code | Test |
|---|---|---|
| One JSON object on stdout for each of the four commands, success and failure | `src/cli.mjs:287-292`, 739-744 | `test/cli.test.mjs:802`, 831, 864, 935 |
| command, status, names, exitCode | `src/cli.mjs:273-279`, 615-625 | same |
| Never a value; never a store helper's output | `src/errors.mjs:35-38`, `src/save.mjs:36-38`, 79-86 | `test/cli.test.mjs:874`, `test/errors.test.mjs:13`, `test/save.test.mjs:127` |
| No typed argument for an unknown option, name or hint (`set`, `has`, `delete`) | `src/cli.mjs:230`, `src/names.mjs:14-17`, 54-57 | `test/cli.test.mjs:831`, 874 |
| A failure carries a message; stderr gets no copy | `src/cli.mjs:278`, 421 | `test/cli.test.mjs:831`, 874 |
| Exit codes and text without `--json` unchanged since v0.2.2 | `src/cli.mjs:515-530`, 740 | no comparison test; the J reviewer ran 25 inputs against v0.2.2's code |

Without `--json`, `has FOO --yes` now says "--yes works only with install-guard." where v0.2.2 said "Unknown option --yes" (same exit code). That comes from install-guard's new option, not from `--json`.

**Unmet** (re-run 2026-11-09 23:52 IST, throwaway home):

- `keyprompt -sk_live_PASTEDKEY123 list --json` printed `{"command":"list","status":"invalid_usage","names":[],"exitCode":2,"message":"Unknown command \"-sk_live_PASTEDKEY123\". See keyprompt --help."}`. The typed token, which could be a pasted key, is in the result, and `command` names a command that was never recognized (the PRD says `null`). `setup --json` and `log --json` do the same. Cause: `jsonRequest` skips tokens that start with `-` when it picks the command (`src/cli.mjs:253`), `parseArgs` takes a single-dash token as the command (`src/cli.mjs:229-232`), and the "Unknown command" error (`src/cli.mjs:1044`) has no `jsonMessage`.
- The message does not always say why. `has A1,…,A13 --json` says "A card can ask for at most 12 values at once." (`src/names.mjs:47`, through `src/cli.mjs:737`), though `has` opens no card and text mode calls the input an invalid name. `-x has FOO --json` says "A name is not a valid secret name", because the name check at `src/cli.mjs:737` reads `has` as a name. `check_secrets` with 13 names gets the same card sentence.

## F — `keyprompt setup`: unmet

| Clause | Code | Test |
|---|---|---|
| `.env.example`, or the file `--from` names | `src/setup.mjs:8`, 91 | `test/cli.test.mjs:975`, 1012 |
| A name that is not a template (`.env`, `.env.local`, `dir/.env`, `.ENV.LOCAL`) is refused with exit 2 | `src/setup.mjs:23-32` | `test/setup.test.mjs:47`, `test/cli.test.mjs:995` |
| … before the file is opened (a `.env` with mode 000 gives exit 2, not EACCES) | `src/setup.mjs:92` runs before 97 and 100 | no test of the order |
| One card, the first 12 unsaved, in file order, every box optional; saved names not asked | `src/cli.mjs:803-821`, `src/card-server.mjs:69-71` | `test/cli.test.mjs:975`, 1033 (skipped on Windows) |
| The four report groups and the run line | `src/setup.mjs:136-158`, `src/cli.mjs:823-834` | `test/setup.test.mjs:76`, `test/cli.test.mjs:1033` |
| Errors never quote a line or the path | `src/setup.mjs:98`, 105-114 | `test/setup.test.mjs:64` (a missing file only) |

**Unmet: text from inside a value can come back as a name.** `exampleNames` (`src/setup.mjs:56-81`) skips a line its pattern rejects (lines 71-74) before it checks for an opening quote (line 79). A quoted value that opens on such a line is never passed over, so a `NAME=` line inside it is read as a name. Run 2026-11-09 against `exampleNames`:

- `MY KEY="-----BEGIN` / `INSIDE_VALUE_ONE=sk_live_LEAK1` / `-----END"` gives the names `A_KEY, INSIDE_VALUE_ONE` (with `A_KEY=x` first).
- dotenv's `KEY: value` form (accepted by motdotla/dotenv, lib/main.js line 8, read 2026-11-09 by the F reviewer) does the same: `B_KEY: "start` / `INSIDE_VALUE_TWO=…` / `end"` gives `INSIDE_VALUE_TWO`.

Such a name is then reported, put in the run line and in `--json`'s `skipped`, or asked for on the card. Only name-shaped text before an inner `=` escapes; what follows that `=` never does. A normal `KEY="…"` multi-line value is passed over correctly.

Not counted: a template-named symlink to `.env` is read (`src/setup.mjs:24` checks the path's text), which shows names only, never a value.

## L — the activity log: unmet

| Clause | Code | Test |
|---|---|---|
| The file sits beside the catalog | `src/activity.mjs:30-32`, `src/catalog.mjs:13-19` | `test/cli.test.mjs:1119` |
| One `saved` line for a save by `set`, `setup` and `run`'s card | `src/cli.mjs:775`, 813, 856, then 385 | `test/cli.test.mjs:1144-1153` (`run`'s card save: no test) |
| One `run` line, with only the names that got a value | `src/cli.mjs:866-871` | `test/cli.test.mjs:1107`, 1109, 1115 |
| One `deleted` line only when a value was removed | `src/cli.mjs:932-933` | `test/cli.test.mjs:1109-1110`, 1116 |
| Later, Cancel and the deadline each write one line, for `set`, `setup`, `run` and `mcp` | `src/cli.mjs:376-395`, `src/card-server.mjs:206`, 217, 266-275 | `test/cli.test.mjs:1146-1155` cover `set`'s Later and `run`'s Cancel; the rest, and every deadline, were probed by the L reviewer only |
| time (UTC), event, command, names, exitCode, folder | `src/activity.mjs:131-141` | `test/activity.test.mjs:33-35`, `test/cli.test.mjs:1114-1118` |
| No value, reason, `--by`, environment, output (a closed set of fields) | `src/activity.mjs:131-141` | value and arguments: `test/cli.test.mjs:1120`, 1158 |
| The newest 1,000 lines kept | `src/activity.mjs:165-179` | `test/activity.test.mjs:38-51`, `test/b23-activity-log.test.mjs:28-52` |
| `keyprompt log` shows the newest 50 (70 lines showed lines 20 to 69) | `src/cli.mjs:950-954` | no test of the slice |
| A log that cannot be written changes nothing (`KEYPROMPT_HOME` a file, a read-only folder, `activity.jsonl` a folder, a busy lock) | `src/activity.mjs:160-191` | unit level: `test/activity.test.mjs:53-60`, `test/b23-activity-log.test.mjs:116`, 129 |

**Unmet (Windows, by reading; confidence 0.7).** A `run` whose command is one word holding spaces logs that whole word as the program, so argument text can reach the file: `keyprompt run K -- "curl https://h/v1?key=abc"` would log `program: "v1?key=abc"`, and `"python -c print('x')"` would log all of it. Cause: `programName` (`src/activity.mjs:123-125`) only drops the folder, and on Windows cross-spawn 7.0.6 sends a command it cannot resolve, and that does not end in `.exe` or `.com`, through `cmd.exe` (cross-spawn lib/parse.js lines 36-58, read 2026-11-09 from the installed copy), so the spawn succeeds and the line is written (`src/cli.mjs:868-871`). On macOS the same input fails to spawn and writes no line (seen by the L reviewer). Not run on Windows.

Listed, not counted: a FIFO planted at `activity.jsonl` makes the command hang until something reads it (seen); a lock path that is a folder, or a read-only home with a writable log, skips the trim every time so the file grows past 1,000 lines (seen: 1,025). The first needs a planted file; the second is in B-31 as PRD wording.

## M — `keyprompt mcp`: met

| Clause | Code | Test |
|---|---|---|
| One card per `request_secret`; a second call while one is open is refused | `src/cli.mjs:681-694` | `test/cli.test.mjs:1178`, 1199; `test/b21-cancel-closes-card.test.mjs:126-158` |
| Waits for the person | `src/cli.mjs:694`; the card ends only on a submit, Cancel, Later, the deadline or an abort (`src/card-server.mjs:206`, 217, 262, 272, 283) | `test/b21-cancel-closes-card.test.mjs:133-134` |
| Answers with `set --json`'s result | `setResult` and `jsonFailure` are shared (`src/cli.mjs:273-279`, 615-625); Cancel, the deadline and Later answer with `isError: false` (674) | success only: `test/cli.test.mjs:1199-1201` |
| `check_secrets` answers which names are saved | `src/cli.mjs:703-717` | `test/cli.test.mjs:1195-1196` |
| No answer holds a value | names only; failures use `jsonMessage` (`src/errors.mjs:21`, 35); a handler's own error becomes "Internal error." (`src/mcp.mjs:238`) | `test/cli.test.mjs:1177`, 1197-1198, 1202; `test/b20-empty-fields.test.mjs:32` |
| No answer holds the card's URL | the URL goes only to `openInBrowser`, whose fallback writes it to stderr and only when stderr is a terminal (`src/browser.mjs:27-38`) | no direct test |
| stdout carries only JSON-RPC | one writer, `send` (`src/mcp.mjs:146`); every other stdout write in `src/` is a command's own output or install-guard's prompt; the card line goes to stderr (`src/cli.mjs:370`) | `test/cli.test.mjs:1187-1191`, `test/b21-cancel-closes-card.test.mjs:102-103` |
| No dependency added | `package.json` dependencies are `cross-spawn` 7.0.6 at v0.2.2 and at main; `src/mcp.mjs` imports only `node:string_decoder` | no test |

The M reviewer read the stdio transport rules live on 2026-11-09 (modelcontextprotocol.io/specification/2025-11-25/basic/transports: the server "MUST NOT write anything to its stdout that is not a valid MCP message").

## Met in code, but no test would fail if the code were removed

These are not bugs; they are the checks a later change could break silently. S-64 adds them, in new test files.

- **G1/G2:** CredRead naming only a saved name; `secret-tool search` with a saved name; the agent-facing `additionalContext`; that the guard writes and sends nothing.
- **G3:** the typed "y" confirm; `uninstall-guard`'s success path at the CLI (removing `writeSettings` at `src/cli.mjs:1029` fails no test); the npx-cache refusal at the CLI.
- **G4:** the guard's wording in `SECURITY.md` and the README.
- **J:** text and exit codes without `--json` against v0.2.2; a store helper's output left out on the save path end to end.
- **F:** the name check running before the file is opened; the path never repeated in an EISDIR or EACCES message; nothing from the file reaching the catalog or the log.
- **L:** `run`'s card save line; Later, Cancel and deadline lines for `setup`, `run` and `mcp`; the newest-50 slice; no reason, `--by` or output in the file; stdout, stderr and the exit code unchanged at the CLI when the log cannot be written.
- **M:** Cancel, deadline, Later and a store failure over MCP; the URL in no failure answer; the client's name on the card and its escaping; the dependency list.
- The card tests at `test/cli.test.mjs:935`, 1033 and 1131 are skipped on Windows.

## Found, and not logged as a bug

- `keyprompt mcp --json`, `--version` and `--help` print non-JSON-RPC to stdout; the server never starts, so it is a broken client setting, not a server answer.
- A client that hands keyprompt its own terminal as stderr (the TypeScript SDK's default) gets the "opened a secure card" line and, if no browser opens, the link there. That is the person's terminal, which the link fallback is for.
- A second `request_secret` sent while the first is still reading the store is told "A card is already open" a few milliseconds before one is (`src/cli.mjs:685-687`).
- When a save under way fails after the deadline or a withdraw, the card ends as an error (exit 1) and writes no line; L names only a save, Later, Cancel and the deadline.
- `security dump-keychain -d` is refused without naming keyprompt (it cannot name it); `Monitor` is accepted as a tool name (R-12 says it arrives as Bash).
