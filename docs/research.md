# Research log

One entry per open question. A guess never goes into code: it goes here first. Format and confidence scale: `~/.claude/skills/mystandard/SKILL.md` sections 9 and 15 (high ≥ 0.9, medium 0.7–0.89, low < 0.7).

---

### R-1 — Can the macOS Keychain store a value with line breaks if we hand it over as hex?

**Where:** card v2 · S-7 · `src/store/macos.mjs:53-66` · `macosStore.write`
**Find out:** whether `security -i` accepts `add-generic-password -U -s keyprompt -a NAME -l "…" -X <hex>` on stdin, and whether `find-generic-password -g` then prints the `password: 0x<HEX> "…"` form so `parsePasswordLine` round-trips the bytes exactly. If yes: always write with `-X` (also removes the quoting code). If no: keep the line-break refusal on macOS and say so on the card.
**Confidence:** 0.95 (high) — run here on the real Keychain and matched to Apple's source.
**Review:** none — the integration test decided it.
**Status:** answered 2026-11-05 (S-7).
**Answer:** yes, with a length limit nobody had written down.
- **Hex works.** On macOS 27.0 (build 26A428), `security -i` accepted `add-generic-password -U … -X <hex>` on stdin, upper or lower case. `find-generic-password -g` printed `password: 0x<HEX>  "line1\012line2"`, and `parsePasswordLine` gave back the exact bytes for `\n`, `\r\n`, a fake PEM, non-ASCII and a value whose second line spells a `security` command (stored as data, never run). Run with dummy names on 2026-11-05, then deleted. `security add-generic-password -h` lists `-X` (same Mac, same day).
- **The limit.** `security -i` reads one command into a 4,096-byte buffer, and a longer line is cut after 4,095 bytes; the rest runs as the next command. Evidence: apple-oss-distributions/Security at db15acbe6a7f (Security-61901.0.87.0.1), SecurityTool/macOS/security.c (`MAX_LINE_LEN` 4096 and the loop at lines 1180–1207) and SecurityTool/macOS/readline.c, read via `gh api`, live, 2026-11-05.
  - Seen here: a 64 KiB value was saved cut off, and `security` reported `unknown command "7878…"` for the rest.
  - The quote parser in security.c (`split_line`) only knows `\x` → `x`, so a line break cannot be escaped inside quotes.
  - The prompted form (`-w` given last) uses `getpass()`, which reads the terminal, not stdin (keychain_add.c, same commit), so it is no way around the limit.
  - No `security` command name is made only of hex digits (`security help`, this Mac), so a hex tail could never run as a real command.
- **What S-7 built,** decided by Abhishek on 2026-11-05: a value with a line break goes as hex, and any other value keeps the quoted `-w` form, which fits twice as much. A command over 4,094 bytes is refused before `security` runs (B-5).
  - Room for a one-line value: 4,031 − 2 × (name length) bytes, minus one byte for each `"` or `\`.
  - Room for a value with line breaks: half of 4,033 − 2 × (name length), rounded down.
  - So a 20-character name leaves 3,991 bytes on one line and 1,996 with line breaks. An RSA-2048 PEM (about 1,700) fits. An RSA-4096 PEM (about 3,200) and a pretty-printed Google service-account file (about 2,300) do not; R-2's idea of splitting a value across items would also cover macOS.

### R-2 — How do we store values longer than 1,280 characters on Windows?

**Where:** later (parked) · `src/store/windows.mjs:127-129` · `maxValueLength`
**Find out:** Windows Credential Manager caps a credential blob at 2,560 bytes, which the code stores as UTF-16, so 1,280 characters. An RSA-2048 PEM key (about 1,700 characters) and a Google service-account JSON file (about 2,300) do not fit. macOS has a similar limit since S-7: about 2,000 bytes for a value with line breaks and about 4,000 for one line (R-1). Options: split one value across several credentials (`keyprompt:NAME`, `keyprompt:NAME#2`, …) with an atomic write and read, or a DPAPI-protected file. Which one is safe and simple?
**Confidence:** 0.5 (low) — the limit comes from the existing code comment; neither option has been tried.
**Review:** higher model.
**Status:** open — parked. The card already refuses over-long values with a clear message (`src/cli.mjs:96-98`).
**Answer:** — (the fix options are still open). The limit itself was checked in S-10: Microsoft's CREDENTIALW page says the blob "cannot be larger than CRED_MAX_CREDENTIAL_BLOB_SIZE (5*512) bytes", which is 2,560 (https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw, read live 2026-11-06). The helper stores UTF-16LE, 2 bytes per character (`src/store/windows.mjs`), so 1,280 characters. A value near that size was never saved on a real Windows machine.

### R-3 — Do multi-line values round-trip on Linux (`secret-tool`) and Windows (PowerShell helper)?

**Where:** card v2 · S-8 · `src/store/linux.mjs:43-50`, `src/store/windows.mjs` (the embedded PowerShell script)
**Find out:** whether `secret-tool store` keeps line breaks inside a value read from stdin and `secret-tool lookup` returns exactly those bytes; whether the Windows helper reads all of stdin or only one line. Whatever fails gets fixed in S-8.
**Confidence:** 0.9 (high) — run in CI on the real stores; small values and one image per OS only (see the last bullet).
**Review:** none — the CI run decided it.
**Status:** answered 2026-11-05 (S-8).
**Answer:** yes on both. No store change was needed.
- **What ran.** CI run 42076047835 (https://github.com/abhisheksharma001/keyprompt/actions/runs/42076047835, PR #10, head 70df4d0, read live via `gh` on 2026-11-05): the test "round-trips values through the OS password store byte for byte" saved and read back `line1\nline2`, a four-line fake PEM with a trailing line break, and `a\r\nb`, each compared with `assert.equal`. It passed (not skipped) on Ubuntu and Windows, Node 20 and 22. In the Ubuntu and Windows logs, 70 of 72 tests passed and 2 were skipped: the two macOS-only `security -i` tests.
- **Linux.** `secret-tool store` keeps every line of a value read from stdin, and `secret-tool lookup` returns exactly those bytes, trailing line break included. Seen on the `ubuntu-24.04` image, libsecret-tools 0.21.4-1build3 with gnome-keyring 46.1-2ubuntu0.2 (versions from the job log).
- **Windows.** The PowerShell helper reads all of stdin (`CopyTo` into a stream), not one line, and returns the bytes unchanged. Seen on the `windows-2025-vs2026` image, which runs `powershell.exe`; I did not read its PowerShell version.
- **Not covered.** Only three short multi-line values (the longest, the fake PEM, is 160 bytes) and one image per OS. A multi-line value near the Windows limit (1,280 characters, R-2) or the declared Linux limit (64 KiB) was not run.

### R-4 — What do we call the mascot, and what may it look like?

**Where:** card v2 · decision D-2 · S-12
**Find out:** Abhishek picks an original name and look.
**Confidence:** 0.9 that "Pingu" cannot be used in a public repo. PINGU is a trademark of Joker, Inc. (owned by Mattel), US application 99410827 filed 2025-09-24, status "notice of allowance issued" (trademarkia.com/pingu-99410827, read 2026-11-05). Joker, Inc. opposed another applicant's mark in May 2026 (TTAB case 91307372, trademarkia.com, read 2026-11-05). Wikipedia: Pingu's IP is held by Joker, Inc./Mattel (en.wikipedia.org/wiki/Pingu, read 2026-11-05). A penguin as an animal is not anyone's property; the Pingu name and character design are. Not legal advice.
**Review:** none.
**Status:** decided 2026-11-06: **no name**. On 2026-11-05 Abhishek chose "Pinguu" after the evidence below; the re-check before S-16 and S-17 (2026-11-06, last block of the Answer) led him to choose "Drop the name". Done in S-22.
**Answer:** "Pinguu" is risky, not blocked. Evidence (search 2026-11-05, cached copies):
- **Mattel opposes look-alikes.** Joker, Inc. (a Mattel subsidiary) filed a US opposition against the mark **PINU**, one letter off, describing Pingu as "a playful, curious, and occasionally mischievous little boy penguin" (USPTO TTAB 91303787, notice dated December 2025, ttabvue.uspto.gov, indexed 2026-05-26).
- **Not every opposition wins.** Japan's patent office dismissed Joker, Inc.'s opposition to "pingu・pongu" on 2026-05-22: it was treated as one made-up term, and Joker had not proved current fame (marks-iplaw.jp, indexed 2026-08-02). That is a Japanese ruling on a compound word, so it says little about "Pinguu".
- **"Pinguu" is already in use:** a crypto trading bot (pinguu.tech, github.com/ffischer42/Pinguu_App), a UK care-home staff-location product, and a UK company PINGUU STORE LTD (dissolved 2021).

Judgment (not legal advice): low risk while keyprompt is small and free; the risk rises with popularity, and with a penguin that looks like Pingu. Guards are in decision D-2.

**Re-check, 2026-11-06 (not legal advice).** Done before S-16 and S-17, as D-2 required:
- PINGU, US application 99410827, owner Joker, Inc. (Mattel's attorney), toys and games (class 28). Notice of allowance 12 May 2026; statement-of-use deadline **12 Nov 2026**. trademarkia.com/pingu-99410827, read 2026-11-06, live.
- Mattel opposes look-alike marks: it filed against HIJARBIE (Barbie) on 2026-09-01. ttabvue.uspto.gov/ttabvue/ttabvue-91310048-OPP-1.pdf, cached 2026-10-11.
- Japan's patent office dismissed Joker's opposition to "pingu・pongu" on 2026-05-22, a compound word, so it says little about "Pinguu". blog.marks-iplaw.jp/2026/06/05/pingu-vs-pingu-pongu, cached 2026-08-02.
- Keenable searches for "Pinguu" trademark and Mattel action on 2026-11-06 found nothing new. Weak evidence: the USPTO's own search cannot be queried with the tools used here.
- Judgment: the name appeared in one visible place and cost one line to drop, and the risk rises with popularity and with publication on npm. **Abhishek chose "Drop the name" (2026-11-06).** S-22 removed it. The look must still be clearly our own.

### R-5 — What do competing tools actually do, and where can a lite tool do better?

**Where:** card v2 · the PRD section "What others do"
**Find out:** for Infisical Agent Vault, AgentSecrets, Secretless AI (source code), and AgentsRoom, 1Password for AI agents and native features in Claude Code, Codex, Cursor and Copilot (docs only): how the agent asks, how the human enters, storage, injection, masking, approvals, setup cost, overclaims, user complaints.
**Confidence:** 0.8 (medium) — the open-source tools were read in their source at pinned commits, and the closed ones in live docs. Nothing was installed or run, so this is code reading, not observed behaviour.
**Review:** Opus 5.5 read all four reports on 2026-11-05.
**Status:** answered 2026-11-05.
**Answer:** the summary table is in `docs/prd/card-v2.md` ("What others do"). Key evidence:
- **Infisical Agent Vault**
  - Read at Infisical/infisical@41db38dca9f7, Infisical/cli@42e316e33baa, Infisical/agent-vault@2cb47bff789d.
  - The agent cannot request a missing key; it gets a 403 or 407 (docs `platform/agent-vault/proxies.mdx:175-200`). The old "proposals" flow is deprecated (agent-vault docs/learn/proposals.mdx).
  - Delivery is an HTTPS proxy that needs a trusted certificate. There is no output masking.
  - The CLI's session TTL defaults to "never" (`cmd/agent_vault_run.go:842`), while the docs say 7 days. Issue infisical#8987 confirms this (gh, live, 2026-11-05).
  - The code lives under the enterprise licence (`backend/src/ee/LICENSE.md`). Pricing: first 5,000 brokered requests a month free, then $2 per 1,000 (live fetch, 2026-11-05).
- **AgentSecrets**
  - Read at the-17/agentsecrets@be53766186fd. Go, about 24k lines, 196 stars (gh, live, 2026-11-05).
  - A missing key gives error SEC-404, and the agent tells the user to type `secrets set KEY=VALUE` (`pkg/proxy/engine.go:578-582`, `commands/workflow_content.go:89-95`). The value is a command-line argument (`commands/secrets.go:57,126-135`).
  - `env --` injects every secret in the project (`commands/env.go:73,93-96`).
  - Its masking catches encoded forms (`commands/env.go:220-329`).
  - It needs an account and a daemon. Issue #5, "Local mode, no login", is open since 2026-04-08 (gh, live).
  - The README overclaims (`README.md:5,43-49`) and links a `SECURITY.md` that does not exist.
- **Secretless AI**
  - Read at opena2a-org/secretless-ai@f2568f133c01. TypeScript, about 53k lines, Apache-2.0, 26 stars (gh, live).
  - There is no request flow. Input is one hidden terminal line, so a pasted multi-line value keeps only its first line (`hidden-line.ts:46-101`).
  - `run` does not mask output (`run.ts:86,111-114`), but refuses a value found in the command's arguments (`run.ts:66-79`).
  - Claude Code hooks: PreToolUse blocks env dumps and secret-file reads; UserPromptSubmit blocks prompts containing keys; Stop redacts the transcript (`init.ts:428-515`).
  - Telemetry is on by default (`README.md:86-104`). The fallback file's encryption key can be rebuilt from HOME and USER (`local.ts:84-96`).
- **AgentsRoom** (live docs): the agent asks you to add the key in their desktop app. Values are stored with Electron safeStorage in `~/.agentsroom/secrets.json` and filled into `{{secret:NAME}}` at launch. Pro costs €7.99/mo (cached 2026-10-22).
- **1Password** (live blog, 2026-10-22): the agent asks, you approve, and 1Password fills in a website login. That covers web sign-ins only, for partner agents. `op run` masks output. The Environments MCP server returns names only.
- **The agents themselves** (live `gh` changelogs):
  - Claude Code 2.1.287 "Added URL prompts from MCP servers on the 2025-11-25 protocol". No local feature for asking the human for a key, as of 2.1.318.
  - Codex 0.164.0 masks credentials in remote Bash.
- **Close projects** (cached package pages, unverified): keymask, pi-secrets, keyward. See R-9.

#### S-41 follow-up to R-5 — structured errors (read live 2026-11-07)

Sources reread during this session: https://infisical.com/docs/api-reference/overview/errors documents API fields reqId, statusCode, error and message, with stable identifiers such as NotFound. That is the API, not its CLI: https://infisical.com/docs/cli/troubleshooting explicitly says CLI errors are plain text on stderr and exit 1. https://docs.agentsecrets.tech/troubleshooting/error-codes documents SEC-404 for a missing secret and ERR-999 for unexpected failures; it does not establish a JSON CLI result shape.

Keyprompt's design inference: use stable status identifiers plus its existing exit codes. Do not copy HTTP codes into local-store outcomes. Emit no raw exception text or catalog data; the four-command scope avoids mixing a child's output with JSON. Confidence 0.95 in these documented facts; they were fetched live, not inferred from earlier notes.

### R-6 — Could keyprompt plug into any MCP agent through "URL mode elicitation"?

**Where:** v0.3 · S-44 (this answer) · S-45, a possible `keyprompt mcp` server
**Find out:** which agent clients implement URL mode, and whether a keyprompt MCP server could hand them the card URL that way.
**Confidence:** 0.85 (medium). The spec, the SDKs and six clients were read in their own source or docs; Cursor and Windsurf stay unconfirmed, and nobody has yet tried whether a client opens an `http://127.0.0.1` URL.
**Review:** higher model before any build (S-45).
**Status:** answered 2026-11-09 (S-44). The 2026-11-05 facts were read again, not reused.
**Answer:** read live on 2026-11-09 by a research subagent. I checked four of its claims myself the same day: both SDKs' versions and dependencies with `npm view`, Codex's URL check at tag rust-v0.167.0, and Claude Code's changelog. All four matched.

- **Spec: there are two protocol versions to speak, and they work differently.**
  - The current version is 2026-07-28 (modelcontextprotocol.io/specification/versioning; its changelog at /specification/2026-07-28/changelog). It has no `initialize` handshake: every request carries `_meta` with the protocol version and the client's capabilities, and servers must answer `server/discover`. A server asks for something during a tool call by answering `tools/call` with `resultType: "input_required"` and an `elicitation/create` with `mode: "url"`, `message` and `url`. The client asks the person, opens the URL, and then calls the tool again with the answers. `accept` only means the person agreed to open the page (/specification/2026-07-28/client/elicitation and /basic/patterns/mrtr).
  - The previous version, 2025-11-25, has the `initialize` handshake. There the server sends its own `elicitation/create` request (with an `elicitationId`) in the middle of the tool call, and may send `notifications/elicitation/complete` afterwards (/specification/2025-11-25/client/elicitation; schema.ts at modelcontextprotocol/modelcontextprotocol@222640c).
  - VS Code speaks only 2025-11-25 and Claude Code speaks both, so a server must speak both: it answers by the version of the first message it gets.
- **What the spec asks of the server, and where keyprompt's card does not obviously fit.**
  - It may not put sensitive data in the URL, and it MUST NOT send "a URL which is pre-authenticated to access a protected resource".
  - It must tie each request to the person who started it, and check that whoever opens the page is that person. A server that is not on the web "must use a different mechanism".
  - The card's URL carries a one-time token. That token lets its holder save a value, never read one, but it is still a capability link, and whether it breaks that MUST is not settled.
  - The spec never mentions localhost. It says servers "SHOULD use HTTPS URLs for non-development environments", so `http://127.0.0.1` goes against a SHOULD, not a MUST (both versions' elicitation pages).
  - A server MUST NOT use a mode the client did not declare. In 2026, a request that truly needs an undeclared capability gets error `-32021`.
- **Clients, as of 2026-11-09.**
  - **Claude Code 2.1.319: yes, in interactive sessions only.**
    - URL mode on 2026-07-28 connections arrived in 2.1.281 and on 2025-11-25 in 2.1.287 (CHANGELOG.md via `gh`, live).
    - It asks the person, then opens the URL in the browser (code.claude.com/docs/en/mcp, live).
    - With `claude -p`, an unanswered elicitation is cancelled (code.claude.com/docs/en/headless). The changelog instead describes such a call timing out, so the two disagree.
    - The tool-call timeout is long: `MCP_TOOL_TIMEOUT`, and a 30-minute idle timeout for stdio.
  - **VS Code 1.145.2: yes, on 2025-11-25 only.** It has supported it since 1.107 (code.visualstudio.com/updates/v1_107). The source at microsoft/vscode@14a4fc0 shows an "Open <host>" consent button.
  - **Codex CLI 0.167.0: it declares URL mode but declines any URL that is not `https`.** `validate_external_url` in codex-rs/tui/src/bottom_pane/app_link_view.rs at rust-v0.167.0 returns nothing unless the scheme is https. So it would decline keyprompt's card.
  - **Gemini CLI v0.67.0: no.** It registers only `roots`, and issue #28074 was closed as not planned.
  - **Zed v1.27.0: no.** It has no elicitation capability.
  - **Cline v4.1.26: no.** It sends `capabilities: {}`.
  - **Cursor: unconfirmed, probably no.** Its docs say "Elicitation: Supported" without mentioning URL mode (cursor.com/docs/mcp). A forum post shows cursor-agent declaring form mode only (secondary).
  - **Windsurf: unconfirmed.** Its changelog does not mention elicitation.
- **What building it would take.**
  - **SDK v2,** `@modelcontextprotocol/server` 2.4.0 (2026-10-23). It brings three packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/core`, and zod 4.x), about 14.5 MB unpacked, and needs Node 20 or later. keyprompt promises 18.17 or later, so the floor would rise. It speaks both versions through one `serveStdio`, with URL mode via `inputRequired.elicitUrl` (`npm view`, live; typescript-sdk@1e608ca docs/migration/support-2026-07-28.md).
  - **SDK v1,** `@modelcontextprotocol/sdk` 1.32.2. It has 17 dependencies (express, hono, ajv, jose, zod and others) and is 4.49 MB unpacked. It speaks 2025-11-25 only and gets only fixes now (`npm view`, live; typescript-sdk README@1e608ca).
  - **Hand-written, both versions, no new dependency.** It needs a line reader and writer over stdio; `initialize`, `notifications/initialized` and `ping` (2025); `server/discover` and `_meta` on every request (2026); `tools/list` and `tools/call`; the 2025 `elicitation/create` with its reply and the completion notice; the 2026 `input_required` answer and its retry, with a signed `requestState`; `notifications/cancelled`; the JSON-RPC errors; and exiting when stdin closes.
- **What this means for keyprompt (my inference, not a source).**
  - Today URL mode would reach two clients that keyprompt can already serve: Claude Code (shell and skill) and VS Code. Its agent can run `keyprompt` in a terminal too. Codex, the third client that declares URL mode, would decline the card.
  - A keyprompt MCP server would also have to answer the open security question above.
  - A tools-only server, one that opens the card itself the way `keyprompt set` does, would work in any MCP client without URL mode. But it still cannot hand a value to anything except through `keyprompt run`, which needs a shell.

### R-7 — Is the npm package name free?

**Where:** card v2 · S-17
**Find out:** whether `keyprompt` can be published under that name.
**Confidence:** 0.9 — `npm view keyprompt` returned 404 Not Found on 2026-11-05. Names can be taken at any time; check again right before publishing.
**Status:** answered 2026-11-05; re-checked 2026-11-06 at S-17.
**Answer:** free on 2026-11-05. Re-checked 2026-11-06 17:17 IST against the live registry: `npm view keyprompt` returned 404, and so did `key-prompt`, `key_prompt` and `key.prompt`.

### R-8 — How do we hide a pasted multi-line secret on the card?

**Where:** card v2 · S-4 · the card page (multi-line field)
**Find out:** an `<input type=password>` cannot hold line breaks, and a `<textarea>` shows text in the clear. Options: (a) a small "paste here" box that, once something is pasted, hides it and shows only "27 lines, 1,704 characters pasted" with a Show button; (b) the CSS `-webkit-text-security: disc` on the textarea (browser support must be checked in the primary source, e.g. MDN or caniuse, for Chrome, Safari and Firefox). Recommendation: (a), because it works in every browser and also shows the person what arrived.
**Confidence:** 0.6 (low) on (b)'s Firefox support — from memory. (a) needs no browser feature beyond `paste` events.
**Review:** none.
**Status:** answered 2026-11-05 — S-4 uses (a).
**Answer:** (b) does work in all three now: `-webkit-text-security` is supported by Chrome 1+, Safari 3+ and Firefox 114+, and is non-standard (MDN browser-compat-data, https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/-webkit-text-security.json, read live 2026-11-05; MDN page https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/-webkit-text-security, live 2026-11-05). S-4 still uses (a): it needs no non-standard CSS and it tells the person what arrived ("4 lines, 68 characters pasted"). The page catches the `paste` event on an empty box, puts the text in a hidden text area and shows the count with Show and Clear; typed text stays visible. Checked in headless Chromium (agent-browser 0.27.0) with a synthetic paste, 2026-11-05.

### R-9 — How mature is keymask, the closest rival?

**Where:** card v2 · the PRD section "What others do"
**Find out:** keymask (`@trevorbyrum/keymask` on npm) reportedly has a `request_secret` tool that opens a local multi-field form and saves to the keychain or `.env`, plus `run_with_secrets` that redacts output. Is it real and maintained, and how good is its form? If it already does the card moment well, our edge is only the buddy, the receipt, Later and zero setup, and the README should say so.
**Confidence:** 0.9 (high) for the facts below, which were read in primary sources on 2026-11-07. It was 0.4 (low) before, from one cached libraries.io page (indexed 2026-09-26). The form was not run or rendered, so how it looks and feels is not judged.
**Review:** none — the published package settles it (its source repository is not public).
**Status:** answered 2026-11-07 (S-36). It was meant to be done before S-16, but S-16 shipped without it; the README makes no claim about keymask, so nothing it says was affected.
**Answer:** as of 2026-11-07 (all read live):

- **It is real, and small.** The npm record (`npm view @trevorbyrum/keymask`, registry https://registry.npmjs.org/@trevorbyrum/keymask, 05:16 IST) lists five versions, 0.1.0 to 0.1.3 on 2026-05-23 and 0.2.0 on 2026-05-28; 0.2.0 is `latest`, with one maintainer, the license "MIT AND OFL-1.1", 46 files and tarball shasum 8c9dd930aaa2fd8bdc898463c8d2479f4ab4dca6. I downloaded that tarball into a new folder and read it; I did not run it.
- **Its source is not public.** The package says its repository is github.com/trevorbyrum/keymask. That address answers 404 without a login (curl, https://github.com/trevorbyrum/keymask, 05:16 IST), `gh api repos/trevorbyrum/keymask` answers 404, and the author's 11 public repositories (`gh api users/trevorbyrum/repos`, same time) do not include it. Its README still tells people to `git clone` that address and shows a CI badge for it. The last publish is about 5 months before this check; I cannot see commits, so I cannot say more about upkeep.
- **What it is.** An MCP server (README in the tarball): eight tools, registered in the agent's config by file path, Node 22 or later. `request_secret` opens a form on the local machine; `run_with_secrets` runs a command and scrubs values from its output. Destinations: a project `.env` file (the default), the OS stores (macOS Keychain, Linux libsecret, Windows Credential Manager), HashiCorp Vault, and SSH hosts.
- **How far its form goes.** One request takes one or two fields at most (the input check in dist/tools/request.js says "max 2 fields"); a field has a name, an optional label and an optional description, with no hints for a visible, multi-line or optional box. The page (dist/ui/form.html, about 21 KB) has light and dark colours, bundled Inter font files, a Show control and a Submit button; a search of the page for "later", "receipt", "penguin", "mascot" and "svg" finds none. The form's token is 128 bits (`randomBytes(16)`, dist/ui/server.js line 56).
- **Its masking is exact-match.** The comment at the top of dist/scrubber.js says a value transformed by the agent or the command (base64, hex, chunked, JSON-encoded) is not matched. keyprompt has masked the base64, base64url, lowercase hex, URL-encoded and JSON-escaped forms of a value of 8 or more characters since 0.2.1 (S-18, S-25), not chunked ones.
- **Where it does more than keyprompt:** Vault, SSH hosts and writing a `.env` file, and being an MCP tool (keyprompt's MCP server is a v0.3 idea, R-6). **Where keyprompt does more:** up to 12 fields per card with visible, multi-line and optional hints; a Later button; a receipt; a deadline clock; encoded-copy masking; an install with `npm install -g keyprompt` on Node 18.17 or later and no MCP server to register; and saved values go to the OS password store, not to a file.
- **What this changes.** The edge in the PRD stays as written: keymask is the closest rival for "the agent asks, a local form opens, the value lands in a store", and the difference is the part above. The PRD's two lines about keymask now say what is known (S-36). The README needs no change, because it compares nothing.
- **Not done:** the form was not rendered in a browser, and the Windows and Linux paths of keymask were not read in detail.

### R-10 — How does Claude Code let a hook stop or warn about a tool call or a prompt, and how is one installed?

**Where:** v0.3 · S-38 and S-39 · the guard (`docs/prd/v0-3.md`)
**Find out:** what a hook receives, how it denies a command or only warns, what happens when it fails, and where and how it is written into settings. The guard's design (and what SECURITY.md may say about it) depends on every one of these.
**Confidence:** 0.85 (medium) for the points marked "raw", which were read verbatim in the page's text; 0.75 (medium) for the points marked "extracted", where a page-reading tool quoted the page for me and I did not see the surrounding text.
**Review:** none · S-38 and S-39 read the page again before writing code, because hooks change between Claude Code versions.
**Status:** answered 2026-11-07 (S-37).
**Answer:** as of 2026-11-07, read live from https://code.claude.com/docs/en/hooks ("Hooks reference") at about 06:20 IST; the Claude Code on this machine is 2.1.319 (`claude --version`). The first extraction call returned "NOT ON PAGE" for every question, which was wrong, so I fetched the page raw and then asked again with a larger limit.

- **Where hooks live (raw).** In JSON settings files: `~/.claude/settings.json` (all your projects, local to your machine), a project's .claude/settings.json (one project, can be committed) and .claude/settings.local.json, managed policy settings, plugins, and skill or subagent frontmatter. Hook entries from different levels merge; they do not replace each other. The same hooks fire in the terminal, the IDE extensions and the desktop app; cloud sessions do not read your local `~/.claude/settings.json`. An administrator can switch user hooks off with `allowManagedHooksOnly`.
- **Shape (raw).** Three levels: an event (`PreToolUse`, `UserPromptSubmit`), a matcher group, and one or more handlers. A command handler is `{"type": "command", "command": ..., "args": [...], "if": ...}`. A matcher of only letters, digits, `_`, `-`, spaces, `,` and `|` is a list of exact names, so `Bash|PowerShell` matches both tools. `Bash` on PreToolUse also matches Monitor commands. When `args` is present, `command` is run as an executable with that argument list and no shell (extracted). `if` holds exactly one permission rule such as `Bash(rm *)` (extracted).
- **What PreToolUse receives (raw for the shape, extracted for the full field list).** JSON on stdin: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input` (for Bash: `command`, `description`, `timeout`, `run_in_background`) and `tool_use_id`; inside a subagent also `agent_id` and `agent_type`.
- **How it denies (raw).** It prints `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..."}}` and exits 0; "Claude Code reads the JSON decision, blocks the tool call, and shows Claude the reason." Exit 0 with no output "means the hook has no decision to report, so the tool call continues through the normal permission flow. The hook can deny the call, but staying silent doesn't approve it." The other values are `"allow"`, `"ask"` (the person is asked) and `"defer"`.
- **When a hook fails (extracted).** Exit 2 is a blocking error (stderr becomes the reason). "Any other code, or fails in some other way, such as not starting or printing invalid JSON" is a non-blocking error: "The action goes ahead", and the person sees a `<hook name> hook error` notice. **So a guard that is missing, crashes or cannot start fails open.** The default command timeout is 600 seconds, and 30 on `UserPromptSubmit` (extracted).
- **Windows (raw).** There is a separate `PowerShell` tool, and the docs' own example uses the matcher `Bash|PowerShell`. A handler with `args` is spawned without a shell, which cannot run a `.cmd` shim (my reading, not on the page): the installer should call `node` with the script path.
- **UserPromptSubmit (extracted; the output example and the block behaviour read again at about 06:22 IST).** Receives the same common fields plus `prompt`. The page's output example is `{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "...", "sessionTitle": "...", "suppressOriginalPrompt": true}, "decision": "block", "reason": "..."}`. On exit 0, plain text on stdout or `additionalContext` is added to Claude's context; `systemMessage` "surfaces a message to the user on any platform"; `decision: "block"` or exit 2 blocks. "A blocked prompt never reaches Claude." The block message the person sees ends with "Original prompt:" and the text, and is written to the session's transcript file, unless `suppressOriginalPrompt` is true; even then "the submitted text can still appear in local files such as the session transcript and your prompt history." The hook also runs on "a session-scoped scheduled task firing, including a `/loop` iteration", "a background subagent reporting back" and "a message another session sends to your main conversation".
- **What this means for keyprompt.** (1) The guard fails open; `install-guard` must check that its command exists, and SECURITY.md must say it fails open. (2) The guard reads command text, so it can refuse the obvious direct reads of keyprompt's items; it cannot stop a script, an encoded command or another tool, and an agent that can edit `~/.claude/settings.json` can remove it. It is a guardrail, not a wall, and the words must say so. (3) Match `Bash|PowerShell`. (4) A warning cannot take a key back: the message has already gone to Claude. Only a block keeps it from Claude, and the text still stays in local transcript and history files. D-12 chose warn; the S-38 grill confirms it with this fact. The words never say "you pasted", because the hook also sees messages the person did not type. (5) Run `node` with an absolute script path and `args`, which avoids shell quoting and `.cmd` shims.
- **Not done:** no real Claude Code session has run a keyprompt hook yet; S-39 checks that with `claude -p` in a scratch project.

### R-11 — Does Claude Code look for its settings.json somewhere else when `CLAUDE_CONFIG_DIR` is set?

**Where:** v0.3 · S-39 · the installer (`docs/prd/v0-3.md`)
**Find out:** whether the settings file Claude Code reads is `~/.claude/settings.json` for everyone. If an environment variable moves it, `install-guard` would write a file Claude Code never reads and the person would think they were protected. The answer decides whether the installer reads that variable or refuses when it is set.
**Confidence:** 0.9 (high) after the answer below, read in Claude Code's own docs. It was 0.4 (low) before, from memory.
**Review:** none — the docs settle it.
**Status:** answered 2026-11-07 (S-39).
**Answer:** read live on 2026-11-07 at about 09:21 IST, from the raw Markdown of Claude Code's docs (fetched with curl).

- **Yes, it moves.** code.claude.com/docs/en/env-vars: "`CLAUDE_CONFIG_DIR` | Override the configuration directory (default: `~/.claude`). All settings, session history, and plugins are stored under this path." It can be set "in your shell, user settings, or managed settings", and the page's own example is an alias, `alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'`. code.claude.com/docs/en/settings: "On Windows, `~/.claude` means `%USERPROFILE%\.claude`. To keep the home-directory files somewhere else, set `CLAUDE_CONFIG_DIR`; Claude Code then stores your settings, session history, and plugins there instead."
- **So the installer** writes `$CLAUDE_CONFIG_DIR/settings.json` when the variable is set (and refuses a relative path), and `~/.claude/settings.json` otherwise. It prints the path it writes. A variable set only inside an alias is invisible to it; the README (S-40) says to run `install-guard` with the same `CLAUDE_CONFIG_DIR`.
- **Two more facts from the settings page:** "Settings files are strict JSON: a `//` comment or a trailing comma is a syntax error", so the installer parses strict JSON and leaves a broken file alone; and (read with the page-reading tool, live) "Claude Code watches your settings files and reloads them when they change, so it applies most edits to the running session without a restart, including edits to `permissions`, `hooks`, ...".

### R-12 — Which commands read a keyprompt item directly on each OS, and what does the guard receive from each tool?

**Where:** v0.3 · S-38 · the guard's check (`docs/prd/v0-3.md`, "What counts as a direct read")
**Find out:** (a) whether `secret-tool search` prints secret values, which would make it a read; (b) which PowerShell commands read a Generic credential by target name (keyprompt itself calls CredRead through Add-Type, `src/store/windows.mjs`); (c) which field holds the command in the `tool_input` of the `PowerShell` and `Monitor` tools; (d) which key formats the message check recognises, each from its provider's own docs. A wrong list either misses reads or blocks harmless commands with a reason that is not true (invariant 9).
**Confidence:** 0.85 (medium) after the answer below: (a), (c), the GitHub, Stripe and Slack formats and `cmdkey` were read in primary sources; the Windows cmdlet and the OpenAI formats come from secondary sources. It was 0.6 (low) before, from memory. macOS is 0.9 (high): `-g` prints the value (keyprompt reads with it, `src/store/macos.mjs`) and `-w` prints only the value.
**Review:** none — answered in sources; the parts that rest on secondary sources are marked below.
**Status:** answered 2026-11-07 (S-38).
**Answer:** read live on 2026-11-07 between about 08:50 and 09:00 IST, unless marked cached.

- **(a) `secret-tool search` prints values.** libsecret's source, tool/secret-tool.c on the main branch of gitlab.gnome.org/GNOME/libsecret (raw file, live): the search result printer writes `label = ...`, then `secret = ` followed by the value, then the dates and attributes. Its usage line is `secret-tool search [--all] [--unlock] attribute value ...`. So `search` counts as a read, like `lookup`.
- **(b) Windows.** `cmdkey` cannot show a password: "Passwords are not displayed after they're stored" (learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmdkey, live), so the guard lets it through. The reads are `Get-StoredCredential` from the CredentialManager module (powershellgallery.com/packages/CredentialManager, live: version 2.0, last updated 2016-06-17; that page did not list cmdlets, and its `Get-Command` output naming Get-StoredCredential, Get-StrongPassword, New-StoredCredential and Remove-StoredCredential is quoted on stackoverflow.com/questions/65059800 and in a Microsoft Q&A thread, both secondary), and CredRead through Add-Type, the route keyprompt itself uses (`src/store/windows.mjs`). Other modules also define a `Get-StoredCredential` for their own file stores; the guard refuses it only when it names a `keyprompt:` target or a saved name.
- **(c) What the guard receives.** PowerShell: "Your PreToolUse hooks receive the tool's command string in `tool_input.command`, with the same fields as the Bash tool" (code.claude.com/docs/en/tools-reference, live). Monitor: a hook with a `Bash` matcher "also runs on shell commands Claude starts with the Monitor tool", and with that matcher "the hook gets a Bash call"; it can deny it (code.claude.com/docs/en/hooks, live; needs Claude Code 2.1.314 or later).
- **(d) Key formats.** GitHub: `ghp_`, `github_pat_`, `gho_`, `ghu_`, `ghs_`, `ghr_` (docs.github.com, "GitHub's token formats", live). Stripe: live keys start `sk_live_`, `rk_live_` and `pk_live_` (publishable, not secret) (docs.stripe.com/keys, live). Slack: `xoxb-`, `xwfp-`, `xoxp-`, `xapp-`, `xoxe.xapp-` (docs.slack.dev/authentication/tokens, live). Anthropic: "The Console shows the full key, which starts with `sk-ant-`" (platform.claude.com/docs/en/get-api-key, a search index copy acquired 2026-10-22, cached). OpenAI: `sk-proj-`, `sk-svcacct-` and `sk-admin-`, with older keys plain `sk-`; no OpenAI page saying so was found, so this rests on OpenAI's own API output quoted on community.openai.com (2025-02-28) and on secret scanners' rules (aquasecurity/trivy issue 10794, 2026-06-04). Private keys: the `-----BEGIN ... PRIVATE KEY-----` armour, from memory of RFC 7468; not read today.
- **Left out on purpose, to keep the warning quiet:** AWS (the access key ID is not secret, and the secret key has no fixed prefix), Google, publishable keys and Stripe test keys.

### R-13 — What path should the installed hook call so that it keeps working?

**Where:** v0.3 · S-39 · the installer (`docs/prd/v0-3.md`, "How the guard works")
**Find out:** (a) how `install-guard` can tell it is running from npx's temporary cache (the README offers `npx -y keyprompt`), whose folder can be deleted at any time, so that it refuses there; (b) whether the absolute path of the running `node` plus the absolute path of `bin/keyprompt.mjs` survives the usual ways people manage Node (nvm, Homebrew upgrades), and what the person sees when it does not. A path that disappears makes the guard fail open with only a hook error.
**Confidence:** 0.8 (medium) after the answer below: the folder layout and the Homebrew path were seen on this machine (one npm version, one Homebrew install), and the exec-form rules were read in Claude Code's docs. It was 0.6 (low) before, from memory.
**Review:** none.
**Status:** answered 2026-11-07 (S-39).
**Answer:** read and run on 2026-11-07 at about 09:20 to 09:25 IST.

- **(a) npx's folder.** npm's docs say only that "The requested packages are installed to a folder in the npm cache" (docs.npmjs.com/cli/v11/commands/npm-exec, live); they do not name it. On this machine (npm 10.9.7, cache `~/.npm` from `npm config get cache`) packages run with npx sit in `~/.npm/_npx/<16 hex characters>/node_modules/<package>`. So the installer refuses when a folder in keyprompt's own path is named `_npx`, on every OS.
- **(b) Which node.** Homebrew's node reports its versioned path for itself: `/opt/homebrew/bin/node -p process.execPath` printed `/opt/homebrew/Cellar/node/25.9.0_2/bin/node`, while `/opt/homebrew/bin/node` is a link to it. An upgrade that removes the old version would break a hook pointing at the Cellar path (that old versions get removed is from memory of Homebrew's cleanup, not read today). So the installer writes the first `node` on PATH whose real path is the running node's, and falls back to the running node's own path. With nvm, node and the global packages both live in the version's folder (`npm prefix -g` printed `~/.nvm/versions/node/v22.22.2`), so removing that version removes both; the hook then fails open with a hook error, and running `install-guard` again fixes it.
- **Exec form** (code.claude.com/docs/en/hooks, raw Markdown, live): with `args`, "Claude Code resolves `command` as an executable on `PATH` and spawns it directly with `args` as the argument vector. There is no shell"; "Absolute paths with spaces, such as `C:\Program Files\nodejs\node.exe`, are a single valid executable"; and on Windows "exec form requires `command` to resolve to a real executable such as a `.exe`", not a `.cmd` shim. The installer writes node's absolute path in `command`, so all three hold.
- **Failing open or closed** (same page): a command hook takes `"onFailure": "continue"` or `"block"` ("Requires Claude Code v2.1.295 or later"); unset, "the action goes ahead" when the hook fails, with "a `<hook name> hook error` notice". The installer leaves it unset (D-17).

### R-14 — Do MCP clients give up on a `request_secret` call before the card's 5 minutes?

**Where:** v0.3 · S-45 / S-56 · `src/mcp.mjs:86` (the tool description says "at most 5 minutes") · `request_secret`
**Find out:** each client's default time limit for one `tools/call` (Claude Code, VS Code, Cursor, Codex), whether progress notifications reset it, and whether a person can raise it. If a common client gives up after 60 seconds, a person who takes longer finds the card withdrawn (B-21's path) and the agent gets no answer. Depending on the answer: send progress notifications while the card is open, say the limit in the README and the tool description, or do nothing.
**Confidence:** 0.4 (low). One fact read, by the S-56 audit's M reviewer: the official TypeScript SDK's default request timeout is 60 seconds and progress resets it only when the client opts in (typescript-sdk packages/core-internal/src/shared/protocol.ts lines 112 and 135-140 at 1e608ca, via `gh api`, live, 2026-11-09). Which clients keep that default, and Claude Code's own limit, are not checked.
**Review:** none yet; a higher model reads the answer if it leads to a protocol change.
**Status:** open.
**Answer:** —

### R-15 — Which shell does Claude Code's Monitor tool run, and what `tool_name` does the guard get for it?

**Where:** v0.3 · S-57 · `src/guard.mjs` `preToolUse` (a `Monitor` call is read both as Bash and as PowerShell) · the guard
**Find out:** whether a Monitor command runs in Bash (Git Bash on Windows) or in PowerShell when the PowerShell tool is on, and whether a `Bash|PowerShell` PreToolUse hook receives it with `tool_name` `Monitor` or `Bash`. If it is always Bash, read it as Bash only: reading it both ways refuses a Monitor command such as `git commit -m "say \"hi\"; <read>"`, which Bash would not run (found by S-57's `/code-review`).
**Confidence:** 0.4 (low). The tools reference says only that Monitor "uses the same permission rules as Bash" and that on Windows the Bash tool uses Git Bash and the PowerShell tool PowerShell; it does not say which shell Monitor runs (code.claude.com/docs/en/tools-reference, live, 2026-11-10). R-12 read on the hooks page that a `Bash` matcher "also runs on shell commands Claude starts with the Monitor tool" and that "the hook gets a Bash call" (live, 2026-11-07).
**Review:** none yet; the S-57 senior review decides whether both ways stays until this is answered.
**Status:** open.
**Answer:** —
