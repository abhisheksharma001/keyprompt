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
**Fix step:** S-15 (PR #19), taken as the next step by id on "next", 2026-11-06. README, `package.json` and the GitHub description say what is true. Same overclaim, also fixed there: the README line "an agent can't be talked into revealing one" and quick-start step 4's "never sees the value". Still open and logged apart: B-10 (card footer) and B-11 (`--no-redact`).

### B-2 — `SECURITY.md` doesn't say plainly that the agent itself can read a saved key from the OS store

**Seen:** on macOS, keyprompt reads a saved key with `/usr/bin/security find-generic-password` and never gets a Keychain prompt (`src/store/macos.mjs:46-51`). The item was created by that same binary, which the Keychain trusts by default (`security add-generic-password -h`: "the application which creates an item is trusted to access its data without warning"). So any process running as you, including the agent's own shell, can read it with one command. `SECURITY.md` covers this only in general terms ("Malware or anything else running as you"). The skill forbids it (`skill/SKILL.md` rule 2), but nothing enforces that. Found 2026-11-05 while planning the mascot captions.
**Requirement:** invariant 9 in `.claude/CLAUDE.md`.
**Needs first:** nothing.
**Blocks:** nothing directly. The Claude Code guard hook (v0.3 candidate 2) would make it enforced inside Claude Code.
**Files:** `SECURITY.md`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 — keyprompt's own prompt-free read proves any caller of the same binary gets the same access; not separately run as an attack.
**Fix step:** S-15 (PR #19). `SECURITY.md` now says it in one plain line. The macOS claim was run on 2026-11-06 (a plain `security find-generic-password -w` read an item written the way keyprompt writes it, with no prompt); Linux and Windows use the same kind of prompt-free read (`secret-tool lookup`, `CredReadW`) and were not run.

### B-3 — A failed catalog write after a successful save makes the card say "Could not save"

**Seen:** in `askWithCard` (`src/cli.mjs`), `recordSavedMany` runs after `saveAll` has already written every value to the OS store. If writing `~/.keyprompt/catalog.json` then fails (disk full, a folder you cannot write to), the error is not a `KeypromptError`, so the card server shows "Could not save. Try again." (`src/card-server.mjs`, the 422 branch). That is not true: the values are saved; only the list of names is not updated, so `keyprompt list` leaves them out. It has been like this since v0.1 (`recordSaved` ran after `store.write` the same way); S-5 did not cause it. Found by reading the code on 2026-11-05 during the S-5 self-review; reproduced on macOS on 2026-11-07 in S-26 (below).
**Also found 2026-11-07, when it was reproduced** (`keyprompt set NAME` with a fake browser and a throwaway Keychain item, on main): (1) a `catalog.json` that is not JSON does the same as an unwritable folder, because `readCatalog` throws first, so the cause is any catalog failure, not only a write. (2) The agent was told something false too. The person gave up on the card that said "Could not save" and pressed Cancel, and `set` ended with exit 4 and "The person closed the secret card without saving", while `has NAME` exited 0. (3) A person who presses Save again gets the same answer every time, so the only way out is Cancel.
**Requirement:** invariant 9 in `.claude/CLAUDE.md`.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `src/cli.mjs` (`askWithCard`, and the new `saveAndRecord`); tests with a catalog that cannot be written and one that is not JSON.
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 that the card shows the wrong message — reproduced on 2026-11-07 (was 0.85 when only the code had been read).
**Fix step:** S-26 (PR #29). A catalog failure after a successful save no longer fails the submit: the card answers Saved, `set` and `run` carry on, and one line on stderr says "Saved X in the …, but could not update the list of names (CODE), so "keyprompt list" may not show it. The save itself worked. The list is …/catalog.json." A corrupt catalog is not repaired (every later save says the same until the file is fixed or removed). The sibling in `delete` is logged apart as B-13.

### B-4 — `run` cannot go on when every missing name is optional and the person leaves them all empty

**Seen:** `keyprompt run X:optional -- COMMAND` with X not saved opens a card with one optional box. Leaving it empty and pressing Save answers "Paste at least one value." (the S-4 rule, `readValues` in `src/card-server.mjs`), so the only ways out are to type something or Cancel (exit 4). Reproduced on 2026-11-05 during S-6 (headless Chromium, real macOS Keychain, a dummy name): the card stayed open and `run` ended with exit 4. The PRD says an empty optional box is "simply absent from the command's environment" (`docs/prd/card-v2.md`, Command line), which this prevents whenever optional boxes are the only kind on the card. `set` is not affected: saving nothing is rightly refused.
**Requirement:** the PRD line above.
**Needs first:** a decision from Abhishek: should an all-empty card be allowed for `run` when no box is required? If yes, the card request needs an option for it (the server checks "at least one value" today for every card). **Answered 2026-11-07** (Abhishek: "Run without it", D-7 in the PRD): yes, for `run` only. Found while asking: the card shows only the names that are not saved yet, so `run API_KEY,ORG_ID:optional` with `API_KEY` saved is such a card, and every later run opened it again.
**Blocks:** nothing now. S-10's agent instructions must not say that `:optional` lets the person skip a name until this is fixed.
**Files:** `src/card-server.mjs` (`readValues` and the request), `src/cli.mjs`, `test/card-server.test.mjs`.
**Research:** none · **Model:** opus — it changes a card server endpoint · **Confidence:** 0.9 that the gap is real (reproduced); 0.6 that "allow an empty submit" is the right fix, so a decision comes first.
**Fix step:** S-28 (PR #31). A `run` card takes Save with every box empty when every box is optional: the card ends "Left empty" with the new `skipped` pose, nothing is saved or listed, stderr says the command gets no value for those names from keyprompt, and `run` carries on to the command. `set` still answers "Paste at least one value.". Reproduced again first, on main, with a fake browser: the card answered 400 to an empty Save.

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
**Fix step:** S-7 (PR #9). On 2026-11-05 Abhishek chose to fix it inside S-7 rather than as its own step. `addCommand` refuses any command over 4,094 bytes before `security` runs, and `maxValueLength` is now 4,029, the most that fits even with a one-letter name.

### B-6 — Cancel or the 5-minute deadline during a save says "nothing was saved", but the save goes on

**Seen:** in `requestSecretWithCard` (`src/card-server.mjs`), `/cancel` and the deadline timer end the card at once, even while `onSubmit` is still saving. The save carries on and finishes. Reproduced on 2026-11-05 during S-9 with a scratch script: a fake 400 ms save and either a 200 ms deadline or a `/cancel` 100 ms into the save. No real store was used.
- **Deadline:** the card rejected with exit 5, "Nobody filled in the secret card in time (5 minutes).", and then the save finished and the page got `200 {"remembered":true}`, so it shows "Saved".
- **Cancel:** the card rejected with exit 4, "The person closed the secret card without saving.", and then the save finished.

The deadline is the real-world path. Someone presses Save near the end of the 5 minutes, and a macOS Keychain write (one `security` process per name, maybe behind a Keychain prompt) is still running when the timer fires. The agent is told nobody answered, but the key is stored. The page's own Cancel button is disabled during a save, so the Cancel case needs a request the page would not send. The code is the same on `main`; S-9 did not change it. S-9's new `/later` does wait: it answers 409 during a save.
**Requirement:** invariant 9 in `.claude/CLAUDE.md` (every word shown to people is literally true). Also PRD A5, whose "Cancelled. Nothing was saved." and "This card timed out. Nothing was saved." captions would be false in the same moment.
**Needs first:** nothing.
**Blocks:** S-14, which shows "This card timed out. Nothing was saved." at the deadline.
**Files:** `src/card-server.mjs`, `test/card-server.test.mjs`.
**Research:** none · **Model:** opus — it changes how the card server ends · **Confidence:** 0.95 that the gap is real (reproduced). The likely fix: a deadline or Cancel that lands during a save waits for that save, then reports what really happened. Confidence in that fix is 0.8.
**Fix step:** S-20 (PR #12), queued next by Abhishek on 2026-11-06. The deadline waits for the save; Cancel answers 409, as Later does. It also closes a gap of the same kind: a submit whose body was still arriving when the card ended was saved anyway.

### B-7 — After the deadline the card says "This card was already used"

**Seen:** once a card has ended, every POST gets `410 { error: 'This card was already used. Close this tab.', final: true }` (`src/card-server.mjs`, the `settled` checks), and the page shows it under the title "Closed". When the card ended at its deadline, nobody used it, so the sentence is false. Reproduced on 2026-11-06 during S-20: a card with a 100 ms deadline rejected with exit 5, then a submit got exactly that 410. The window is short: the server closes 500 ms after the card ends, and after that the page gets no answer and shows its own "request stopped waiting" text. It has been like this since before card v2; S-20 reuses the same text for a body that was still arriving. **Since S-12** the page answers any 410 with the buddy's `closed` pose and the PRD caption "This card was already used. You can close this tab.", so the buddy says the same false sentence in that window. **Since S-14** the page ends the card itself at zero ("Timed out", the `asleep` pose) and the form is gone, so a person can no longer press a button after the deadline. The false sentence now shows only when a request was already on its way as the server's timer fired (the answer is the 410), or from another tab of the same card. S-14 did not fix it: a bug is not fixed inside another step's PR.
**Requirement:** invariant 9 in `.claude/CLAUDE.md`; the `closed` row of the buddy table in `docs/prd/card-v2.md`.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `src/card-server.mjs`, `test/card-server.test.mjs`; the `closed` caption in src/buddy.mjs, the PRD table row and the 410 branch (`finishFinal`) in src/card-script.mjs.
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 — reproduced.
**Fix step:** S-21 (PR #18), queued next by Abhishek ("next") on 2026-11-06. The server's 410 now says "This card is no longer active. Close this tab." and the `closed` caption "This card is no longer active. You can close this tab.", which is true however the card ended (saved, cancelled, Later, timed out, or saved from another tab). The page's Cancel with no answer uses the same caption.

### B-8 — With "Remember" unticked, the buddy still puts the key in the vault

**Seen:** pressing Save with "Remember on this computer" unticked shows the `stashing` pose: the vault door open and the key carried towards it. Since S-13 the key also travels into the vault and disappears (600 ms). The caption says "Handing it over…" and the end says "Handed to this one command. Not saved.", so the words are true but the picture shows a save that does not happen. The PRD's replacement table changes only the caption for this case, not the pose. Found 2026-11-06 in S-13 while checking the motion frame by frame; the still pose has been like this since S-12.
**Requirement:** invariant 9 in `.claude/CLAUDE.md` in spirit (its letter covers words; this is the picture); the `stashing` row of the buddy table and the "Remember unticked" row of the replacement table in `docs/prd/card-v2.md`.
**Needs first:** Abhishek's choice of picture for waiting on a one-run Save. **Answered 2026-11-07:** a new `handing` pose.
**Blocks:** B-15 (the README's demo pictures are retaken once, after this).
**Files:** src/buddy.mjs (the pose and its motion), src/card-script.mjs (the mood set on Save), the two PRD tables, test/buddy.test.mjs.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 that the picture misleads (seen in the S-13 frames); whether it matters is Abhishek's call.
**Fix step:** S-31 (PR #34), as Abhishek chose ("New 'handing' pose", D-9). With Remember unticked, Save shows a new pose, `handing`: the penguin holds out an envelope and the vault stays shut, so the vault opens only for a real save. No new drawing: it reuses the envelope and the extended wing of `one-run`. The page also skips the wait for the key's trip into the vault, because none happens. The replacement table's `stashing` row for this case is gone, since the pose has its own caption.

### B-9 — The footer says "Stored in your {store}" on a card that stored nothing

**Seen:** `footerText` in `src/card-page.mjs` is "Stored in your {store} · never shown to your agent" on every real card. Only a demo, or the "Remember on this computer" box being unticked (`src/card-script.mjs`), changes it. When a card ends without a save (Cancelled, Later, Timed out, Closed), `finish()` leaves the footer alone, so under the caption "Cancelled. Nothing was saved." the footer still reads "Stored in your macOS Keychain". "Stored in" names where a Save would go; under an ended card that saved nothing it reads as a fact about that card. Found 2026-11-06 in S-21, looking at the `closed` card in Chrome (light and dark); S-14's timed-out card has the same footer and it was not noticed there. Not fixed in S-21: a bug is not fixed inside another step's PR.
**Requirement:** invariant 9 in `.claude/CLAUDE.md`. The PRD does not cover the footer's wording after a card ends.
**Needs first:** Abhishek's choice of wording for the footer once the card ended without a save (for example hide it, or "Nothing was stored"). **Answered 2026-11-06:** hide it.
**Blocks:** nothing.
**Files:** `src/card-script.mjs` (`finish`), `src/card-page.mjs` if the wording moves, `docs/prd/card-v2.md`, `test/card-script.test.mjs`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.8 that the words mislead (seen in the frames); the wording is Abhishek's call.
**Fix step:** S-23 (PR #20). Abhishek chose on 2026-11-06 ("Say only what is true"): after an ending that saved nothing (Cancelled, Later, timed out, no longer active, a final error) the card shows no footer at all. The first build hid only the note, and Chrome showed a hairline and an empty strip left behind, so the whole footer goes. A Save, a one-run Save and a demo's pretend save keep it. One test per ending in `test/card-script.test.mjs`. "Stored in your {store}" still shows before anything is saved, where it names the place a Save goes.

### B-10 — The card footer says "never shown to your agent"

**Seen:** every real card ends with "Stored in your {store} · never shown to your agent" (`src/card-page.mjs:83`), and a card with Remember unticked with "Held for this one command only · never shown to your agent" (`src/card-script.mjs:114`). `test/card-server.test.mjs:95` pins the first. keyprompt itself does not show the key to the agent, but a person reads this as "my agent cannot see it", and `SECURITY.md` says a command the agent writes can print a transformed copy, send the key, or (B-11) turn masking off. It is the same overclaim as B-1, on the card instead of the README. Found 2026-11-06 in S-15 while sweeping the repo for B-1's wording. Not fixed in S-15: its files are `README.md`, `package.json` and `SECURITY.md`, and a card change needs the PRD, the page and its tests.
**Requirement:** invariant 9 in `.claude/CLAUDE.md` ("Never 'your agent can never see it'"). A grep of `docs/prd/` for the phrase found none, so the PRD's footer text does not quote it.
**Needs first:** Abhishek's choice of wording. B-9 changes the same footer line, so ask both together and fix them in one step. **Answered 2026-11-06:** drop the clause.
**Blocks:** nothing.
**Files:** `src/card-page.mjs`, `src/card-script.mjs`, `test/card-server.test.mjs`, and `test/card-script.test.mjs` if the Remember-unticked footer is pinned there.
**Research:** none · **Model:** sonnet · **Confidence:** 0.65 that people read it as a guarantee (a judgment about readers, not seen); under 0.7, so nothing is built until Abhishek decides.
**Fix step:** S-23 (PR #20), with B-9. Abhishek chose to drop the clause on 2026-11-06. The footer reads "Stored in your {store}", and "Held for this one command only" with Remember unticked. A test fails on "never shown to your agent" anywhere under `src/` or in a card page. `README.md` line 10 still has the phrase in the alt text of the old screenshot docs/saved.png (removed in S-16); S-16 replaces that screenshot. **Done in S-16 (PR #22):** the screenshot is replaced and `README.md` no longer holds the phrase; a test checks that.

### B-11 — An agent can turn masking off with `run --no-redact` and read any saved key

**Seen:** reproduced on macOS on 2026-11-06 in S-15. A throwaway item was saved the way keyprompt saves (service `keyprompt`, an environment-style name), then `keyprompt run NAME -- printenv NAME` printed `[keyprompt:NAME]` and `keyprompt run NAME --no-redact -- printenv NAME` printed the value. `--no-redact` is in `HELP` (`src/cli.mjs`), the README and `skill/SKILL.md`; the skill tells the agent to use it only for full-screen terminal programs, and nothing enforces that. So one keyprompt command, typed by the agent without the person's say, shows it a saved key. It adds no new access (the agent can already read the OS store directly, B-2), but it breaks invariant 3 ("masking covers every value handed to `run`, whatever the agent said") and makes `HELP`'s "There is no command that prints a secret" (pinned by a test in `test/cli.test.mjs`) true only for keyprompt's own commands. S-15 now says so in `SECURITY.md` and the README; the flag itself is unchanged.
**Requirement:** invariant 3 in `.claude/CLAUDE.md`; invariant 1 in spirit.
**Needs first:** a decision from Abhishek (opus to lay out the options): (a) keep the flag and have the card say when masking is off, so the person sees it before pasting (the S-14 follow-up); (b) remove the flag, and mask full-screen programs another way; (c) keep it as documented in S-15. **Answered 2026-11-06: terminal only.** Opus laid out four options (terminal only; a card that asks each time; remove the flag; keep it) after checking that Claude Code's Bash tool gives a command no terminal, so there `--no-redact` cannot help a full-screen program and can only leak. Abhishek chose "Terminal only": `--no-redact` works only when keyprompt's stdout and stderr are both a terminal.
**Blocks:** a stronger README claim than the one S-15 makes; the "refuse a saved key pasted into a command" idea (S-19) is a separate step and does not cover this.
**Files:** `src/cli.mjs` (`parseArgs`, `HELP`, `run`), `src/card-page.mjs` if the card says so, `README.md`, `skill/SKILL.md`, `test/cli.test.mjs`, `test/run.test.mjs`.
**Research:** none · **Model:** opus for the decision, sonnet for the fix · **Confidence:** 0.95 that it happens (seen); the right answer is Abhishek's.
**Fix step:** S-24 (PR #23). From a pipe or a file, `run --no-redact` stops with exit 2 before reading a key, so an agent's shell tool can no longer turn masking off by accident. Not closed for an agent acting on purpose: one whose commands run in a real terminal, or one that starts keyprompt inside `script` (which makes a terminal, checked on macOS 2026-11-06), still can. That is the same kind of limit as B-2, and `SECURITY.md` says so.

### B-12 — `curl -v -u user:KEY` shows the key base64-encoded together with the username, and masking misses it

**Seen:** 2026-11-06 during S-18, on macOS with curl 8.7.1 against a local test server: `curl -v -u apiuser:dummy-not-a-key-123` prints `> Authorization: Basic YXBpdXNlcjpkdW1teS1ub3QtYS1rZXktMTIz`, the base64 of `apiuser:dummy-not-a-key-123`. S-18 masks the base64 of the value on its own, which matches here only when the text before the value is a multiple of 3 bytes long, because base64 works in 3-byte groups. With `ab:` the line became `YWI6[keyprompt:K]`; with `user:` and `apiuser:` nothing was masked. `SECURITY.md` names `curl -v` as an example of what masking is for, and APIs that take the key as a Basic-auth password (the key in `-u user:KEY`) are common.
**Also found 2026-11-06, while laying out the decision** (a scratch script against main's `createRedactor`, values of 18, 19 and 20 characters): text *after* the value breaks the match too, depending on the value's length. The base64 of `KEY:x` was missed for the 19-character value. `echo $KEY | base64` (the value then a line break) was masked for all three lengths, but only because a line break's first bits are zero, so the last character of the value's own base64 does not change.
**Requirement:** `SECURITY.md`, the row "A command echoing the key in its output (`curl -v`, …)". The PRD does not cover it beyond that.
**Needs first:** a decision on partial masking. The fix would also mask the base64 of the value shifted by 1 and 2 bytes, keeping only the characters that depend on the value alone. The character on each side of `[keyprompt:NAME]` can still mix in a few bits of the value's first or last byte, so a few bits would show (corrected in S-25: the first wording said "one or two characters"). Check how secret scanners handle this before choosing. `SECURITY.md` names the gap since S-18. **Answered 2026-11-06: shifted pieces.** Opus laid out three options: shifted pieces (what GitHub Actions does), decode every base64 run and look inside (what secret scanners do), or leave it as documented. Abhishek chose shifted pieces. The research is in S-25.
**Blocks:** nothing.
**Files:** `src/redact.mjs` (`copiesOf`), `test/redact.test.mjs`, `SECURITY.md`, `README.md`, `skill/SKILL.md`.
**Research:** lookup · **Model:** opus (the masking boundary) · **Confidence:** 0.95 that it happens (seen); 0.6 on the right fix until the partial-masking question is answered.
**Fix step:** S-25 (PR #28). For each of the three places a value can start in base64's 3-byte groups, `copiesOf` also masks the base64 and base64url characters made only of the value's bits. The character at each end that mixes in the text around it stays visible: at most 4 bits of the value's first byte and 4 of its last. Run on macOS with curl 8.7.1: main left the Basic line unmasked for keys of 19, 20 and 21 characters; S-25 masks all three.

### B-13 — `delete` removes the value, then fails and exits 1 if the list of names cannot be updated

**Seen:** 2026-11-07 while fixing B-3 (S-26), on macOS with a throwaway Keychain item and `KEYPROMPT_HOME` pointing at a plain file. `keyprompt delete NAME` removed the item from the Keychain (`has NAME` then exited 3), but printed `keyprompt: unexpected error: ENOTDIR: not a directory, open '…/catalog.json'` and exited 1, because `recordRemoved` (`src/catalog.mjs`) threw after `store.remove` had succeeded (`delete` in `src/cli.mjs`). The agent is told the delete failed when it worked. The same cause as B-3, in the other direction: the list of names is only a convenience, and its failure must not undo what the store already did. The message also repeats the raw error text, which `saveAndRecord` deliberately does not.
**Requirement:** invariant 9 in `.claude/CLAUDE.md`.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `src/cli.mjs` (`delete`, and the new `removeAndRecord`), `test/cli.test.mjs`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 that it happens (reproduced 2026-11-07, again before the fix in S-27).
**Fix step:** S-27 (PR #30). After `store.remove` has answered, a failed `recordRemoved` no longer changes the result: `delete` exits 0 (value deleted) or 3 (never saved) as before, prints its usual line, and one line on stderr says "Could not update the list of names (CODE), so "keyprompt list" may still show NAME. The list is …/catalog.json." The line says nothing about the value, because the name may never have been saved. A failing store still fails the delete and leaves the list alone. A corrupt catalog is not repaired. **Also changed:** a list that cannot be read used to end `delete` of a name that was never saved with exit 1 and a raw error; it now ends with exit 3 and "NAME was not saved." plus the line.

### B-14 — The Save button says "Save all N" when some boxes will be left empty

**Seen:** 2026-11-07 during S-28, in Chrome, on a `run` card with two optional boxes. The button read "Save all 2", and pressing it with both empty saved nothing (the card then said "Left empty. Nothing was saved."). The label comes from `renderCard` in `src/card-page.mjs` ("Save all N" for several fields, by count of boxes, not of filled ones). It is not new: since S-4 (one card, many fields), a card with optional boxes left empty saves fewer than N, for example "Save all 3" saving one. S-28 only makes the all-empty case reachable. The done screen and the receipt are true; only the button overstates.
**Requirement:** invariant 9 in `.claude/CLAUDE.md` (the button is a word shown to people); the PRD layout sketch shows "Save all 3" on a card with an optional box.
**Needs first:** Abhishek's choice of label, for example "Save" whenever a card has an optional box, or a count of the filled boxes that changes as the person types.
**Blocks:** nothing.
**Files:** `src/card-page.mjs` (the label), maybe `src/card-script.mjs` (a live count), the PRD sketch, `test/card-server.test.mjs`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 that the label overstates (seen); how much it matters is Abhishek's call.
**Fix step:** S-30 (PR #33), as Abhishek chose (D-8, 2026-11-07: "Plain 'Save' if any box optional"). A card with any optional box now says plain "Save"; a card where every box must be filled keeps "Save all N" (several boxes) and "Save securely" (one box). `renderCard` in `src/card-page.mjs` decides, and the PRD sketch says `[Save]`. A lone optional box says "Save" too, because on `run` it may be left empty. Chosen over a live count ("Save 1 of 3") and over a plain "Save" on every card. Still open and logged apart: B-15 (the README's demo pictures show the old button).

### B-15 — The README's two demo pictures show the old "Save all 3" button

**Seen:** 2026-11-07 in S-30. `README.md` (lines 15 and 17) links two pictures pinned to an older commit, `docs/demo-card.png` and `docs/demo-finished.png`, and their alt text says "the buttons Later, Cancel and Save all 3" and "after pressing Save all 3". The demo card has an optional box (`DEMO_PRIVATE_KEY:multiline:optional`), so since S-30 `keyprompt demo` says "Save", as the headless-browser look in S-30 showed in light and dark. The pictures are true of the older card; they no longer match what the demo shows.
**Requirement:** invariant 9 in `.claude/CLAUDE.md` in spirit (the alt text and pictures are shown to people); the README's own comment says that after changing a picture both links point at the commit that has the new one.
**Needs first:** S-30 and S-31 (B-8) merged, so the pictures are retaken once, after both changes to the demo card. The new pictures must be in a commit before the links can point at it, so this is a two-step docs change (commit the pictures, then update the links in a later commit).
**Blocks:** nothing hard; best done before the next release.
**Files:** `docs/demo-card.png`, `docs/demo-finished.png`, `README.md` (two links, two alt texts).
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 that the pictures no longer match the demo card (seen in S-30); how much it matters before the next release is Abhishek's call.
**Fix step:** S-32 (PR #35). Both pictures retaken once, after S-30 and S-31, from the real `keyprompt demo` (button "Save", 13 poses in the pose row; the old ones showed "Save all 3" and 11). The README links pin the commit that adds them, which is a commit on the PR's branch and not on main (the repo squash-merges), and the descriptions say "Save" and "pressing Save". A new test in `test/cli.test.mjs` holds the descriptions to the buttons the demo card renders, so the words cannot drift again; the pictures themselves still can, because no test can read a picture. Found later and logged apart: B-16 (that pin is not on main), fixed by S-33 (PR #36), which moved both links to 82deb12, a commit on main.

### B-16 — The README's picture links pin a commit that is not on main

**Seen:** 2026-11-07, while preparing the 0.2.2 release, with `git merge-base --is-ancestor` (it said the pin is not an ancestor of origin/main). `README.md` (lines 15 and 17) pins both pictures to 5ae0db8, a commit on PR #35's branch. The repo squash-merges, so only the squash commit 82deb12 is on main. The raw links still load because GitHub keeps the pull request's ref (refs/pull/35/head): checked live on 2026-11-07, after the branch was deleted. That rests on two secondary sources (medium confidence), and the README ships inside the npm package, which cannot be edited after it is published: a link that stopped loading would stay broken on that version's npm page.
**Requirement:** the README's own comment and S-17 (the npm page shows the pictures). The PRD does not cover it.
**Needs first:** nothing. 82deb12 is on main and holds the same two files byte for byte as 5ae0db8: the git blobs match, and the SHA-256 of what GitHub serves matches the local files.
**Blocks:** the 0.2.2 release (S-34), because the pin goes into a package that cannot be changed afterwards.
**Files:** `README.md` (two links, and the comment above them).
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 that the pin is not on main (git says so) and that 82deb12 serves the same bytes (read live on 2026-11-07).
**Fix step:** S-33 (PR #36). Both links point at 82deb12, a commit on main. The comment above them now says to merge a picture first and then pin to a commit on main, because with squash merges a commit on the picture's own branch is not on main. No test can say a commit is on main (CI clones shallow), so it is checked by command and recorded in the step.

### B-17 — The S-29 register row says its tag and GitHub release come "after the merge", though both exist

**Seen:** 2026-11-07, while preparing the 0.2.2 release (S-33 noted it and left it for its own step). The S-29 status row in `docs/steps.md` ended "**After the merge:** tag `v0.2.1` on the squash commit once `npm pack` there gives the same shasum, then the GitHub release; both need Abhishek's go." Both were done: the annotated tag v0.2.1 is on 9705e21, the S-29 squash commit (`git for-each-ref refs/tags/v0.2.1`, read 2026-11-07), and the release "keyprompt 0.2.1" exists (created 2026-11-06 21:13:54 UTC; `gh release view v0.2.1`). The row was written before them and never updated, so a reader of the register would think 0.2.1 has no tag or release.
**Requirement:** the standard's rule that a wrong claim is corrected in the place it was made. The PRD does not cover it.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `docs/steps.md` (the S-29 row, and the S-33 row's note about it).
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 that the row is stale (tag, release and the published shasum were all read from the system).
**Fix step:** S-35 (PR #38). The S-29 row's last sentence now says where the tag is (9705e21, whose message holds the shasum; `npm pack` at that commit gives it again, read 2026-11-07) and that the release exists. The S-29 entry further down keeps the plan as it was written. A register row that waits on an owner act (a tag, a release) names the act in words that stay true after it is done, as the S-34 row does.

### B-18 — Three backticked names in the docs are not paths in this repo

**Seen:** 2026-11-07, by a path check run while reviewing the v0.3 PRD (S-37): every backticked token that looks like a path, tested with `[ -e ]` from the repo root. Three on main fail it, each written in backticks there (and in plain text here, so this entry does not repeat the bug): backend/src/ee/LICENSE.md in `docs/research.md` (a path in Infisical's repository, R-5's answer), card-script.mjs in `docs/steps.md` (the note in S-12; the file is `src/card-script.mjs`), and a bare catalog.json in `docs/steps.md` (seven times; the file is `~/.keyprompt/catalog.json`, outside the repo). The project rule in `.claude/CLAUDE.md` says a backticked path inside this repo must exist, and paths in other repos are written in plain text. No automated check enforces it yet.
**Requirement:** the docs rule in `.claude/CLAUDE.md` ("In docs, a backticked path inside this repo must exist"). The PRD does not cover it.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `docs/research.md`, `docs/steps.md`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 that these three are the only ones (the check matches tokens shaped like a/b/c or name.ext; a bare word without an extension is not tested).
**Fix step:** not planned yet. The fix writes the Infisical path in plain text, card-script.mjs as `src/card-script.mjs`, and the bare catalog.json as `~/.keyprompt/catalog.json` or plain text.

### B-19 — A `--json` failure does not say why it failed

**Seen:** 2026-11-09, running main at 87611bb (S-41, PR #44) in a scratch home. `keyprompt has A_KEY --json` on a system with no password store printed `{"command":"has","status":"error","names":["A_KEY"],"exitCode":1}` and nothing on stderr; without `--json` the same command says why ("keyprompt does not support freebsd yet ..."). `keyprompt list --json --bogus` printed only `"status":"invalid_usage"`. So an agent cannot tell "no desktop to open the card" from "the store failed", and cannot follow keyprompt's advice on what to do next. Running again without `--json` to read the reason reopens the card for `set`. S-41 left the message out on purpose, because some messages repeat text keyprompt did not write: a typed argument (an unknown option, an unknown hint, an invalid name, which could be a pasted key) or the first line of a store helper's error on Linux and Windows. Two sessions worked on S-41 at once: one built and merged PR #44, while a grill in a second session, which #44 never saw, had chosen to include the message (Abhishek, 2026-11-07: "JSON error on stdout").
**Requirement:** J in `docs/prd/v0-3.md`, and the convention in `.claude/CLAUDE.md` that an error says what to do next.
**Needs first:** nothing.
**Blocks:** S-48, the `--json` docs (README and skill examples).
**Files:** `src/errors.mjs`, `src/cli.mjs`, `src/names.mjs`, `src/save.mjs`, `src/store/linux.mjs`, `src/store/windows.mjs`, `test/cli.test.mjs`, `test/save.test.mjs`, a new `test/errors.test.mjs`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 that this is the cause (the code drops the message in `jsonFailure`, and the run above shows it).
**Fix step:** S-47.

### B-20 — `request_secret` with only blank fields opens an empty card that says "Replace secret"

**Seen:** 2026-11-09, by the senior review of S-45 (a fresh Opus session; mystandard 14a, run after the merge). `request_secret` with `fields: [" "]` passed `toolList` (one string) but `parseFields` drops blank items, so the list became empty and nothing stopped it: a card opened with no boxes, titled "Replace secret" because `[].every(...)` is true, and saying a value is already saved. stderr said "opened a secure card ... for ." and the activity log got a line with no names. `check_secrets` with `names: [","]` answered `status: "saved"` naming nothing. `keyprompt set` has its own empty check; the MCP tools did not.
**Requirement:** M in `docs/prd/v0-3.md`, and invariant 9 (every word shown is true).
**Needs first:** nothing.
**Blocks:** S-46.
**Files:** `src/cli.mjs`; a new test file.
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 that this is the cause (`src/cli.mjs` `mcpTools`: no empty check after `parseFields`; reproduced by the reviewer).
**Introduced by:** PR #51, 0edd234.
**Escaped past:** the step's acceptance and tests: they covered an invalid name but not a list that parses to nothing.
**New check:** test/b20-empty-fields.test.mjs (fails on the introducing sha: yes, shown by its own commit before the fix).
**Fix step:** S-51.

### B-21 — A cancelled `request_secret` leaves its card open, and closing stdin does not close it

**Seen:** 2026-11-09, senior review of S-45. After `notifications/cancelled` for an open `request_secret`, the card stays open for up to 5 minutes and keeps the one-card lock, so the next `request_secret` is refused with "Wait for its answer", an answer that never comes, because a cancelled request is never answered. If the person then saves, the value is saved and logged while the agent was told the call failed. Clients built on the MCP TypeScript SDK cancel a request after 60 seconds by default (`DEFAULT_REQUEST_TIMEOUT_MSEC = 60_000`, typescript-sdk packages/core-internal/src/shared/protocol.ts:112 at 1e608ca, read live by the reviewer 2026-11-09). The same open card keeps `keyprompt mcp` alive after its stdin closes, though the stdio binding says a server SHOULD exit promptly then.
**Requirement:** M in `docs/prd/v0-3.md`.
**Needs first:** nothing.
**Blocks:** S-46.
**Files:** `src/card-server.mjs` (an abort signal), `src/mcp.mjs`, `src/cli.mjs`; a new test file. `src/card-server.mjs` is security-sensitive (invariant 4).
**Research:** none · **Model:** opus · **Confidence:** 0.9 that this is the cause (no path from a cancel or end of input to the card server; reproduced by the reviewer).
**Introduced by:** PR #51, 0edd234.
**Escaped past:** the grill and the acceptance: "wait, like set" was chosen without asking what a client's cancel or timeout should do.
**New check:** test/b21-cancel-closes-card.test.mjs (fails on the introducing sha: yes, by its own commit before the fix).
**Fix step:** S-52.

### B-22 — `keyprompt mcp` claims 2025-03-26 but refuses its batches, and reads a whole over-long line into memory

**Seen:** 2026-11-09, senior review of S-45. (1) 2025-03-26 is in `PROTOCOL_VERSIONS`, and that version says implementations "MUST support receiving JSON-RPC batches" (modelcontextprotocol.io/specification/2025-03-26/basic, read live by the reviewer 2026-11-09); a batch gets -32600. (2) `readline` holds a whole line before the 1 MB check, so a line with no newline can still fill memory, though the PRD says a line over 1 MB "is not read". (3) The set of cancelled ids never shrinks. A fourth point, that `tools/call` is answered before `initialize`, is not changed: the 2025-11-25 lifecycle asks this only of clients ("SHOULD NOT"), a client that speaks 2026-07-28 probes with `server/discover` first and our -32601 makes it fall back, and the locked S-45 tests send `tools/call` without `initialize`.
**Requirement:** M in `docs/prd/v0-3.md`, and the PRD's "MCP server (S-45)" wording.
**Needs first:** nothing.
**Blocks:** S-46.
**Files:** `src/mcp.mjs`; a new test file.
**Research:** none (the reviewer read the 2025-03-26 page live) · **Model:** sonnet · **Confidence:** 0.9.
**Introduced by:** PR #51, 0edd234.
**Escaped past:** the review of the spec: only the 2025-11-25 schema was read for the version list.
**New check:** test/b22-mcp-protocol.test.mjs (fails on the introducing sha: yes, by its own commit before the fix).
**Fix step:** S-53.

### B-23 — The activity log loses lines when keyprompt runs in parallel, prints terminal escape codes, and may leave temp files

**Seen:** 2026-11-09, senior review of S-43. (1) Once the file holds 1,000 lines, every write rewrites it, so writers race on every write: with the file at 1,000 lines and 20 processes writing at once, 9 of the 20 new lines were lost, while the PRD says two processes "can lose one line". (2) `keyprompt log` prints `folder` and `program` raw, so a folder named with terminal escape codes (ESC[1A ESC[2K) can rewrite earlier lines of the person's view. (3) If `rename` fails (EPERM on Windows while another process has the file open), `activity.jsonl.<pid>.tmp` is left behind (PLAUSIBLE, not run).
**Requirement:** L in `docs/prd/v0-3.md`, and invariant 9 for the PRD's wording.
**Needs first:** nothing.
**Blocks:** S-46.
**Files:** `src/activity.mjs`; a new test file.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 for (1) and (2), reproduced by the reviewer; 0.6 for (3), which was not run.
**Introduced by:** PR #48, 12b9e7b.
**Escaped past:** the step's tests: the trim was tested with one writer, and the report only with plain folder names.
**New check:** test/b23-activity-log.test.mjs (fails on the introducing sha: yes, by its own commit before the fix).
**Fix step:** S-54.

### B-24 — `SECURITY.md` says nothing about the activity log or `keyprompt mcp`

**Seen:** 2026-11-09, senior review of S-43 and S-45. `SECURITY.md` does not say that the activity log can be edited by anything running as the person, that its folder paths can name a client or project, that a `run` line is written only when the command ends (a keyprompt killed with SIGKILL leaves none), or that the card's "who is asking" for an MCP client is that client's own claim, as with `--by`.
**Requirement:** invariant 9 ("Limits belong in `SECURITY.md`").
**Needs first:** B-21 and B-23 fixed, so the limits describe the code that ships.
**Blocks:** S-46.
**Files:** `SECURITY.md`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.95.
**Introduced by:** PR #48 (12b9e7b) and PR #51 (0edd234).
**Escaped past:** the docs steps S-49 and S-50, whose files did not include `SECURITY.md`.
**New check:** none possible as a test of meaning; S-55's Verify greps `SECURITY.md` for each limit.
**Fix step:** S-55.
