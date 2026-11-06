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
**Needs first:** Abhishek's choice of picture for waiting on a one-run Save.
**Blocks:** nothing.
**Files:** src/buddy.mjs (the pose and its motion), src/card-script.mjs (the mood set on Save), the two PRD tables, test/buddy.test.mjs.
**Research:** none · **Model:** sonnet · **Confidence:** 0.9 that the picture misleads (seen in the S-13 frames); whether it matters is Abhishek's call.
**Fix step:** not queued yet. Proposed: with Remember unticked, Save waits with the envelope in hand and the vault shut (a `handing` pose), so the vault opens only for a save.

### B-9 — The footer says "Stored in your {store}" on a card that stored nothing

**Seen:** `footerText` in `src/card-page.mjs` is "Stored in your {store} · never shown to your agent" on every real card. Only a demo, or the "Remember on this computer" box being unticked (`src/card-script.mjs`), changes it. When a card ends without a save (Cancelled, Later, Timed out, Closed), `finish()` leaves the footer alone, so under the caption "Cancelled. Nothing was saved." the footer still reads "Stored in your macOS Keychain". "Stored in" names where a Save would go; under an ended card that saved nothing it reads as a fact about that card. Found 2026-11-06 in S-21, looking at the `closed` card in Chrome (light and dark); S-14's timed-out card has the same footer and it was not noticed there. Not fixed in S-21: a bug is not fixed inside another step's PR.
**Requirement:** invariant 9 in `.claude/CLAUDE.md`. The PRD does not cover the footer's wording after a card ends.
**Needs first:** Abhishek's choice of wording for the footer once the card ended without a save (for example hide it, or "Nothing was stored").
**Blocks:** nothing.
**Files:** `src/card-script.mjs` (`finish`), `src/card-page.mjs` if the wording moves, `docs/prd/card-v2.md`, `test/card-script.test.mjs`.
**Research:** none · **Model:** sonnet · **Confidence:** 0.8 that the words mislead (seen in the frames); the wording is Abhishek's call.
**Fix step:** not queued yet. Proposed: `finish` changes the footer for the endings that saved nothing, with a test per ending.
