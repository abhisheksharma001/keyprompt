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

### B-25 — The guard lets plain forms of a direct read through

**Seen:** 2026-11-09, by the v0.3 feature-end audit (S-56, `docs/audits/v0-3-feature-end.md`), re-run through `node bin/keyprompt.mjs guard pre-tool-use` at 23:50 IST. Each of these printed nothing and exited 0, so Claude Code would run it: `timeout 5 secret-tool lookup service keyprompt account X`; `nice -n 10 security find-generic-password -s keyprompt -w`; `env -u FOO security …`; `security \` plus a line break plus `find-generic-password -s keyprompt -w`; `security find-generic-password -skeyprompt -w`; `keyprompt list | xargs -I{} security find-generic-password -s keyprompt -a {} -w`; in PowerShell, `Set-Location "C:\proj\"; Get-StoredCredential -Target keyprompt:X` and `CredentialManager\Get-StoredCredential -Target keyprompt:X`. The plain read was denied in the same run. Found by the PR's `/code-review` and re-run 2026-11-10: `stdbuf -oL security find-generic-password -s keyprompt -w` and `security find-generic-password -wskeyprompt` pass too. Causes: `timeout`, `xargs` and `stdbuf` are not in `WRAPPERS` (`src/guard.mjs:25`), and no list of wrappers can be complete (`env -S`, `setsid`, `flock`, `find -exec`); only `sudo` and `doas` options that take a value are skipped (`src/guard.mjs:192`); option values are matched only as separate words, not getopt-style clusters; `splitShell` (`src/guard.mjs:47-135`) keeps a backslash-newline inside the next word and reads PowerShell text with POSIX escapes, so `\"` becomes an escaped quote and `CredentialManager\Get-StoredCredential` loses its backslash, leaving no separator for the module prefix to be cut at (`CredentialManager/Get-StoredCredential` is already denied).
**Requirement:** G1 in `docs/prd/v0-3.md`.
**Needs first:** nothing.
**Blocks:** B-27 (the docs can only be made true once the refused forms are settled).
**Files:** `src/guard.mjs`; a new test file.
**Research:** lookup (PowerShell's escape character, from Microsoft's about_Quoting_Rules page, read live; `security`'s option parsing, from its man page) · **Model:** opus · **Confidence:** 0.95 that these forms pass (re-run); 0.75 on the fix S-57 names (find the read anywhere among a command's words unless that command only prints text), because it trades a wrapper list for a list of text-only commands.
**Introduced by:** PR #41, bc20dbe (S-38).
**Escaped past:** the step's tests: they covered the forms R-12 listed and `sudo -u`, not wrappers whose options take a value, line continuations, attached option values or PowerShell's own quoting.
**New check:** `test/b25-guard-plain-forms.test.mjs`, one case per form above (fails on main: yes, by its own commit before the fix).
**Fix step:** S-57.

### B-26 — The guard refuses a commit message written with a here-document

**Seen:** 2026-11-09, S-56 audit, re-run at 23:50 IST. `git commit -m "$(cat <<'EOF'` / a line quoting `security find-generic-password -s keyprompt -w` in backticks / `EOF` / `)"` is denied, and so is a here-document line that starts with the read, and `gh pr create --body "$(cat <<'EOF' …)"`. A plain `git commit -m "…"` with the same words passes. Cause: `splitShell` (`src/guard.mjs:75-191` after S-57; 47-135 when seen) does not know here-documents, so it parses the body as shell; backticks inside a quoted (`'EOF'`) body, which bash leaves as text, become a command. `README.md:285` already says the guard can refuse "a `cat <<EOF` block written to a file", but G1b names commit messages, and this repo's own commit messages quote these reads. Also seen, rarer: the CredRead rule matches anywhere in the text (`src/guard.mjs:386-391` after S-57; 243-248 when seen), so `Select-String -Pattern 'CredRead'` next to `Add-Type` and a `keyprompt:` string is refused, and a `#` comment is parsed as a command. **Wider since S-57** (2026-11-10): the guard now looks for a read anywhere in a command's words, so a here-document line that mentions a read in the middle (`- refuses security find-generic-password -s keyprompt -w`, no backticks) is refused too, where main let it through; S-57 reads `#` comments. Do not release between S-57 and S-58.
**Requirement:** G1b in `docs/prd/v0-3.md`.
**Needs first:** S-57 (same file).
**Blocks:** B-27.
**Files:** `src/guard.mjs`; a new test file.
**Research:** none (bash's here-document rules: a quoted delimiter leaves the body as text; an unquoted one still runs `$( )` and backticks, which must stay refused) · **Model:** opus · **Confidence:** 0.95 that it happens (re-run); 0.8 on the fix. The PR's `/code-review` showed a trap: a here-document fed to a shell (`bash <<'EOF'` with a read in its body) is denied today only because of this same blindness (re-run 2026-11-10), so the fix may treat a body as text only when the command it feeds just prints or stores it.
**Introduced by:** PR #41, bc20dbe (S-38).
**Escaped past:** the step's tests: the commit-message case was tested only as `-m "…"`.
**New check:** test/b26-guard-heredoc.test.mjs: a quoted-delimiter body fed to `cat` passes; an unquoted body with a backtick read is still denied; a body fed to `bash`, `sh`, `zsh`, `pwsh`, `python`, `node` or `eval`, with either delimiter, is still denied (must fail on main before the fix).
**Tried:** S-58 (PR #62, closed unmerged 2026-11-10) taught `splitShell` here-documents. Its `/code-review` found six bypasses in a design that counted groups (`time {`, `! {`, a `case` pattern's `)`, a quoted `'}'`, `exec` not first, a redefined `git`, zsh's `hash cat=`) and two quadratic paths; the senior review of the redesign (https://github.com/abhisheksharma001/keyprompt/pull/62#issuecomment-6763649423) found eight blockers, among them `cat<<EOF` glued to its word, bash 3.2 ending `$( )` at a `)` inside the body, `<<-` stripping tabs per continued piece, zsh's `${(e):-…}`, a quadratic backslash run, and `PATH=` or `BASH_FUNC_cat%%=` changing what `cat` runs. Each was a read bash or zsh ran that main refuses.
**Decision:** D-24: the guard does not learn here-documents; the refusal is kept and explained.
**Fix step:** S-65 (words).

### B-27 — `SECURITY.md` and the README say the guard refuses more than it does

**Seen:** 2026-11-09, S-56 audit. `SECURITY.md:19` and `README.md:280` say the guard refuses "a Bash or PowerShell command that runs the store's own read tool on a keyprompt item", and the limits they list (`SECURITY.md:20`, `README.md:285`) name only a script file, an encoded command and another tool. The B-25 forms run the store's read tool on a keyprompt item and are none of those, so the sentence is not literally true. Nor are two forms the audit does not count against G1 (the PRD's "Honest limits" allow them) but that pass the guard: a read built from a shell variable (`S=keyprompt; security find-generic-password -s $S -w`, re-run 2026-11-10) and text piped into a shell (`echo "<read>" | bash`). S-57 found a third (re-run 2026-11-10 on its branch): a read inside one quoted string that a command other than a shell or `eval` runs, as `env -S "<read>"`, `watch "<read>"`, `ssh host "<read>"`, `git rebase --exec "<read>"`, PowerShell's `Invoke-Expression "<read>"` and `cmd /c "<read>"` do. S-57's senior review found a fourth (checked with `echo` on zsh 5.9; bash 3.2 rejects the name, bash 5 not checked): zsh's `printf -v 'a[$(<read>)]' x` runs the command substitution inside the name it is given, and that name is one quoted word, which the guard never reads.
**Requirement:** G4 in `docs/prd/v0-3.md`; invariant 9.
**Needs first:** S-57 merged and the B-32 fix (D-23), so the words describe what the guard then refuses and what it still misses.
**Blocks:** nothing.
**Files:** `SECURITY.md`, `README.md`, `skill/SKILL.md` if it repeats the sentence; a new test file.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9.
**Introduced by:** PR #43, f031f76 (S-40).
**Escaped past:** the docs step's review: the sentence was checked against the list of reads, not against the guard's parser.
**New check:** test/b27-guard-docs.test.mjs: the limits sentence names "a form the guard does not parse" (or whatever words S-59 settles), the way test/b24-security-limits.test.mjs pins the log's limits.
**Fix step:** S-59.

### B-28 — A `--json` failure can repeat a typed token, and its message does not always say why

**Seen:** 2026-11-09, S-56 audit, re-run at 23:52 IST in a throwaway home. (1) `keyprompt -sk_live_PASTEDKEY123 list --json` printed `{"command":"list","status":"invalid_usage","names":[],"exitCode":2,"message":"Unknown command \"-sk_live_PASTEDKEY123\". See keyprompt --help."}`: the typed token, which could be a pasted key, is in the result, and `command` names a command that was never recognized (the PRD says `null`). `setup --json` and `log --json` do the same. Cause: `jsonRequest` skips tokens starting with `-` when it picks the command (`src/cli.mjs:253`), `parseArgs` takes a single-dash token as the command (`src/cli.mjs:229-232`), and the "Unknown command" error (`src/cli.mjs:1044`) has no `jsonMessage`. (2) `has A1,…,A13 --json` says "A card can ask for at most 12 values at once." (`src/names.mjs:47`, reached through `src/cli.mjs:737`), though `has` opens no card and text mode calls the input an invalid name; `check_secrets` with 13 names gets the same sentence; `-x has FOO --json` says "A name is not a valid secret name", because the name check at `src/cli.mjs:737` reads `has` as a name.
**Requirement:** J in `docs/prd/v0-3.md` ("without anything keyprompt did not write itself", "a message … that says why"); invariant 9.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `src/cli.mjs`, `src/names.mjs`; a new test file.
**Research:** none · **Model:** sonnet · **Confidence:** 0.95 (re-run).
**Introduced by:** (1) PR #44, 87611bb (S-41: how `jsonRequest` picks the command) and PR #45, c8e1ea1 (S-47: the `message` field, without a `jsonMessage` for an unknown command); (2) PR #45, c8e1ea1.
**Escaped past:** S-47's tests: they covered an unknown option, hint and name after the command, not a token before it, and not a list over 12.
**New check:** test/b28-json-messages.test.mjs (must fail on main before the fix).
**Fix step:** S-60.

### B-29 — `setup` does not read dotenv's `KEY: value` form, and reads lines inside such a value as names

**Seen:** 2026-11-09, S-56 audit; narrowed 2026-11-10 after the PR's `/code-review`. dotenv accepts `KEY: value` as well as `KEY=value` (motdotla/dotenv lib/main.js line 8 at 4c54504, read live 2026-11-10; its default parser is still that regex, line 19). `exampleNames` (`src/setup.mjs:56-81`) reads only `NAME=` lines, so for `B_KEY: "start` / `INSIDE_VALUE_TWO=…` / `end"` it misses `B_KEY` and, because it never sees the quote open, reads `INSIDE_VALUE_TWO` (text inside B_KEY's value) as a name; dotenv's own regex gives `B_KEY` alone (both run 2026-11-10). Such a name is reported, put in the run line and `--json`'s `skipped`, or asked for on the card. Only name-shaped text before an inner `=` can show; what follows that `=` never does, so F's words hold. Not a case: `MY KEY="-----BEGIN` with a `NAME=` line inside, which the audit first counted; dotenv's key pattern (`[\w.-]+`) rejects `MY KEY` too and reads the inner line as a key, so keyprompt agrees with dotenv.
**Requirement:** the PRD does not cover it (F's file format is `NAME=...` lines only).
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `src/setup.mjs`; a new test file.
**Research:** none (dotenv's rule read above) · **Model:** sonnet · **Confidence:** 0.9 (run).
**Introduced by:** PR #46, cee769b (S-42).
**Escaped past:** the grill and the spec: the file format was taken as `NAME=...` without checking dotenv's other separator.
**New check:** test/b29-setup-colon-form.test.mjs (must fail on main before the fix).
**Fix step:** S-61.

### B-30 — On Windows, a `run` whose command word is not a program logs argument text as the program

**Seen:** 2026-11-09, S-56 audit, by reading (not run on Windows). `keyprompt run K -- "curl https://h/v1?key=abc"` would log `program: "v1?key=abc"`, and `"python -c print('x')"` would log all of it. The PR's `/code-review` added that no space is needed: `"https://h/v1?key=abc"` alone would log `v1?key=abc` too. `programName` (`src/activity.mjs:123-125`) only drops the folder. On Windows, cross-spawn 7.0.6 sends a command it cannot resolve, and that does not end in `.exe` or `.com`, through `cmd.exe` (cross-spawn lib/parse.js lines 36-58, read 2026-11-09 from the installed copy), so the spawn succeeds, `cmd.exe` exits 1, and the run line is written (`src/cli.mjs:868-871`). On macOS the same input fails to spawn and writes no line (seen by the audit's L reviewer).
**Requirement:** L in `docs/prd/v0-3.md` ("SHALL NOT write … a command's arguments"), D-20.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `src/activity.mjs`; a new test file (a unit test of `programName` runs everywhere; a CLI test runs on CI's Windows jobs).
**Research:** none · **Model:** sonnet · **Confidence:** 0.7 — read in both codebases, not run on Windows; the fix step's first test, on CI's Windows jobs, settles it.
**Introduced by:** PR #48, 12b9e7b (S-43).
**Escaped past:** the grill and the spec: "the program's own name" assumed the first word is a program; the tests ran it on POSIX only.
**New check:** test/b30-program-name.test.mjs (must fail on main before the fix).
**Fix step:** S-62.

### B-31 — The v0.3 PRD's detail sections say five things the code does not do

**Seen:** 2026-11-09, S-56 audit. Not on an acceptance line, but the PRD is what later steps are written from:
1. "Setup (S-42)" says the run line names "every name that is saved now"; it also names those already saved (`src/setup.mjs:157`, pinned by `test/cli.test.mjs:1081`).
2. "Activity log (S-43)" says "a folder that cannot be written costs no wait"; a stale lock in a read-only folder costs about 2 seconds per command (`src/activity.mjs:82-89`, seen by the L reviewer).
3. The same section says a lock path that is not a file "stops the waiting"; it does not say that the trim is then skipped every time, so the file grows past 1,000 lines (seen: 1,025), as it also does in a read-only home with a writable log.
4. G3 says that on uninstall "only those entries SHALL go"; a pre-existing empty `"hooks": {}` or event array is removed too (`src/install-guard.mjs:149-152`). Claude Code reads no difference.
5. "MCP server (S-45)" says the card's "who is asking" is the client's own name; with no `clientInfo` name it falls back to "Claude Code in <folder>" (when `CLAUDECODE` is set) or "a command in <folder>" (`src/cli.mjs:351`, 653-655).
**Requirement:** the standard's rule that the spec is corrected where it is wrong (mystandard section 5).
**Needs first:** nothing (Abhishek chose words for item 3, 2026-11-10).
**Blocks:** nothing.
**Files:** `docs/prd/v0-3.md`; `src/activity.mjs` only if item 3 changes code.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9.
**Introduced by:** S-42 (PR #46), S-54 (PR #56), S-39 (PR #42), S-45 (PR #51).
**Escaped past:** the review of each step's spec against its own code.
**New check:** none possible as a test of meaning; S-63's Verify quotes each corrected sentence next to the code line it describes.
**Fix step:** S-63.

### B-32 — The guard misreads some shell syntax, so a direct read passes

**Seen:** 2026-11-10, by S-57's senior review (https://github.com/abhisheksharma001/keyprompt/pull/60#issuecomment-6750956360, its findings 4 to 11), S-57's fix round (item 9), S-57's second `/code-review` (item 10, and the second forms of items 2, 3 and 7), S-57's senior review round 2 (https://github.com/abhisheksharma001/keyprompt/pull/60#issuecomment-6760128805, items 11 to 13) and its fix round (item 14, widened by that round's `/code-review`), and S-57's senior review round 3 (https://github.com/abhisheksharma001/keyprompt/pull/60#issuecomment-6761183805, items 15 to 19). Each input was fed as a string to `checkCommand` from main (07019ad) and from the S-57 branch, and passes both, so Claude Code would run it; no store read was run. "Bash runs it" means checked with `echo` in place of the read on macOS bash 3.2.57 and zsh 5.9.
1. A function or alias that redefines a text-only name: `echo() { "$@"; }; echo security find-generic-password -s keyprompt -w`, and `function grep { "$@"; }; grep …` (bash runs it). S-57's `TEXT_ONLY` exemption lets it through; main looked at the first word only.
2. ANSI-C quoting: `true $'\'' ; security find-generic-password -s keyprompt -w #'` (bash and zsh run the second command); `splitShell` knows no `$'…'`. A command name written that way keeps its `$` too: `$'security' find-generic-password -s keyprompt -w`.
3. `echo $(echo ')'; security find-generic-password -s keyprompt -w)`: `subshell()` counts parentheses and ignores quotes (by reading), and comments too: `echo "$(# )" "`, a line break, then `security find-generic-password -s keyprompt -w)"`, where bash runs the read inside the substitution and the guard ends it at the first `)`.
4. `bash -c -- '<read>'` and `bash -c -e '<read>'`: the word right after `-c` is taken as the script (bash and zsh run both).
5. `eval eval eval eval eval <read>`: past depth 4, `readInShell` answers "no read"; it could refuse instead.
6. `Get-StoredCredential -Target:keyprompt:X`, PowerShell's colon-bound parameter: the check matches whole words only (by reading).
7. A PowerShell here-string, `Write-Output @"`, then `x"'`, `$(Get-StoredCredential -Target keyprompt:X)`, `'"` and `"@` on their own lines: here-strings are not read, quotes inside one are text and `@"` runs `$( )` (about_Quoting_Rules, live, 2026-11-10; by reading). Shorter: `Write-Output @'`, `it's`, `'@` and the read on four lines; the `'` in the body ends the guard's string early, and `'@` opens one that never closes.
8. Other ways to hand `pwsh` or `powershell` a script: an abbreviated `-Command` (`-Comm`), `-cwa` (`-CommandWithArgs`), and perhaps a bare argument to Windows PowerShell 5.1; the check knows only `-c` and `-Command`. R-16, answered 2026-11-10 from `pwsh` 7.6.9's own parser: every prefix of `command` from `-c` to `-command`, and exactly `-cwa` or `-commandwithargs`, each behind `-`, `--` or `/`, runs its arguments as a script; a bare argument and `-command:<script>` are file names in `pwsh`; Windows PowerShell 5.1 is unchecked, so S-74 reads it the broad way. Fed as strings to `checkCommand` from main (87dd975): `-comm`, `-com`, `-co`, `--command`, `/command`, `/c`, `-cwa` and `-CommandWithArgs`, each before a script that names a store read tool, all pass.
9. A quote inside a comment that follows a subshell's `(` or `)`: `(true)# don't`, a line break, then the read; or `(# don't`, the read and `)` on three lines (bash and zsh run the read, because there the `#` starts a comment). S-57 reads a `#` after `(` or `)` as part of a word, which it is after `<(…)`, `a=(…)` and zsh's `(#i)`, so the quote swallows the next line. PowerShell's `(1)# don't` before a `Get-StoredCredential` line likewise (by reading). Main read no comments, so its quote swallowed the line too.
10. `security -p x find-generic-password -s keyprompt -w`: `-p` takes a value (`man security`, macOS 27.0: it "implies the -i option but changes the default prompt"), but the guard takes the first word after `security` that does not start with `-` as the subcommand, here `x`. Whether `security` then runs the named command as well as its interactive prompt was not checked, since that would read the store.
11. A fake `pwsh -c` that opens `<#` or `'`, then a real one whose script runs past a later word named `pwsh`: `find . -exec pwsh -c "<#" \; -exec pwsh -c Write-Output pwsh '; Get-StoredCredential -Target keyprompt:X' \;`, also with `"'"` or `/usr/local/bin/pwsh`. For the Bash tool, the tail read starts at the fake flag and is swallowed by its `<#` or `'`, and the real flag's own stretch stops at the word `pwsh`, which has no flag after it (the PowerShell stretch in `readInWords`, `src/guard.mjs`). Monitor refuses it. S-57's round-1 head (ddcb887) refused it; main and S-57 let it through. A linear fix: refuse when the tail read ends inside an open quote or block comment.
12. `eval` behind a zsh precommand modifier the guard does not know: `noglob eval "<read>"`, `nocorrect eval "<read>"`, `repeat 1 eval "<read>"`, `coproc eval "<read>"` (zsh 5.9 runs all four, checked with `echo` by the round-2 review). `eval` counts only as the command's own word, and `noglob`, `nocorrect`, `coproc`, zsh's `-` and `repeat N` are not in `WRAPPERS`. S-57's round-1 head refused these only through the eval-anywhere bug its first review asked to remove.
13. A quote inside a PowerShell braced variable name: `Write-Output ${a'}; Get-StoredCredential -Target keyprompt:X`. `${…}` is one name up to the next `}` (PowerShell's tokenizer.cs, `ScanVariable`, master 1aac7f5, read 2026-11-10 by the round-2 review), but the guard opens a string at the `'`. By source, not run.
14. An unquoted `${…}` holding ` #`, before a read that is not the command's own word: `x=; ${x:+ #} security find-generic-password -s keyprompt -w` and `nice ${x:+ #} security find-generic-password -s keyprompt -w` (bash 3.2.57 and zsh 5.9 run the read, because `${x:+ #}` expands to nothing; checked with `printf`). S-57's first reading takes the `#` for a comment, and its second reading, with main's rules, checks only each command's own word. Monitor refuses both. Wider, found by S-57's third `/code-review`: the first reading drops the rest of the line after such a `#`, so one in an earlier command lets B-25's own forms through after it, for every tool: `true ${x:-a #}; timeout 5 <read>`, `true ${x:-a #}; find . -exec <read> \;`, `true ${x:-a #}; env -u FOO <read>` (bash 3.2.57 and zsh 5.9 run the command after it, checked with `printf`). So does `eval ${x:+ #} 'timeout 5 <read>'`, whose joined words are read again the same two ways. A second reading that looks anywhere, as the round-2 review suggested, would refuse all of these, but it would also refuse a comment that only mentions a read (`# security find-generic-password -s keyprompt -w`), which `test/guard.test.mjs` lets through. The fix is for `splitShell` to know `${…}` and `(( ))` (and PowerShell's `${…}`, item 13), so that a `#` inside them is never a comment.
15. A backslash-newline before a `#` that the line break glues to the word before it: `true $(true)\`, a line break, then `# ; timeout 5 security find-generic-password -s keyprompt -w`; also with `<(true)`, `` `true` `` or `a=(x)` in place of `$(true)`. The shell removes the backslash-newline, so the `#` is part of the word `$(true)#` and the command after `;` runs (bash 3.2.57 and zsh 5.9, checked with `printf`). S-57's comment rule (`src/guard.mjs`, `splitShell`, around line 141) takes the `#` for a comment, because after the continuation it looks like the start of a word. Passes every tool on main and on S-57. The round-3 review's fix, tried in a scratch copy only: a `boundary` flag that a continuation does not reset (all 41 guard tests passed, no timing change).
16. A PowerShell assignment glued to the cmdlet: `$c=Get-StoredCredential -Target keyprompt:X` and `$c+=Get-StoredCredential -Target keyprompt:X`. The check matches whole words only, and the word here is `$c=Get-StoredCredential` (`src/guard.mjs`, around line 262). PowerShell runs the cmdlet (by its grammar, not run). Passes every tool on main and on S-57. A fix: split a word at a PowerShell assignment operator when reading PowerShell.
17. Slowness: a later word named `pwsh` brings back the doubling that S-57's round 2 removed (`readInWords`'s PowerShell stretch, `src/guard.mjs` around lines 376 to 380). On the round-3 review's macOS machine, the review's 1 MB shape took 1.9 s read as Bash and 3.7 s read both ways (Monitor), against 57 to 137 ms on main. It is still linear, but a ~1 MB Monitor command on a slow Windows machine could approach the hook's 10-second timeout, and what Claude Code does with the command when the hook times out was not checked here. Whether a tool call of that size can reach the hook at all was not checked either (low confidence). A fix: count the work across all readings and refuse once it passes a budget, so slowness can never turn into a pass. The review also tried a middle-way second reading (look anywhere up to a `#` word) in a scratch copy: it passed all 41 guard tests and closed item 14's cross-command forms and item 15, but made this shape about 4× slower (1 MB: 7.0 s as Bash, 13.8 s both ways), so it should not go in without the budget.
18. Thin timing headroom: the nested-pwsh timing test in `test/b25-guard-plain-forms.test.mjs` took 1.9 s in total on both macOS Node 20 and Windows Node 20 in CI, against a 2 s limit per case. It failed once on 2026-11-10, locally, at 2,096 ms, while StrykerJS ran six workers on the same machine during the S-58 work (main took 0.7 to 2.1 s for its shape under that load too): a flaky-test bug (section 5 of the standard), not a retry. A fix: time a flat string of the same size in the same run and compare against it (the nested shape is 3.0× to 4.8× the flat one now). Changing that test is a test-change step of its own (rule 19).
19. The PowerShell reading has been checked only against PowerShell's docs and source, never against PowerShell itself. A test on CI's Windows jobs could compare the guard's reading with PowerShell's own parser, which parses a script without running it.
20. `echo "$\` then a line break then `(<read>)"`: bash 3.2 joins the backslash-newline inside double quotes into `$(…)` and runs the read; main lets it through. Reported by PR #62's senior review (checked there with `printf` in bash 3.2.57; not re-run here).
Found by S-67 (PR #69, 2026-11-11) and its four senior reviews, 21 to 27. Strings only; nothing was run against the store.
21. Item 11 is only half closed. S-67's open-tail rule refuses a PowerShell tail that ends inside `'`, `"`, `<#` or `$(`. A closer put after the read ends the tail cleanly, so the rule never fires: `; #>`, `; #'`, or a trailing `-name '#>'` after the read (S-67's builder; the same on main and on the branch). Not a regression.
22. Past its limits (nesting deeper than 4, or the work budget), the guard looks only for the read tool's name, and `mentionsRead` does not decode `$'a'`, `${x}` or `\x73`; a name written that way is not found there. Today the parser does not read those forms either (items 2 and 3), so this adds no new pass; it matters when S-70 starts decoding them: see S-70's warning (S-67 round 4, N5), which says the fallback must be redesigned then, not only widened. S-59's words must say that past the limits the guard looks for the tool's name only.
23. A false refusal, not a pass: the S-67 builder recorded that a fan-out of many `pwsh -c` words on the Monitor tool is refused from about 50 KB. Not re-measured for this entry.
24. `mentionsRead` is not charged to the work budget. It is one pass of 3 to 50 ns per character on the worst shapes found (about 60 MB in 2.4 s in S-67 round 4; 3.4 to 4.6 s in the builder's runs of 62 MB). Past that size a model could not emit the command, but it is a time outside the budget.
25. N1 (S-67 round 4; the same on main): `readInShell`'s `Add-Type` path builds a fresh regular expression per saved name for every nested text, and the budget does not charge it. `'$(Add-Type credread)'` repeated to 1.3 MB cost 3.2 s with 20 saved names and 15.3 s with 100 (main: 15.1 s). Past 10 s the hook times out and fails open (D-17). A fix: one regular expression for all names per check, or charge length × names to the budget.
26. N3 (cosmetic): an `UNCLOSED` tail found early wins over a definite plain read later in the same command. Both refuse; main says the command "reads a secret", this says the reading is unfinished.
27. Bash text sent on the PowerShell tool: this repo's own PR body, written as a bash-quoted `bash -c "…$(cat <<EOF …)"`, goes 5 deep in PowerShell's reading and gets `UNREAD`; main lets it through (S-67 round 4). Rare, accepted as a false refusal. The workaround is the usual one: write the text to a file and pass the file.
**Open for Abhishek (invariant 9, N4):** both `UNREAD` and `UNCLOSED` say the command "names the OS password store's read tool". The fallback is a superset: past the limits it also fires on text that only looks split (`echo secret-$x (y)tool`), so on those the sentence is not literally true. "may name" would be true on every path. Wording is his call; no change was made.
**Requirement:** G1 in `docs/prd/v0-3.md`.
**Needs first:** nothing (S-58 was dropped, D-24); R-16 for item 8 is answered (2026-11-10).
**Blocks:** B-27 (its docs must name what is still let through).
**Files:** `src/guard.mjs`; a new test file; for item 18, `test/b25-guard-plain-forms.test.mjs` (a test-change step of its own).
**Research:** lookup (R-16) · **Model:** opus · **Confidence:** 0.9 that items 1, 2, 4 and 9 pass and run (both checked); 0.7 for 3, 5, 6 and 7 (the guard's answer run, the shell's by reading); 0.5 for 8 (R-16); 0.4 for 10 (whether `security` runs a command after `-p`); 0.9 for 12 and 14 (the shell checked); 0.7 for 11 and 13 (the guard's answer run, PowerShell's by source); 0.9 for 15 (the guard's answer run, bash and zsh checked with `printf`); 0.7 for 16 (the guard's answer run, PowerShell's by grammar); 0.8 that item 17's timings are as measured, 0.4 that a command that size reaches the hook; 18 and 19 are test gaps, not passes. On a fix, 0.7: 1, 4, 5, 6, 10, 11 and 12 are small (no exemption for a name the text defines; skip `--` and options between `-c` and its script; refuse past the depth cap; split `-Name:value`; skip `security`'s `-p` value; refuse a tail read that ends inside an open quote or block comment; add the zsh modifiers to `WRAPPERS`); 2, 3, 7, 13 and 14 need the parser to know more syntax (14: `${…}` and `(( ))`, or a reading that looks anywhere with comments off, which needs a test-change step); 9 needs both readings, because a `#` after `(` or `)` is a comment in one place and part of a word in another; 15 and 16 are small (a `boundary` flag a continuation does not reset; split at a PowerShell assignment operator); 17 needs a work budget across readings; 18 is a test change; 19 is a new Windows-only test.
**Introduced by:** PR #41, bc20dbe (S-38), the parser; item 1 also PR #60 (S-57), whose text-only list keeps it passing.
**Escaped past:** S-38's tests and S-57's tests and first `/code-review`; found by S-57's senior review and second `/code-review`.
**New check:** one new test file per step, `test/b32-guard-*.test.mjs` (S-67 to S-74) and `test/b32-powershell-parser.test.mjs` (S-75), with one case per item (each fails on main before its fix). Item 18 changes the timing test in `test/b25-guard-plain-forms.test.mjs` (S-66).
**Fix step:** S-66 (item 18, test-change; it went blind to a doubled read once S-67 landed: B-36, fixed by S-76), S-67 (5, 17 and the open-tail half of 11; PR #69, merged 2026-11-11), S-68 (1, 4, 10, 12), S-69 (6, 16), S-70 (2, 3, 20), S-71 (13, 14), S-72 (9, 15), S-73 (7), S-74 (8, after R-16) and S-75 (19, a test only), built in that order (`docs/steps.md`), with S-76 (B-36) between S-67 and S-68. All but S-75 come before S-59 (D-23, D-25), so the docs describe the result. Items 21 to 27 have no step yet: Abhishek decides which become steps (21 and 25 change what the guard refuses or how long it takes, so they would need a senior review).

### B-33 — `keyprompt log` says the log keeps the newest 1000 even when it cannot

**Seen:** 2026-11-10, by S-63's builder. `activityReport` (`src/activity.mjs:297`) ends every report with "it keeps the newest 1000 and never a value." While the lock file cannot be made (something that is not a file at its path, or a folder that cannot be written beside a log that can), nothing trims the file and it grows past 1,000 lines (B-31 item 3; S-63 says so in the PRD, the README and `SECURITY.md`). The CLI sentence is then not literally true.
**Requirement:** invariant 9.
**Needs first:** nothing.
**Blocks:** nothing.
**Files:** `src/activity.mjs`; `test/activity.test.mjs:93` and `test/cli.test.mjs:1125` pin the sentence, so the fix is a test-change step of its own (standard, rule 19).
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 (the trim skip was run by S-63's builder: 1,101 lines after a write with a folder at the lock path).
**Introduced by:** PR #56, S-54 (the lock that the trim needs).
**Escaped past:** S-54's review: the sentence was checked against the trim, not against the cases where the trim is skipped.
**New check:** the changed tests pin the new sentence.
**Fix step:** not written yet. Small: "it keeps about the newest 1000" is still not true; a sentence such as "it is trimmed to the newest 1000" with a pointer to `SECURITY.md`, or no number at all, is Abhishek's wording call.

### B-34 — The guard's CredRead rule refuses a command that only mentions CredRead

**Seen:** 2026-11-09, S-56 audit (reported under B-26 as "rarer"); left by the S-58 work, 2026-11-10. When any command runs `Add-Type` and the text holds `CredRead` and a `keyprompt:` target anywhere (`src/guard.mjs`, `readInShell`), the guard refuses, so `Select-String -Pattern 'CredRead'` next to `Add-Type` and a `keyprompt:` string is refused. A false refusal, not a pass. Matching only inside "one command" either lets a read through or breaks a locked test: keyprompt's own read form has `CredReadW` in the `Add-Type` source and the target in a later call (`src/store/windows.mjs`), and the guard splits `[Cred]::CredRead('keyprompt:X', …)` at its parentheses into two commands, so the locked case in `test/guard.test.mjs` would pass.
**Requirement:** G1b in `docs/prd/v0-3.md` (a mention is not a read).
**Needs first:** the B-32 fix (same file).
**Blocks:** nothing.
**Files:** `src/guard.mjs`; a new test file.
**Research:** none · **Model:** opus · **Confidence:** 0.8 that the rule can be narrowed to a PowerShell statement (split at `;` and line ends, not parentheses) without losing keyprompt's own form.
**Introduced by:** PR #41, bc20dbe (S-38).
**Escaped past:** S-38's tests: they covered the read, not a mention.
**New check:** a test that `Select-String -Pattern 'CredRead'` beside `Add-Type` and a `keyprompt:` string passes, and that the `src/store/windows.mjs` form and the `test/guard.test.mjs` case are still refused (must fail on main before the fix).
**Fix step:** not written yet.

### B-35 — The guard does not read a script handed to `pwsh` or `powershell` as `-EncodedCommand`, so a base64 read passes

**Seen:** 2026-11-10, while answering R-16 (reading PowerShell's command-line parser). `-EncodedCommand`, `-enc`, `-e` and `-ec` take base64 of UTF-16LE text and run it as the command (`pwsh` 7.6.9, PsUtils.cs `Base64ToString` uses `Encoding.Unicode`; R-16). The guard reads a script only after `-c` or `-Command` (`src/guard.mjs`, line 358), and the base64 holds no readable name. Fed as strings to `checkCommand` from main (87dd975), `pwsh -EncodedCommand`, `pwsh -enc`, `pwsh -e`, `pwsh -ec` and `powershell -EncodedCommand`, each followed by the base64 of a script that calls a store read tool, all pass, while the same script after `-Command` is refused. Nothing was run; no store read happened. No earlier round named it: a search of `docs/` and `src/` finds no mention of `-EncodedCommand`.
**Requirement:** G1 in `docs/prd/v0-3.md`.
**Needs first:** the B-32 `pwsh` spellings step (S-74), because both change the same lines of `readInWords`.
**Blocks:** B-27 (its docs must name what is still let through).
**Files:** `src/guard.mjs`; a new test file.
**Research:** none (R-16 has the decoding rule) · **Model:** opus · **Confidence:** 0.9 that it passes (the guard's answer was run; the decoding was read in source, not run). On a fix, 0.7: read `-e`, `-ec` and every prefix of `encodedcommand` the way R-16 reads `command` (after `-`, `--` or `/`), decode the next word with Node's built-in `Buffer` as UTF-16LE (no new dependency), and read the result as a PowerShell script; a word that is not valid base64, or decodes to something that is not text, reads as no script; the decoded size is capped so the guard stays linear. The other way, refusing every `-EncodedCommand`, would stop people who use it for ordinary work, so reading it is the recommendation; Abhishek decides if he wants the stricter one.
**Introduced by:** PR #41, bc20dbe (S-38), which added the `-c` / `-Command` match.
**Escaped past:** S-38's tests and every review since (B-25 to B-32): none looked at how else a script reaches `pwsh`.
**New check:** a test that the base64 of a script naming a store read tool is refused after each spelling, for `pwsh` and `powershell`, and that the base64 of a script that only prints text passes (must fail on main before the fix).
**Fix step:** not written yet. It follows S-74.

### B-36 — The S-66 timing test cannot see a doubled read once the guard has a work budget

**Seen:** 2026-11-11, by S-67's builder (memo item O-6), reading `checkCommand` after PR #69 gave it a work budget as its fourth argument. The nested-pwsh timing test in `test/b25-guard-plain-forms.test.mjs` (changed by S-66, PR #67) feeds a command that names no read tool. When a reading is doubled by mistake, the work budget runs out sooner, the guard answers `null` and stops, and the test finishes quickly and passes. Found by reading the code, then shown by a run on 2026-11-11 (S-76): see the fix step below.
**Requirement:** none of its own: S-66 exists so that later readings cannot be added without a timing check.
**Needs first:** S-67 merged (done).
**Blocks:** S-68 (the next reading added to the guard).
**Files:** `test/b25-guard-plain-forms.test.mjs` (the one timing test); a test-change step of its own (rule 19).
**Research:** none · **Model:** sonnet · **Confidence:** 0.7 when written; shown by a run in S-76 (3 of 3 runs, then the reviewer by a character count).
**Introduced by:** PR #69 (S-67), which added the budget; S-66 (PR #67) wrote the test before it existed.
**Escaped past:** S-67's tests and four senior reviews did not catch it; the builder found it afterwards.
**New check:** S-76's break test: make the tail read twice, and the changed test fails. Before the change, the same break should pass the test; if it already fails, the bug is not real and S-76 is closed.
**Fix step:** S-76 (`docs/steps.md`): pass `Infinity` as the fourth argument inside the test's child process, so the test measures the reading and not the cut-off. **Fixed 2026-11-11 (PR #71).** The blind spot was shown by a run: with the tail read doubled on main, the unchanged test passed 3 of 3 runs; the changed test fails it, and the S-76 reviewer counted 4.6 to 4.9 times the budget scanned by the doubled read.
