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

### R-6 — Could keyprompt plug into any MCP agent through "URL mode elicitation"?

**Where:** later (parked) · a possible future `keyprompt mcp` server
**Find out:** which agent clients implement URL mode, and whether a keyprompt MCP server could hand them the card URL that way.
**Confidence:** 0.8 (medium) for the spec side and Claude Code.
- **Spec:** the MCP spec (version 2026-07-28, client/elicitation) says servers MUST NOT use form mode for passwords or API keys and MUST use URL mode. URL mode sends the person to a separate page whose data never passes through the client (modelcontextprotocol.io/specification/2026-07-28/client/elicitation, read 2026-11-05). That describes keyprompt's card.
- **Clients:**
  - Claude Code 2.1.287: "Added URL prompts from MCP servers on the 2025-11-25 protocol". It asks the person, then opens the URL in the browser (CHANGELOG via `gh`, live, and code.claude.com/docs/en/mcp, live, both 2026-11-05).
  - VS Code's source declares URL mode support (live).
  - Codex and Cursor: unconfirmed.
**Review:** higher model before any build.
**Status:** open — parked.
**Answer:** —

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

- **It is real, and small.** The npm record (`npm view @trevorbyrum/keymask`, registry https://registry.npmjs.org/@trevorbyrum/keymask, 05:16 IST) shows one version line: 0.2.0 is `latest`, created 2026-05-23, last modified 2026-05-28, one maintainer, license "MIT AND OFL-1.1", 46 files, tarball shasum 8c9dd930aaa2fd8bdc898463c8d2479f4ab4dca6. I downloaded that tarball into a new folder and read it; I did not run it.
- **Its source is not public.** The package says its repository is github.com/trevorbyrum/keymask. That address answers 404 without a login (curl, https://github.com/trevorbyrum/keymask, 05:16 IST), `gh api repos/trevorbyrum/keymask` answers 404, and the author's 11 public repositories (`gh api users/trevorbyrum/repos`, same time) do not include it. Its README still tells people to `git clone` that address and shows a CI badge for it. The last publish is about 5 months before this check; I cannot see commits, so I cannot say more about upkeep.
- **What it is.** An MCP server (README in the tarball): eight tools, registered in the agent's config by file path, Node 22 or later. `request_secret` opens a form on the local machine; `run_with_secrets` runs a command and scrubs values from its output. Destinations: a project `.env` file (the default), the OS stores (macOS Keychain, Linux libsecret, Windows Credential Manager), HashiCorp Vault, and SSH hosts.
- **How far its form goes.** One request takes one or two fields at most (the input check in dist/tools/request.js says "max 2 fields"); a field has a name, an optional label and an optional description, with no hints for a visible, multi-line or optional box. The page (dist/ui/form.html, about 21 KB) has light and dark colours, bundled Inter font files, a Show control and a Submit button; a search of the page for "later", "receipt", "penguin", "mascot" and "svg" finds none. The form's token is 128 bits (`randomBytes(16)`, dist/ui/server.js line 56).
- **Its masking is exact-match.** The comment at the top of dist/scrubber.js says a value transformed by the agent or the command (base64, hex, chunked, JSON-encoded) is not matched. keyprompt has masked the base64, base64url, lowercase hex, URL-encoded and JSON-escaped forms of a value of 8 or more characters since 0.2.1 (S-18, S-25), not chunked ones.
- **Where it does more than keyprompt:** Vault, SSH hosts and writing a `.env` file, and being an MCP tool (keyprompt's MCP server is a v0.3 idea, R-6). **Where keyprompt does more:** up to 12 fields per card with visible, multi-line and optional hints; a Later button; a receipt; a deadline clock; encoded-copy masking; an install with `npm install -g keyprompt` on Node 18.17 or later and no MCP server to register; and saved values go to the OS password store, not to a file.
- **What this changes.** The edge in the PRD stays as written: keymask is the closest rival for "the agent asks, a local form opens, the value lands in a store", and the difference is the part above. The PRD's two lines about keymask now say what is known (S-36). The README needs no change, because it compares nothing.
- **Not done:** the form was not rendered in a browser, and the Windows and Linux paths of keymask were not read in detail.
