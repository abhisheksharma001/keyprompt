# Bug log

A bug is written here first, then into the plan, then fixed as its own step. Format: `~/.claude/skills/mystandard/SKILL.md` section 5.

---

### B-1 — The headline promises more than the product does

**Seen:** the GitHub repo description says "agents use it without seeing it". `README.md` line 5 says "The agent then uses the key without ever seeing it", and its "Why" list says "Agents use keys, not see them." `package.json` says "agents use it without ever seeing it". But `SECURITY.md` ("What it does not protect against") is correct that a command the agent writes can print a transformed copy (base64, part of the value) or send the key somewhere. So the headline claims more than the code does. Found 2026-11-05, raised by outside product review and confirmed by reading the files.
**Requirement:** invariant 9 in `.claude/CLAUDE.md` (every word shown to people is literally true).
**Needs first:** nothing.
**Blocks:** any public announcement or npm publish (S-17).
**Files:** `README.md`, `package.json`, the GitHub repo description (changed with `gh repo edit`, which is public, so Abhishek says yes first).
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 that this is a real overclaim — the files were read and compared on 2026-11-05.
**Fix step:** S-15.

### B-2 — `SECURITY.md` doesn't say plainly that the agent itself can read a saved key from the OS store

**Seen:** on macOS, keyprompt reads a saved key with `/usr/bin/security find-generic-password` and never gets a Keychain prompt (`src/store/macos.mjs:46-51`). The item was created by that same binary, which the Keychain trusts by default (`security add-generic-password -h`: "the application which creates an item is trusted to access its data without warning"). So any process running as you, including the agent's own shell, can read it with one command. `SECURITY.md` covers this only in general terms ("Malware or anything else running as you"). The skill forbids it (`skill/SKILL.md` rule 2), but nothing enforces that. Found 2026-11-05 while planning the mascot captions.
**Requirement:** invariant 9 in `.claude/CLAUDE.md`.
**Needs first:** nothing.
**Blocks:** nothing directly. The Claude Code guard hook (v0.3 candidate 2) would make it enforced inside Claude Code.
**Files:** `SECURITY.md`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 — keyprompt's own prompt-free read proves any caller of the same binary gets the same access; not separately run as an attack.
**Fix step:** S-15 (one plain sentence in `SECURITY.md`).

### B-3 — A failed catalog write after a successful save makes the card say "Could not save"

**Seen:** in `askWithCard` (`src/cli.mjs`), `recordSavedMany` runs after `saveAll` has already written every value to the OS store. If writing `~/.keyprompt/catalog.json` then fails (disk full, a folder you cannot write to), the error is not a `KeypromptError`, so the card server shows "Could not save. Try again." (`src/card-server.mjs`, the 422 branch). That is not true: the values are saved; only the list of names is not updated, so `keyprompt list` leaves them out. It has been like this since v0.1 (`recordSaved` ran after `store.write` the same way); S-5 did not cause it. Not reproduced; found by reading the code on 2026-11-05 during the S-5 self-review.
**Requirement:** invariant 9 in `.claude/CLAUDE.md`.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `src/cli.mjs` (only `askWithCard`); a test with a catalog folder that cannot be written.
**Research:** none · **Model:** sonnet · **Confidence:** 0.85 that the card shows the wrong message — the code path was read, not run.
**Fix step:** not queued yet. Proposed: a catalog failure after a successful save does not fail the submit; the CLI writes one line to stderr instead ("Saved, but could not update the list of names: …").

### B-4 — `run` cannot go on when every missing name is optional and the person leaves them all empty

**Seen:** `keyprompt run X:optional -- COMMAND` with X not saved opens a card with one optional box. Leaving it empty and pressing Save answers "Paste at least one value." (the S-4 rule, `readValues` in `src/card-server.mjs`), so the only ways out are to type something or Cancel (exit 4). Reproduced on 2026-11-05 during S-6 (headless Chromium, real macOS Keychain, a dummy name): the card stayed open and `run` ended with exit 4. The PRD says an empty optional box is "simply absent from the command's environment" (`docs/prd/card-v2.md`, Command line), which this prevents whenever optional boxes are the only kind on the card. `set` is not affected: saving nothing is rightly refused.
**Requirement:** the PRD line above.
**Needs first:** a decision from Abhishek: should an all-empty card be allowed for `run` when no box is required? If yes, the card request needs an option for it (the server checks "at least one value" today for every card).
**Blocks:** nothing now. S-10's agent instructions must not say that `:optional` lets the person skip a name until this is fixed.
**Files:** `src/card-server.mjs` (`readValues` and the request), `src/cli.mjs`, `test/card-server.test.mjs`.
**Research:** none · **Model:** opus — it changes a card server endpoint · **Confidence:** 0.9 that the gap is real (reproduced); 0.6 that "allow an empty submit" is the right fix, so a decision comes first.
**Fix step:** not queued yet.

### B-5 — On macOS, the tail of a value longer than about 4,000 bytes runs as a separate `security` command

**Seen:** the macOS store saves a value by sending one line, `add-generic-password … -w "<value>"`, to `security -i` on stdin. `security -i` reads at most 4,095 bytes of a line and runs whatever follows as the next command. The evidence is Apple's source: a 4,096-byte buffer, `MAX_LINE_LEN` in SecurityTool/macOS/security.c and the loop in SecurityTool/macOS/readline.c, in apple-oss-distributions/Security at db15acbe6a7f (Security-61901.0.87.0.1), read via `gh api`, live, 2026-11-05.
Reproduced on 2026-11-05 on macOS 27.0 with main's own `write` and dummy names:
- A 4,072-character one-line value ended with `add-generic-password -s keyprompt -a KP_TRY_R1_PROOF -w proof`, and that second item was created.
- `write` then failed its read-back check ("Could not save …"), and the first item held a cut-off value.

So two things were wrong:
1. Text past the cut in a pasted value runs as you, as any `security` subcommand. A crafted value could delete or change other Keychain items.
2. `maxValueLength` promised 65,536 characters, but nothing over about 4,000 could be saved, and the card said "Could not save" instead of "too long".

S-5's `saveAll` puts the cut-off value back, so problem 2 left no damage; nothing undoes problem 1. Both have been there since v0.1. Both dummy items were deleted after the test.
**Requirement:** invariant 9 in `.claude/CLAUDE.md` (the 65,536 limit on the card was not true). The threat model in `SECURITY.md` does not cover running a value's text as a command; the PRD does not cover it.
**Needs first:** nothing.
**Blocks:** S-7 — its hex form doubles a value's length on that line, so it needs the same check.
**Files:** `src/store/macos.mjs`, `test/macos-parse.test.mjs`, `test/store.integration.test.mjs`.
**Research:** lookup (done, above) · **Model:** opus — it writes to the password store · **Confidence:** 0.95 — reproduced on the real Keychain and matched to Apple's source.
**Fix step:** S-7 (PR #?). On 2026-11-05 Abhishek chose to fix it inside S-7 rather than as its own step. `addCommand` refuses any command over 4,094 bytes before `security` runs, and `maxValueLength` is now 4,029, the most that fits even with a one-letter name.
