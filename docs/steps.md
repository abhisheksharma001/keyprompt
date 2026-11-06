# Step register — card v2

Plan: `docs/prd/card-v2.md`. Rules: `.claude/CLAUDE.md`. Standard: `~/.claude/skills/mystandard/SKILL.md`.
**One step = one PR. Stop after every PR.** A step whose "Depends on" is not done does not start. A session that is not the model a step names does not start it.

## Map

| Phase | Steps | Result |
|---|---|---|
| 0 Plan | S-1 | These docs and the project rules |
| 1 Many fields | S-2 → S-3 → S-4 → S-5 → S-6, and S-7 → S-8 | One card for every value; multi-line keys |
| 2 Later | S-9 → S-10 | Defer without saving; agents and README know the new card |
| 3 Buddy | S-11 → S-12 → S-13 → S-14 | Demo command, the creature, motion, receipt and deadline |
| 4 Honest and shipped | S-15, S-22, S-23, S-16 → S-17 | Headline fixed, mascot name dropped, card footer true, README and 0.2.0, npm publish |
| 4b Lite wins from the teardowns | S-18, S-19 | Masking catches encoded copies; refuse a key pasted into a command |
| Fixes | S-20, S-21, S-25, S-26, S-27, S-28, S-30 | B-6 (the card never ends while a save is under way), B-7 (one true sentence for an ended card), B-12 (masking finds a key's base64 inside longer base64), B-3 (a failed update of the list of names no longer fails a save that worked), B-13 (the same for a delete that worked), B-4 (on `run`, every optional box may be left empty) and B-14 (the Save button says plain "Save" when any box is optional) |
| 5 Release | S-29 | 0.2.1 on npm: the six steps since 0.2.0 |

Order: S-3, S-7, S-15 and S-18 touch different files from the S-2 → S-4 chain, so they can be built in parallel by separate sessions. Everything else follows the arrows.

## Status

| Step | Status | Learned |
|---|---|---|
| S-1 | done 2026-11-05 | Two of the three source-read rivals have no way to ask the person for a missing key, and none shows a receipt; that is the edge. "Pingu" is a live Mattel trademark (R-4). Claude Code 2.1.287 opens MCP URL prompts, which makes a v0.3 MCP server worth it. The agent itself can read a saved key from the macOS Keychain without a prompt (B-2). |
| S-2 | done 2026-11-05 (PR #2, 2cc53b3) | `src/card-style.mjs` and `src/card-script.mjs` now hold the CSS and the browser script; `renderCard` output is byte-identical (8,473 bytes for the verify options). Both blocks had no backtick, backslash or `${`, so they copy into template literals exactly. The same-bytes diff is the only guard and S-4 will break it on purpose, so do not add a page snapshot test before then. |
| S-3 | done 2026-11-05 (PR #4, 31b228d) | `parseFields` in `src/names.mjs` returns `{ name, visible, multiline, optional }[]`; `parseNames` maps over it. `run` is its only caller, so until S-6 `run` accepts hints and drops them, and it refuses more than 12 names. `visible` with `multiline` is allowed; S-4 decides how that renders. `MAX_FIELDS` is private; S-4 exports it only if the server needs the cap. |
| S-4 | done 2026-11-05 (PR #6) | A card request takes `fields` (`CardField` in `src/card-server.mjs`); `POST /submit` takes `{ values, remember }` and the promise resolves `{ remembered, values }` with a `Map` of the non-empty values. `replacing` stayed a request option: it still sets the title "Replace secret" and the one-field button "Replace value", so `set` looks as before; S-5 decides the wording when several saved fields are replaced. Required = not optional and not saved; a required box is checked before "all empty", so a one-field card says "Fill in NAME." where it used to say "Paste the value first." Visible with multiline renders as a plain text area. The paste box only catches a paste into an empty box; a paste into a box already shown edits it normally. The page script is a template literal, so backslashes in it must be doubled (`\\n`); a test compiles the served script with `new Function` to catch that. |
| S-5 | done 2026-11-05 (PR #7) | `saveAll` (`src/save.mjs`) puts back the failing name too, not only the earlier ones: a macOS write can change the item and then fail its read-back check, so "Nothing was changed." is only said once that name is restored as well. It shows only `KeypromptError` text, never a raw error. `askWithCard` now takes fields and saves inside the card's submit (so a failed save shows on the card); `run` still opens one card per name but saves through `saveAll`, and `recordSaved` became `recordSavedMany`. Several fields, all saved: "Replace secrets", a plural note and "Replace values" (`src/card-page.mjs`). `set` names a field left empty ("Left empty: C. Nothing was changed for it."). Checked on the real macOS Keychain: a line break in the 2nd value made the store refuse it, the card showed the error, and the 1st value was back to its old one. |
| S-6 | done 2026-11-05 (PR #8) | `run` now reads its names with `parseFields`, so hints reach the card (S-3's `run` dropped them); `parseNames` has no caller in `src/` any more, only `test/names.test.mjs`. `collectSecrets(store, fields, ask)` in `src/collect.mjs` returns only the Map. The CLI's `ask` prints the "saved in …" or "received for this run only" line itself (naming the values filled in), and `askWithCard` saves inside the card's submit, so `collectSecrets` never writes; a test pins that. Saved names are never asked again, and a missing optional name left empty is absent from the Map. Checked on the real macOS Keychain: with A saved, `run A,B:visible,C:optional` showed a card with only B and C, and the command saw A and B but not C, with B's value masked. B-4: a card whose every box is optional cannot be submitted empty ("Paste at least one value."), so the person must fill one box or cancel. |
| S-7 | done 2026-11-05 (PR #9) | Hex (`-X`) round-trips line breaks exactly, but `security -i` reads at most 4,095 bytes of a line and runs the rest as its own command (Apple's security.c, 4,096-byte buffer). That was already true for one-line values on main (B-5, proved with a dummy item), and hex doubles a value's length on that line. Abhishek chose two forms: hex only for values with line breaks, the quoted form for the rest. `addCommand` refuses any command over 4,094 bytes before `security` runs, and `maxValueLength` is now 4,029. With a 20-character name, values with line breaks get 1,996 bytes (an RSA-2048 PEM fits, an RSA-4096 one does not) and one-line values 3,991. `saveAll` still writes, then rolls back, the names before an over-long one, because `assertFits` only knows the 4,029 cap; a per-name check before any write would need a store method. Because the cap is lower, a run-only (Remember unticked) value is now also refused over 4,029 characters on macOS. S-10 and S-16 should state the macOS and Windows limits. |
| S-8 | done 2026-11-05 (PR #10) | The experiment passed on the first push: with the darwin-only condition removed from the round-trip test, `secret-tool` (Ubuntu 24.04, libsecret-tools 0.21.4) and the PowerShell helper (Windows, `windows-2025-vs2026`) saved and returned `line1\nline2`, a four-line fake PEM with a trailing line break, and `a\r\nb` exactly, on Node 20 and 22 (CI run 42076047835; the logs show the test ran, not skipped, and 2 skipped are the macOS-only tests). No store file changed, R-3 is answered, and nothing was loosened. Only 160-byte values were tried on Linux and Windows: a multi-line value near the Windows cap (1,280 characters, R-2) or Linux's declared 64 KiB was not run. The frozen PRD's A3 still says macOS; S-10 and S-16 may say line breaks work on all three systems, with that size caveat. |
| S-9 | done 2026-11-05 (PR #11) | `EXIT.DEFERRED` is 6. `POST /later` passes the same Host, token, Origin and JSON checks as `/cancel`, answers `{ later: true }`, and the card rejects with "The person chose Later for A, B and C. Nothing was saved." During a save `/later` answers 409, so "Nothing was saved" is never said about a card that saved. `run` rewords it with `laterForRun` (`src/cli.mjs`), which names the command but never its arguments, so a value pasted into the arguments is not echoed. Both messages start "The person" (the step text had a lower-case "the" for `run`). The button sits in the right-hand group, `[Later] [Cancel] [Save]`, not on the far left as the PRD sketch draws it; moving it is styling for the buddy steps. An opt-in test (`KEYPROMPT_STORE_TEST=1`, not on Windows, because the fake browser is a `#!` script) drives the real CLI with a fake browser that clicks Later. While building the 409 guard I found that Cancel and the deadline do not wait for a save that is under way (B-6, reproduced). It blocks S-14. |
| S-20 | done 2026-11-06 (PR #12) | Fixes B-6. The deadline no longer ends a card while a save runs: that save decides (saved, or its own error with exit 1). For `run`, a save that finishes after the deadline now starts the command, because the key was given. Cancel during a save answers 409, as Later does. A second gap of the same kind turned up and is closed: a submit whose body was still arriving when the card ended was saved anyway, because the "already ended" check ran only before the body was read. The page's Cancel ignored the server's answer; it now reads it, and with no answer at all it says "This card is no longer active" instead of "Nothing was saved", because another tab may have saved. Waiting adds no new hang: `bin/keyprompt.mjs` sets `process.exitCode` and never calls `process.exit`, so the CLI already stayed alive until the save's helper process ended (the B-6 repro logs "save finished" after the old rejection). S-14's countdown must keep waiting for a pending Save at zero. |
| S-10 | done 2026-11-06 (PR #13) | `HELP`, the README and the skill teach the FIELD grammar (with a Twilio example), one card for what you need right now, exit codes 0–6 as a table, and Later (exit 6): tell the user in one line, carry on, ask again only when about to use it. Two old lines were false and are fixed: the README said "On macOS, values must be a single line" (not true since S-7) and "choose this run only" (the card's box is "Remember on this computer"). Size limits are stated per system: Windows 1,280 characters; macOS about 4,000 bytes on one line or about 2,000 with line breaks; Linux 65,536 allowed but never tried near that (R-3 only ran values up to 160 bytes). `:optional` is written as "may stay empty while at least one box on the card is filled in", so B-4 is neither hidden nor promised away. `demo` is left out of `HELP` until S-11 merges. The README's AGENTS.md block also got the one-card and Later lines, because Codex and Cursor never read the skill. Two tests pin it: help lists the grammar and every `EXIT` code; the README lists every `EXIT` code and the skill explains exit 6, so a new exit code that skips the README fails CI. A `run` command's own exit code can equal 4, 5 or 6; only the `keyprompt:` message on stderr tells them apart. That is by design (`run` passes the child's code through) and is now written down. After the merge: `node bin/keyprompt.mjs install-skill`. |
| S-11 | done 2026-11-06 (PR #14) | `keyprompt demo` opens a card with the three sample boxes and no store. `demoRequest()` (in `src/cli.mjs`) is the request; its `onSubmit` does nothing, and the `demo` verb never calls `getStore()` or the catalog. Submit, Later and Cancel all print "Demo finished. Nothing was saved." and exit 0; a timeout (exit 5) or a browser that will not open (exit 1) is still an error, and `demo` with any argument is a usage error (exit 2). A card request takes `demo: true`, and the page then shows the banner "Demo — nothing you type is saved.", replaces the footer, ends a submit with "Demo finished / Nothing you typed was saved" instead of "Saved", and has no "Remember on this computer" box (`allowSessionOnly: false`). Three old texts were false for a demo and are replaced, not reused: the footer ("Stored in your nowhere (demo)"), the done screen ("Saved securely and kept private") and the Remember box. **S-12 and S-14 must keep demo true:** the PRD captions and the receipt say "your {store}", which would read "your nowhere (demo)"; demo needs its own wording (the page already knows: `<main class="card" data-demo>`, and the script has `demo`). The Save button still reads "Save all 3" in a demo, because the point is to show the real card; the banner and the finish screen say nothing is saved. Verify was adapted: `onSubmit` takes `(values, remember)`, not a store, so the test hands it values that throw if touched, and the real CLI is run on a pretend system with no password store (`process.platform` set to freebsd in a preload, so any `getStore()` call fails) for submit, Later and Cancel. That test touches no real store, so it needs no opt-in (it skips on Windows: the fake browser is a `#!` script). The README does not mention `demo` yet; `HELP` does, and S-16 documents it. |
| S-12 | done 2026-11-06 (PR #15) | src/buddy.mjs holds `BUDDY_NAME` (removed in S-22), `MOODS` (the PRD table word for word; a test parses the PRD and compares), `CAPTION_VARIANTS`, one inline SVG of about 5 KB and `buddyStyle()`. Each optional part lists the moods that show it (`data-show`) or hide it (`data-hide`), and `buddyStyle()` turns those lists into CSS, so a pose is data. No colour is written in the SVG: every fill comes from a class mapped to a `--b-*` variable set for light and for dark (OKLCH). The buddy replaces the lock icon in the card header, and the caption is a speech bubble beside it, under the title. The step said "under the creature"; beside keeps the form near the top. The header stays on the done screen: the title becomes the outcome ("Saved", "Ready", "Later", "Cancelled", "Closed", "Demo finished"), the caption says what happened, and the done view now holds only "You can close this tab." (the tick and the repeated sentence are gone). Three table captions (`listening`, `stashing`, `locked`) would be false on some cards, so they are replaced there, and the PRD now lists all five replacements: with Remember unticked (`listening`, `stashing`) and in a demo (`listening`, `stashing`, `locked`). The first box has focus on load, so a buddy that followed focus alone never showed the opening caption; it now follows focus only after the person's first click, key or paste in the form. A server error that names no field goes to the caption (red, `oops`) instead of the error line; one that names a field still goes to the error line, and the buddy follows the focused box. `asleep` can only be seen through the demo's preview until S-14 adds the countdown. The `closed` caption repeats B-7's false sentence after a timeout (noted in B-7). No test runs the page script: the mood changes were checked by hand in Chrome for every outcome in light and dark mode, with a scratch card that saves nothing and with `keyprompt demo`. |
| S-13 | done 2026-11-06 (PR #16) | `motionStyle()` in src/buddy.mjs adds one keyframe set per mood, written into `buddyStyle()`: listening breathes (a stretch from the feet, so they stay on the ground, 2.4 s loop), peek-proof's flippers swing up (200 ms), the key goes into the vault (`STASH_MS`, 600 ms), then on locked the door shuts from its hinge (250 ms) and the dial turns to its still 135° (400 ms), one-run's envelope is offered up and fades (600 + 300 ms), the later note drops on (300 ms), bye waves twice, asleep's z's float in turn (3 s loop), oops shakes while keeping its tilt (300 ms). Three choices go past the step text: the locked sparkle pops in last (at 650 ms), because popping first it said "locked" before the door shut; the envelope rises instead of sliding right, because sliding right it went onto the vault door and looked saved; and the flippers do not fade in, because a fade left one frame with no eyes and no flippers. After a successful Save the page waits `STASH_MS` minus the time the server took before its done screen (measured: 599 ms after the answer; with reduced motion 1 ms), so no wait is ever over 600 ms. Reduced motion sets `animation: none !important` on the buddy, which leaves the S-12 still poses, and the script skips the wait. Measured in Chrome: no animation in any mood with reduced motion, and the expected ones without it (`getAnimations()`). A frame-by-frame strip (each animation paused at set times) was checked in light and dark. Tests pin the step's rules: only `transform` and `opacity` in any keyframes, `infinite` only for listening and asleep, every keyframes set used, the reduced-motion block, a part with a still transform ending on it, and `STASH_MS` ≤ 1,200 and used by both the style and the script. Re-entering a mood replays its motion; clicking the same demo preview twice does not (the mood did not change). For the first ~100 ms of locked the vault shows plain ice (the dark opening has gone and the door is still narrow); left as is. B-8 logged: with Remember unticked the key still goes into the vault. |
| S-14 | done 2026-11-06 (PR #17) | The done screen has a receipt and the footer has a clock. **Receipt:** `src/receipt.mjs` holds `RECEIPT_WORDS` (a test compares them with the PRD, word for word), `MASKING_NOTE` and `receiptFor(fields, values, remember)`. The submit answer is now `{ remembered, receipt: [{ name, outcome }] }`: names and outcomes only (a test checks no value is in it), and a demo's answer has no `receipt`. The page writes each line with `textContent`. Four choices past the step text: (1) the masking sentence appears only on a card whose command output is masked (`masked` in the card request: `run` passes `args.redact`, `set` passes nothing), so a `set` card's page does not contain it ("that command's output" means nothing there), and neither does a `run --no-redact` card, where the sentence would be false (found in self-review; the card then says nothing about masking, and saying that it is off could be a follow-up); (2) Later lists every box as "Not saved (Later)", built by the page, because Later never saves; (3) no receipt after Cancel or a timeout (their caption already says nothing was saved) and none in a demo; (4) "Kept the saved value" can only appear on `set`, since `run` never asks for a saved name. **Clock:** `renderCard` takes `expiresAt` (`Date.now() + timeoutMs`, fixed when the card starts) and writes it to `data-expires` on `#clock` in the footer. The clock is a `role="timer"` with `aria-live="off"`, because the whole card is a polite live region and would read out every second. `clockStep(left, busy)` in src/card-script.mjs is a pure function that the script embeds as its own source, so a test can call it. At zero the page calls `finish('Timed out', 'asleep')`, unless `busy` (a request, or the S-13 wait after a save, is under way): it then says "Time is up. Waiting for the answer…" and polls, and the answer ends the card (a save that finishes after zero shows Saved and its receipt; one that fails shows its own error). `lock(false)` re-checks the deadline. **Tests:** test/receipt.test.mjs (3), test/card-script.test.mjs (8: it runs the real script against a hand-made fake page and a fake clock) and 4 new in test/card-server.test.mjs, plus one opt-in test in test/cli.test.mjs that drives the real CLI (`run`, `run --no-redact`, `set`) with a fake browser; 116 tests (111 pass, 5 skipped; the real-store ones need `KEYPROMPT_STORE_TEST=1`, and all 116 pass with it). 16 guards were broken one at a time and each failed a test. The 14th survived at first: an `ended` flag that nothing could fail was dead, so it was removed, and a test now counts live timers after the card ends. **Checked in Chrome** (light and dark, 360 and 520 px, a real card per case): a `set` receipt; a `run` card with Remember unticked; a 12 s card left alone (Timed out, asleep); a save pressed at 0:07 that takes 8 s on a 9 s card (waited past zero, then Saved); the same save failing (the card ends with its error); `keyprompt demo` (clock, no receipt). Found and fixed in the browser: a long outcome wrapped under its name chip (now two columns), and the wrapping footer pushed the shield icon onto its own row at narrow widths. **Not folded in:** B-7 (the false "already used" sentence after a timeout). A bug is not fixed inside another step's PR. S-14 shrinks its window: the page now ends the card itself at zero, so nothing can be pressed after it. Known gaps: only Chrome was run; the fake page is a hand-made stand-in, not a browser; with the same card open in two tabs, a tab that times out says "Nothing was saved" even if the other tab saved. |
| S-21 | done 2026-11-06 (PR #18) | Fixes B-7. One sentence for every ending: the server's 410 now says "This card is no longer active. Close this tab." (one constant, `CARD_ENDED`, used at both places a finished card answers), and the buddy's `closed` caption says "This card is no longer active. You can close this tab." (the PRD row is renamed "Card no longer active", and so is A5's list). The page's Cancel with no answer lost its own copy of the sentence and uses the caption, so the words live in one place. Nothing about when a card ends changed (status, `final: true`, every other message). **Tests:** 2 new, 118 in all (113 pass, 5 skipped; all 118 pass with `KEYPROMPT_STORE_TEST=1`). One checks the 410 text after each of saved, cancelled, Later and timed out; one runs the page script and checks the `closed` caption for a final 410 (from Save, Later and Cancel) and for a Cancel nobody answers. S-20's test of a body still arriving at the deadline now checks the text too. 10 guards were broken one at a time and each failed a test. A race in the test helper turned up: `send` reused a keep-alive connection that the server closes when a card ends (`socket hang up`), so it now opens a connection per request (`agent: false`). **Checked in Chrome** (light and dark, 360 and 520 px): after the card saved, a Cancel got 410 (logged from the page's `fetch`) and one pressed 1.2 s later got no answer; both showed "Closed", the `closed` pose and the new sentence. **Found, not fixed:** B-9, the footer reads "Stored in your macOS Keychain" on cards that stored nothing (Cancelled, Later, Timed out, Closed); S-14 missed it. Known gaps: only Chrome; a 410 right after a timeout is covered by the server test, not seen in a browser, because since S-14 nothing can be pressed after zero, so it needs a request already on its way. |
| S-15 | done 2026-11-06 (PR #19) | Fixes B-1 and B-2. The README intro, its Why bullets and quick-start step 4, `package.json` and (after Abhishek's go) the GitHub description no longer say the agent "never sees" a key. They say what is true: the key goes to one command, exact copies are masked in its output (not with `--no-redact`), a command can still transform or send it, and keyprompt has no command that prints a saved key back. `SECURITY.md` gains two lines: the agent itself can read a saved key straight from the OS store because it runs as you, and `run --no-redact` passes output through untouched; its masking row also names `--no-redact`. **B-2's claim was run on macOS, 2026-11-06:** an item written the way keyprompt writes it (service `keyprompt`) was read back by plain `security find-generic-password -w` with no prompt, then deleted. Linux (`secret-tool lookup`) and Windows (`CredReadW`) read the same way, with no extra login, but were not run. **Past the step text, all in the same files and the same overclaim:** the README line "so an agent can't be talked into revealing one" and step 4's "never sees the value" (the acceptance grep would not have caught either); the one-liner says "keyprompt has no command that prints it back" where the step said "there is no command that prints it back", because `--no-redact` lets a command print it; the `--no-redact` line in SECURITY.md; and, found in self-review, the protections table's "There is no command that outputs a saved value", which the new limit contradicts (it now says "no keyprompt command", with a pointer to the limits). **Test:** 1 new, `the headline claims nothing the code does not do (B-1, B-2)` in `test/cli.test.mjs`; 119 in all (114 pass, 5 skipped; all 119 pass with `KEYPROMPT_STORE_TEST=1`). 8 guards were broken one at a time (each false phrase put back, each SECURITY.md limit removed, the table's old wording put back) and each failed exactly that test. **Found, not fixed:** B-10 (the card footer says "never shown to your agent") and B-11 (an agent can type `run --no-redact` and read any saved key through keyprompt; reproduced with a throwaway item). docs/saved.png (removed in S-16) and its alt text still show the old card ("never shown to your agent"); S-16 replaces the screenshots. Known gaps: Linux and Windows reads not run; the GitHub description is its own action with its own yes. |
| S-22 | done 2026-11-06 (PR #21) | Abhishek chose "Drop the name" after a fresh R-4 check (evidence in the step and in R-4). `BUDDY_NAME` is gone. The demo card's preview row reads "The penguin's poses:" and its group label "Preview the penguin's poses"; both are plain text in `src/card-page.mjs` (no helper needed, there is nothing to escape). The old name test became a guard: no `.mjs` under `src/` spells "pingu" in any case, and the rendered demo card does not either. `git grep -n -i pingu -- src README.md package.json skill` prints nothing. The PRD (item 6, "The buddy", D-2) and R-4 say the penguin is unnamed and why. Left as history: this register's older rows and the PRD's decision text still say "Pinguu" where they record what was decided then. Checked by hand in Chrome, light and dark, on the real demo request (a scratch script wrote its link to a file instead of opening the browser): the row, its 11 pose buttons, one pose click and Cancel behave as before. No test runs the page in a browser. |
| S-23 | done 2026-11-06 (PR #20) | Fixes B-9 and B-10; Abhishek chose the wording on 2026-11-06 ("Say only what is true"). A real card's footer now reads "Stored in your {store}" (the clause "never shown to your agent" is gone, invariant 9), a card with Remember unticked reads "Held for this one command only", and the demo's "Demo · nothing is stored" is unchanged. After an ending that saved nothing (Cancelled, Later, timed out, no longer active, a final error) the card shows **no footer at all**: `finish` in `src/card-script.mjs` hides `<footer id="footer">` unless the mood is `locked` (a Save, or a demo's pretend save) or `one-run`. **Past the step text:** the first build hid only the note; in Chrome that left the footer's hairline and an empty strip under "You can close this tab.", so the whole footer goes (its clock is already gone at the end). The footer element has `id="footer"` for this. **Test:** 4 new, 1 changed; 123 in all (118 pass, 5 skipped). In `test/card-script.test.mjs`: the footer is gone after each of six endings (Cancel, Later, timeout, 410, Cancel with no answer, a final error), it stays after a Save, a one-run Save and a demo, and the Remember box swaps the two lines; in `test/card-server.test.mjs`: no file under `src/` and no card page says "never shown to your agent" (the guard string is in that test, so `git grep -n "never shown to your agent" -- src test` prints only it), and the changed test pins the new footer and its id. 12 guards were broken one at a time (never hidden, always hidden, a one-run Save, Cancel, Later, a timeout, a closed card or a final error keeping the footer, the old claim back in the page and in the script, ticking Remember again, the id removed) and each failed exactly the tests named for it; the tree was restored from the commit each time. **Checked by eye** in Chrome, light and dark, on a scratch card with the real store label that saves nothing: open, Remember unticked, Cancel, Later, Save. **Known gaps:** "Stored in your {store}" is also on the card before anything is saved, where it names the place a Save goes (the wording Abhishek chose); the screenshot of the saved card came from a scratch card that stored nothing; `README.md` line 10 and docs/saved.png (removed in S-16) still carry the old words, and S-16 replaces them; the opt-in real-store tests were not run (no store code changed). B-8 and B-11 are still open. |
| S-16 | done 2026-11-06 (PR #22) | The README now opens with a three-line quick start (install, `keyprompt install-skill`, `keyprompt demo`), then two screenshots, then the intro paragraph; `keyprompt demo` is in the commands table. **Screenshots** came from the real `keyprompt demo` (a launcher script via `KEYPROMPT_BROWSER` wrote the card's link to a file), in Chrome, light theme, 560 px wide at 2x: docs/demo-card.png (two boxes filled with fake values, the penguin listening, the demo banner, the pose row, the clock) and docs/demo-finished.png (after pressing Save all 3: "Demo finished"). The demo created nothing: its `KEYPROMPT_HOME` stayed an empty, missing folder. The three old screenshots are removed (docs/card.png, docs/saved.png, docs/card-run-once.png); they showed the old card and "never shown to your agent", B-10's last trace. **CHANGELOG.md** lists 0.2.0 ("unreleased": S-17 puts the date on it) and 0.1.0, every line checked against its register row. Two corrections found while writing it: Windows and Linux already kept line breaks in 0.1.0 (only macOS is new), and B-5 (a macOS value over about 4,000 bytes was cut off and its tail ran as a `security` command) is listed as a fix, because it was in 0.1.0. `package.json` and `package-lock.json` say 0.2.0 (`npm version 0.2.0 --no-git-tag-version`; no tag, no commit from npm). **Test:** 1 new in `test/cli.test.mjs`: the README's pictures exist, "never shown to your agent" is not in it, `demo` is in its table, and the CHANGELOG has a section for the version in `package.json`; 124 in all (119 pass, 5 skipped). 6 guards were broken one at a time (a missing picture, the old claim in a picture description, the demo row gone, the version moved on, the CHANGELOG heading renamed, a picture deleted) and each failed exactly that test. **Checked on GitHub** (the branch's README, Chrome, 1280 x 800, light): the install lines and the top of the card with the penguin are on the first screen, and both pictures load. **Past the step text:** that test, and the Node and Linux line under the quick start (a Linux reader would otherwise miss `secret-tool`); a deleted name is written without backticks in the two register rows and in B-10 that named docs/saved.png. **For S-17:** `files` in `package.json` lists neither `docs/` nor `CHANGELOG.md`, so the package would carry the README without its pictures; and the README has two install blocks (the top and "Install") to switch to `npx -y keyprompt`. **Known gaps:** screenshots are light only and Chrome only; the dark theme and a phone width were not looked at on GitHub; the opt-in real-store tests were not run (no store code changed); B-8 and B-11 are still open. |
| S-24 | done 2026-11-06 (PR #23) | **Decision (B-11, D-6):** opus laid out four options after checking that Claude Code's Bash tool gives a command no terminal (`[ -t 1 ]` false); Abhishek chose "Terminal only". `run --no-redact` now needs keyprompt's stdout and stderr both to be a terminal (`outputIsTerminal` in `src/cli.mjs`, the same `isTTY` check `src/browser.mjs` trusts before printing a card link); otherwise exit 2 with one sentence, before the store is read or a card opens. **Test:** 1 new in `test/cli.test.mjs` (the check with fake streams; a piped `run --no-redact` exits 2 with the exact message, prints nothing to stdout and starts nothing; a missing `KEYPROMPT_BROWSER` keeps a broken check from opening a real browser). The opt-in card test no longer tries `--no-redact` from a pipe; `test/card-server.test.mjs` still covers a card that does not mask. 125 in all (120 pass, 5 skipped), and 125 of 125 with `KEYPROMPT_STORE_TEST=1` on macOS. 5 guards broken one at a time (check removed, `||` for `&&`, stderr ignored, stdout ignored, message changed): each failed exactly that test, and the tree was restored from the commit each time. **By hand** on macOS with a throwaway Keychain item holding a dummy value: from a pipe, exit 2; inside `script -q /dev/null`, `--no-redact` printed the value and plain `run` masked it; the item was deleted (`has` exit 3). **Surprise, said out loud:** `script` gives any command a terminal, so an agent can still turn masking off on purpose. `SECURITY.md`, B-11 and D-6 say so; it is the same kind of limit as B-2. **Known gaps:** the terminal path is checked by hand on macOS only, not by a test and not on Windows or Linux; `set` still accepts `--no-redact` and ignores it, as before. B-8 is still open. |
| S-17 | done 2026-11-06 (PR #24) | **Published:** keyprompt@0.2.0 is on npm (2026-11-06 15:31:57 UTC), with `latest` on it. It came from 26fd436, the PR head CI tested. Its shasum, ceb367f7c1c0990fa61c5292c779f687e88b0cbb, is the dry run's (27 files, 40.8 kB). `npx -y keyprompt --version` printed 0.2.0 in an empty folder with an empty npm cache and an empty global folder. The first try printed 0.1.0, because npx ran the copy Abhishek had installed globally from GitHub. On the npm page both pictures load from the pinned links, the `SECURITY.md` links reach GitHub, and `#install` works. **Pictures:** full raw.githubusercontent.com links pinned to e24f5ea. Adding them to `files` would not help: npm never serves pictures from the package, and it resolves relative links unreliably (npm/marky-markdown#432). `files` gained `CHANGELOG.md`, which npm does not include on its own. R-7 was re-checked: the name was still free. **Surprises, said out loud:** (1) The npm account had no 2FA, and npm refuses a publish without it (403). Abhishek turned on a security key (Touch ID), mode auth-and-writes. (2) Without a terminal, npm 10.9.7 throws EOTP before it offers browser 2FA (lib/utils/auth.js:10 in npm itself). The publish ran as `printf '\n' \| script -q /dev/null npm publish --access public --auth-type=web`, and Abhishek approved it with Touch ID. `npm login --auth-type=web` works without a terminal: it prints a link that lasts about 5 minutes. The first two expired because the account's emailed login code was not entered in time. (3) A brand-new package first gets a public placeholder version, `0.0.0-stage` (npm staged publishing). The upload answered 202 "being processed", and 0.2.0 replaced the placeholder as `latest` about 2.5 minutes later. The placeholder stays in the version list. (4) The account's email is public in the package's maintainers. **After the merge:** tag `v0.2.0` on the squash commit, after checking that `npm pack` there gives the same shasum (only `docs/` changes after 26fd436, and `docs/` is not in the package), then the GitHub release. Known bugs B-3, B-4 and B-8 ship in 0.2.0, as Abhishek accepted with the go. |
| S-18 | done 2026-11-06 (PR #25) | `copiesOf` in `src/redact.mjs` lists the texts that count as a copy: the value, and for 8+ characters (counted with `[...value]`, so an emoji is one) its base64 and base64url (each with and without padding), lowercase hex, two URL encodings (RFC 3986, and `encodeURIComponent`, which also keeps `!*'()`) and the JSON-escaped form. The URL encoding is written by hand from the UTF-8 bytes because `encodeURIComponent` throws on a lone surrogate, which would crash `run`. **Speed:** nine forms per key made the scan about a third slower at first (9 vs 13 MB/s, 12 keys, 20 MB). Indexing patterns by first byte plus a second-byte reject made it 3 to 5 times faster than before the change (37–69 MB/s); the existing split-across-chunks tests fail if that reject is wrong. Tests compute the expected forms with Node's own encoders, never with `copiesOf`. Break tests: no forms → exactly the 4 new tests fail; threshold, character counting, the RFC 3986 form and the JSON form each fail one. Real CLI check with a throwaway Keychain item: raw, base64, hex, URL and JSON copies all masked; item deleted. **Surprise (B-12):** `curl -v -u user:KEY`, the very example in `SECURITY.md`, prints base64 of `user:KEY`, which is masked only when the text before the key is a multiple of 3 bytes (`ab:` yes, `user:` no). Logged, and named in `SECURITY.md`; the fix needs a partial-masking decision. The step's file list grew from 3 to 10: README and skill said base64 is not masked, which would have become false; the PRD table said "proposed"; CHANGELOG got an Unreleased entry; B-12 went into the bug log; and a `run`-level test proves the acceptance sentence. AgentSecrets (env.go:220-278 at be53766) also masks case variants and `0x` hex from 4 characters; not copied. |
| S-19 | done 2026-11-06 (PR #26, e991ae0) | `secretsInCommand(secrets, command)` in `src/cli.mjs` returns the names whose value (8+ characters, counted with `[...value]`) sits inside any word after `--`, the program word included; `valueInCommandError(names)` is the refusal, exit 2. The check sits between `collectSecrets` and `runWithSecrets`, so a refused run starts nothing. **The message says "value", not "saved value" as the step first wrote it:** a value the person gave for this run only (Remember unticked) is refused the same way, and "saved" would not always be true (invariant 9). **Tests:** 3 new in `test/cli.test.mjs`: the pure check and its edges (whole word, inside a header or URL, program word, several names in order, 7 vs 8 characters, an emoji value that is 7 characters, a Cyrillic one that is 8, a PEM with line breaks); the exact messages; and an end-to-end run against the real OS store (opt-in; it ran and passed in all 6 CI jobs) that exits 2, prints nothing to stdout, never shows the value and never creates the marker file, then runs the same command without the value to prove the refusal is the check. 132 of 132 with `KEYPROMPT_STORE_TEST=1`. 6 guards broken one at a time (refusal removed, threshold removed, UTF-16 length, whole-word only, program word skipped, threshold 9): each failed a test. Only the end-to-end test catches "refusal removed", so a plain `npm test`, which skips it, would not. Real CLI check on macOS with a throwaway Keychain item: value in the command → exit 2 and the message; `$NAME` in a shell → exit 0, masked; a 7-character value in the command runs; item deleted. **Known limits, all in the PR body:** exact value only (a base64 copy in the command is not refused); the check runs after the values are known, so a missing name's card opens first, and fixing that means changing `src/collect.mjs`; `:visible` values are refused too, as masking covers them (invariant 3); `--reason` and `--by` are not checked; it tells an agent nothing masking does not already tell it. The step's file list grew from 2 to 3: `CHANGELOG.md` has an Unreleased line. No README, skill or `SECURITY.md` change. |
| S-25 | done 2026-11-06 (PR #28) | **Decision (B-12):** opus laid out three options (shifted pieces as GitHub Actions does, decode and check as secret scanners do, leave as documented) after reading actions/runner, trufflehog and gitleaks live; Abhishek chose shifted pieces. `base64Pieces(bytes)` in `src/redact.mjs` encodes the value behind 0, 1 and 2 zero bytes, in base64 and base64url, and keeps the characters made only of the value's bits; `copiesOf` adds them for values of 8+ characters (pieces are then 10+ characters). The scan is unchanged. Base64's 3-bytes-to-4-characters grouping explains the whole bug, and more of it than B-12 said: text *after* the value broke the match for some lengths too, and `echo $KEY \| base64` was masked before only because a line break's first bits are zero. GitHub drops whole bytes and can leave 16 bits of the value visible; keeping only pure characters leaves at most 4 bits at each end. Proof: 3 new tests (45 cases with the exact characters that stay, the curl line split at every point, base64url at each offset); 6 break-tests each failed only the new tests; `KEYPROMPT_STORE_TEST=1` suite 135 of 135. Real run on macOS, curl 8.7.1, through `run`: main left the Basic line of `curl -v -u apiuser:$NAME` unmasked for keys of 19, 20 and 21 characters, the branch masked all three. My first script for that run hung: it served HTTP and called `spawnSync` in one Node process, so the server could not answer curl; async `spawn` fixed it. Its cleanup called `store.delete` (the method is `remove`), so both throwaway Keychain items were deleted by hand and checked gone. Files: 2 code, 7 docs. |
| S-26 | done 2026-11-07 (PR #29) | Fixes B-3. **Reproduced first**, on main: `keyprompt set NAME` on macOS with a fake browser and a throwaway Keychain item, once with `KEYPROMPT_HOME` pointing at a plain file and once with a `catalog.json` that is not JSON. Both times the card answered 422 "Could not save. Try again.", `has NAME` exited 0 (the value was in the Keychain), and after the browser gave up `set` ended with exit 4 and "The person closed the secret card without saving". B-3 had only the unwritable folder and the card's words; the unreadable catalog and the false "without saving" told to the agent are new. **The change:** `saveAndRecord(store, values, reason)` in `src/cli.mjs` is what the card's Save does with Remember on: `saveAll`, then `recordSavedMany` inside a `try`. If the list fails it returns one line, from `catalogNotUpdated`, and `askWithCard` writes it to stderr; the save succeeds, the card answers Saved, and `set` and `run` carry on. A failing store write still fails the save and does not touch the list. The line repeats the error's code only when it is a plain one (`ENOSPC`, `EACCES`), never the error text. **Tests:** 5 new in `test/cli.test.mjs`, 140 in all and 140 of 140 with `KEYPROMPT_STORE_TEST=1`. Four use a Map store and run on every OS (a file where the folder should be, a `catalog.json` that is not JSON and stays untouched, a working list says nothing and a failing store still fails, the code filter); one drives the real CLI on the real store (opt-in): both cases give exit 0, a 200 from the card, the report on stdout, the line on stderr, and `has` exit 0. 9 wrong versions of `src/cli.mjs` were each caught (try removed, error swallowed with no line, a line when the list is fine, a store failure swallowed too, any code repeated, the error text repeated, the path left out, the line never written, `askWithCard` back to the old two calls). The last two are caught only by the opt-in test, so a plain `npm test` would not catch them and CI does. **Found, not fixed:** B-13, `delete` removes the value, then exits 1 with a raw `unexpected error: ENOTDIR…` if the list cannot be read (reproduced the same way). **Known gaps:** a corrupt `catalog.json` is not repaired, so every later save says the same until the file is fixed or removed, and `keyprompt list` still fails on it; the line is on stderr only, the person sees "Saved" on the card; the end-to-end test was run by hand on macOS only (CI runs it on Linux). |
| S-27 | done 2026-11-07 (PR #30) | Fixes B-13. **Reproduced first**, on main: macOS, a throwaway Keychain item with a random value, `KEYPROMPT_HOME` pointing at a plain file. `keyprompt delete NAME` exited 1 with nothing on stdout and `keyprompt: unexpected error: ENOTDIR: not a directory, open '…/catalog.json'` on stderr, and `has NAME` then exited 3 (the value was deleted). **The change:** `removeAndRecord(store, name)` in `src/cli.mjs` runs `store.remove`, then `recordRemoved` inside a `try`. If the list fails it returns one line from `catalogNotUpdatedAfterDelete`, which `delete` writes to stderr; `delete` keeps its usual stdout line and exit code (0, or 3 for a name that was not saved). A failing store still throws and the list is not touched. The line, `keyprompt: Could not update the list of names (CODE), so "keyprompt list" may still show NAME. The list is …/catalog.json.`, says nothing about the value because the name may never have been saved; the code is there only when it is plain; the error text is never repeated. The code filter is now one helper, `plainCode`, used by this line and S-26's (whose text did not change). **Learned:** (1) `delete` reads the list first and writes it only when the name is on it, so S-26's trick of a file where the folder should be fails the read on macOS and Linux (ENOTDIR) but might be read as "no list yet" where a path through a file reports "not found" (not checked on Windows). These tests put a folder at `catalog.json` (reading it fails with a code) and a `catalog.json` that is not JSON instead, which fail on every OS. (2) A list that cannot be read also changes the result for a name that was never saved: exit 1 with a raw error became exit 3 with the usual "was not saved." line. **Proof:** 5 new tests in `test/cli.test.mjs` (4 with a Map-backed store, on every OS; 1 opt-in on the real CLI and password store, which needs no card and so also runs on Windows); 145 of 145 with `KEYPROMPT_STORE_TEST=1`, 137 pass and 8 skipped without; 12 break-tests each failed at least one test and the diff was empty after every restore, and three of them (line never written, old two calls, exit code changed) only in the opt-in test, so a plain `npm test` would not catch them and CI does; the same repro after the fix gives exit 0, one stderr line, and `has` exit 3. **Limits:** a corrupt `catalog.json` is not repaired (every later delete or save prints a line until the file is fixed or removed, and `keyprompt list` still fails on it); the line is on stderr only; the run by hand is macOS only. |
| S-28 | done 2026-11-07 (PR #31) | Fixes B-4, as Abhishek chose ("Run without it", D-7). **Reproduced first**, on the branch before any code change: the new opt-in test's fake browser pressed Save with every box empty on a `run` card of two optional names, and the card answered 400 ("Paste at least one value."), so `run` could only end by Cancel. **The change:** `CardRequest.allowEmpty` (set only by `run`) lets a submit with no values through `readValues` once every required box has been checked; it answers `200 { remembered: false, receipt }`, ends the card with no values and never calls `onSubmit`, so nothing reaches the store or the list of names. `runCardLine` in `src/cli.mjs` tells the agent `keyprompt: A and B were left empty on the card, so keyprompt gives the command no value for them.` The page skips the key's trip into the vault when every box is empty and ends with the title "Left empty", the new mood `skipped` ("Nothing was saved. The command gets no value from this card.", the plain pose by the shut vault), the receipt, no masking sentence and no footer. `set` and `demo` are unchanged: an empty `set` card still answers 400. PRD (D-7, buddy table now 12 rows), README, skill and `--help` say the same. **Learned:** (1) B-4 was bigger than logged: a card shows only the names not saved yet, so `run API_KEY,ORG_ID:optional` with `API_KEY` saved was such a card, and it came back on every run. (2) `run` copies the agent's whole environment, so the PRD's "simply absent from the command's environment" was not true when the agent already has the variable; the PRD line is corrected and the new line says what keyprompt does ("gives the command no value"), not "not set". (3) The Save button says "Save all N" even when optional boxes stay empty; logged as B-14, not fixed here. **Proof:** 5 new tests (2 in `test/card-server.test.mjs`, 1 in `test/card-script.test.mjs`, 2 in `test/cli.test.mjs`: `runCardLine` and an opt-in end-to-end run on the real CLI and password store with a fake browser, which also checks `set` still refuses) and 3 changed (the 400 test now says it is for `set`; `test/buddy.test.mjs` counts 12 moods and lists `skipped` as still); 150 of 150 with `KEYPROMPT_STORE_TEST=1`, 141 pass and 9 skipped without; 16 break-tests each failed at least one test and the diff was empty after every restore, two of them (`run` not passing `allowEmpty`, `askWithCard` dropping it) only in the opt-in test, so CI catches them and a plain `npm test` does not. By hand in Chrome (agent-browser): two real `run` cards, one with two shown boxes in light with Remember ticked and one with a hidden box in dark with Remember unticked; each ended "Left empty" with the `skipped` pose and no footer, the command exited 0 and saw neither name, stderr carried the line (plural, then singular), `has` exited 3 for both names, no `catalog.json` was written, and no `KEYPROMPT_TEST_` item was left in the Keychain. **Limits:** the `skipped` pose adds no drawing (a new one is Abhishek's call); the by-hand check is macOS and Chrome only; the end-to-end test runs on macOS and Ubuntu, not Windows (its fake browser is a `#!` script); the "Save all N" label is unchanged (B-14). |
| S-29 | done 2026-11-07 (PR #32) | **Published:** keyprompt@0.2.1 is on npm (2026-11-06 21:07:23 UTC, which is 2026-11-07 02:37 IST), with `latest` on it. It came from 29c70b2, the PR head CI tested (run 42292338017, 6 of 6). Its shasum, 5a5d29a668ec0075ca2c208102597b3f322c83a5, is the dry run's (27 files, 45.9 kB). `npx -y --cache <empty folder> keyprompt@latest --version`, run in an empty folder, printed 0.2.1. **Route:** the one S-17 found. npm was already logged in as abhishekshar649; `printf '\n' | script -q /dev/null npm publish --access public --auth-type=web` printed an approval link, Abhishek approved it with Touch ID, and no password or code passed through the session. npm answered "being processed" at the upload and `latest` flipped about 80 seconds later (0.2.0 took about 2.5 minutes). **The go:** asked and given before the publish, after CI was green and after npm's live state (`latest` 0.2.0) was read. **Break-tests:** the CHANGELOG-matches-version guard, broken 3 ways (heading back to "Unreleased", heading naming another version, `package.json` moved alone): all 3 failed that test. **Ships with** B-8 and B-14 open. **After the merge:** tag `v0.2.1` on the squash commit once `npm pack` there gives the same shasum, then the GitHub release; both need Abhishek's go. |
| S-30 | done 2026-11-07 (PR #33) | Fixes B-14, as Abhishek chose ("Plain 'Save' if any box optional", D-8). **Before:** the old test pinned "Save all 3" on a card whose third box is optional, and S-28 had seen "Save all 2" in Chrome on a card of two optional boxes; the label counted boxes, not the ones that would be filled. **The change:** `renderCard` (`src/card-page.mjs`) says "Save" when any box is optional, "Save all N" when several boxes must all be filled, and "Save securely" for one required box; the Replace labels are untouched. A lone optional box says "Save" too, because on `run` it may be left empty. The PRD sketch shows `[Save]` with a one-line rule and D-8; the CHANGELOG has a new Unreleased section. **Tests:** the multi-field test expects "Save" and no "Save all", and a new test pins three cases (all required, one optional among two, a lone optional box). **Break-tests:** 3 of 3 caught (old logic back: 2 tests fail; plain "Save" on every card: 2 fail; a lone optional box ignored: 1 fails). **Proof:** 151 of 151 with `KEYPROMPT_STORE_TEST=1` (142 pass, 9 skipped plain); the demo card, which has an optional box, in headless Chromium in light and dark: the button reads "Save" and nothing shifts. Not looked at in Chrome by hand. **Learned:** the README's two demo pictures show "Save all 3" and are pinned to an older commit, so they no longer match `keyprompt demo`: logged as B-15, to be retaken after S-31. |

---

### S-1 — Plan docs and project rules

**PR:** one.
**Depends on:** nothing.
**Blocks:** every other step.
**Research:** deep · R-5 answered (four teardowns, 2026-11-05).
**Model:** opus — planning and splitting work (section 14).
**Confidence:** 0.8 — grounded in the code read on 2026-11-05 and source-level teardowns; goal frozen, D-2 and D-4 decided by Abhishek the same day.
**Files:** `.claude/CLAUDE.md`, `docs/prd/card-v2.md`, `docs/steps.md`, `docs/research.md`, `docs/bugs.md`.
**Today:** no plan, no project rules file.
**Change:** add the five files. No code changes.
**Acceptance:** WHEN a fresh Sonnet session opens the repo THEN it SHALL find the rules, the plan and a next step it can build without asking anything.
**Verify:** `npm test` passes (docs only). Every backticked path in the five files exists.
**Must not:** change any file under `src/`, `test/`, `bin/` or `skill/`.

---

### S-2 — Split the card page into page, style and script (no visible change)

**PR:** one.
**Depends on:** S-1.
**Blocks:** S-4.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.9 — a pure move of text, checked by a byte-for-byte diff.
**Files:** `src/card-page.mjs`; new: src/card-style.mjs, src/card-script.mjs.
**Today:** `src/card-page.mjs` holds the HTML, the CSS (lines 46–102) and the browser script (lines 142–218) in one template string.
**Change:** move the CSS text into `export function cardStyle()` in src/card-style.mjs and the browser script into `export function cardScript()` in src/card-script.mjs, each returning exactly the text it replaces. `renderCard` puts them back in the same places. The HTML output must not change by a single byte.
**Acceptance:** WHEN `renderCard` is called with the same options and nonce before and after this step THEN the two outputs SHALL be byte-identical.
**Verify:**
```
node --input-type=module -e "import {renderCard} from './src/card-page.mjs'; process.stdout.write(renderCard({name:'A',reason:'r',requester:'q',storeLabel:'s',replacing:false,allowSessionOnly:true,nonce:'n'}))" > before.html
# make the change, then the same command into after.html
diff before.html after.html && echo IDENTICAL; rm before.html after.html
npm test
```
A pass prints IDENTICAL and all tests pass.
**Must not:** change any text, attribute or order in the page; touch `src/card-server.mjs`.

---

### S-3 — Parse field hints: `NAME:visible:multiline:optional`

**PR:** one.
**Depends on:** S-1.
**Blocks:** S-4, S-5, S-6.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.9 — a pure function with its own tests.
**Files:** `src/names.mjs`, `test/names.test.mjs`.
**Today:** `parseNames` (`src/names.mjs:25-36`) splits comma lists, checks `NAME_PATTERN` and removes duplicates. Hints don't exist.
**Change:** add `export function parseFields(parts)` returning `{ name, visible, multiline, optional }[]`:
- Each comma-separated item is `NAME` followed by zero or more `:hint`. Hints: `visible`, `multiline`, `optional`.
- An unknown hint throws `KeypromptError('Unknown hint "x" on NAME. Use visible, multiline or optional.', { exitCode: EXIT.USAGE })`.
- The same name twice gives one entry; its hints are combined.
- More than 12 names throws a usage error: "A card can ask for at most 12 values at once."
- `parseNames(parts)` becomes `parseFields(parts).map((f) => f.name)`.
**Acceptance:** WHEN `parseFields(['A:visible,B:multiline:optional', 'A'])` runs THEN it SHALL return `[{name:'A',visible:true,multiline:false,optional:false},{name:'B',visible:false,multiline:true,optional:true}]`; WHEN a hint is unknown THEN it SHALL throw with exit code 2.
**Verify:** `node --test test/names.test.mjs` — new cases: hints, combining, unknown hint, 13 names, a bad name with a hint (`a:visible`) is still a usage error. Then `npm test`.
**Must not:** change `src/cli.mjs`.

---

### S-4 — One card, many fields (server and page together)

**PR:** one. The page and the server speak one protocol, so neither can be checked without the other.
**Depends on:** S-2, S-3.
**Blocks:** S-5, S-6, S-9, S-11.
**Research:** lookup · R-8 (how to hide a pasted multi-line value; default to option (a)).
**Model:** opus — the card server is on the secret path (section 14).
**Confidence:** 0.75 — protocol and validation are clear; the multi-line paste box is new UI.
**Files:** `src/card-server.mjs`, `src/card-page.mjs`, src/card-script.mjs, src/card-style.mjs, `src/cli.mjs` (only `askWithCard`, so today's single-name calls keep working), `test/card-server.test.mjs`.
**Today:** a card request has one `name`; the page POSTs `{ value, remember }`; the promise resolves `{ remembered, value }`.
**Change:**
- The card request takes `fields: { name, visible, multiline, optional, saved }[]` instead of `name`. `saved: true` means the name is already stored: its box may stay empty ("Saved — leave empty to keep").
- The page draws one row per field: the name as a chip; small tags "shown", "multi-line", "optional"; a `type=text` input for `visible`, a `type=password` input with Show for the default, and for `multiline` a paste box that, once something is pasted, hides it and shows "N lines, M characters pasted" with Show and Clear (R-8 option a).
- Title "Secrets requested" when there is more than one field. Button "Save securely" for one field, "Save all N" for several.
- `POST /submit` takes `{ values: { NAME: string }, remember }`. The server answers 400 if `values` is not a plain object, has a name that wasn't asked for, or has a non-string value. Each value is trimmed at both ends; line breaks inside are kept. A field that is neither optional nor saved and is empty gets `400 { error: 'Fill in NAME.', field: 'NAME' }`. If every box is empty: `400 { error: 'Paste at least one value.' }`. The page focuses and marks the box named in `field`.
- `onSubmit(values, remember)` receives a `Map` of the non-empty values only. The promise resolves `{ remembered, values }`.
- `MAX_BODY_BYTES` goes from 128 KiB to 1 MiB (12 fields of up to 64 KiB each).
- `askWithCard` in `src/cli.mjs` passes `fields: [{ name }]` and reads the one value back, so `set` and `run` behave exactly as before.
**Acceptance:** WHEN a card asks for A (visible), B and C (optional) and the page posts `{ values: { A: 'id', B: 'tok', C: '' } }` THEN `onSubmit` SHALL receive a Map of A → 'id' and B → 'tok', and the page SHALL render A as a `type="text"` input, B as `type="password"`, and C marked optional.
**Verify:** `node --test test/card-server.test.mjs` with new tests: several fields saved together; an unknown name gives 400 and nothing is stored; a missing required field gives 400 naming the field; an empty optional field is left out; the old `{ value }` body gives 400; every existing security test (token, Host, Origin, 415, 410, deadline) still passes. Then `npm test`. Then in a real browser:
```
node --input-type=module -e "import {requestSecretWithCard} from './src/card-server.mjs'; import {openInBrowser} from './src/browser.mjs'; requestSecretWithCard({fields:[{name:'KP_A',visible:true},{name:'KP_B'},{name:'KP_C',multiline:true,optional:true}],reason:'S-4 check',requester:'manual',storeLabel:'nowhere',replacing:false,allowSessionOnly:true,open:openInBrowser,onSubmit:async(v)=>console.error('got names',[...v.keys()])}).then(()=>process.exit(0))"
```
It must print the names only, never values. Check light and dark mode.
**Must not:** weaken any guard in `src/card-server.mjs` (token, Host, Origin, content type, size cap, one-shot, deadline); print or log a value.

---

### S-5 — `keyprompt set` takes several names and saves all or none

**PR:** one.
**Depends on:** S-4.
**Blocks:** S-6, S-10.
**Research:** none.
**Model:** opus — writes to the password store (section 14).
**Confidence:** 0.8 — the rollback logic is straightforward and fully testable with a fake store.
**Files:** `src/cli.mjs`, `src/catalog.mjs`, new src/save.mjs, new test/save.test.mjs, `test/cli.test.mjs`.
**Today:** `set` takes exactly one name (`src/cli.mjs:124-134`).
**Change:**
- `set` takes 1–12 FIELD arguments (`parseFields`). For each, `saved = (await store.read(name)) !== null`. Title "Replace secret" when every field is saved.
- New `saveAll(store, values)` in src/save.mjs: for each name in order, remember the old value (`store.read`), then `store.write`. If a write fails, undo every earlier name (write the old value back, or `store.remove` if there was none), then throw `KeypromptError('Could not save NAME: <reason>. Nothing was changed.')`. If an undo fails too, the message lists the names that may be in a mixed state.
- `src/catalog.mjs` gets `recordSavedMany(names, { reason, store })`: one write after every value succeeded.
- stdout: `Saved A and B in the macOS Keychain (replaced B). The values were not shown here.` then `Use them with: keyprompt run A,B -- <command>`.
**Acceptance:** WHEN the second of three writes fails THEN the store SHALL hold exactly what it held before, and the card SHALL show the error.
**Verify:** `node --test test/save.test.mjs` with an in-memory fake store whose `write` throws for a chosen name: all succeed; failure on the 2nd of 3 when the 1st was new (1st removed); when the 1st existed (old value back); an undo that also fails (message names both). Then `npm test`. Then on macOS: `node bin/keyprompt.mjs set KP_TRY_A:visible KP_TRY_B`, save, `node bin/keyprompt.mjs list` shows both, then delete both.
**Must not:** print a value; change `run`.

---

### S-6 — `keyprompt run` asks for every missing value in one card

**PR:** one.
**Depends on:** S-5.
**Blocks:** S-10.
**Research:** none.
**Model:** sonnet — it only decides which names go on the card; saving reuses S-5's `saveAll`.
**Confidence:** 0.85.
**Files:** `src/cli.mjs`, new src/collect.mjs, new test/collect.test.mjs.
**Today:** `src/cli.mjs:144-158` loops over the names and opens one card per missing name.
**Change:** new `collectSecrets(store, fields, ask)` in src/collect.mjs: read every name; the missing ones go to a single `ask({ fields: missing, allowSessionOnly: true })`; return one Map with every value. Missing optional fields left empty are simply absent. `ask` is passed in (the CLI passes `askWithCard`), so tests use a fake. Do not save in `collectSecrets`: since S-5, `askWithCard` already saves with `saveAll` inside the card's submit when Remember is ticked, which is what lets a failed save show on the card.
**Acceptance:** WHEN `run A,B,C` runs with B and C missing THEN `ask` SHALL be called exactly once with fields B and C, and the returned Map SHALL hold A, B and C.
**Verify:** `node --test test/collect.test.mjs` (fake store, fake ask that counts calls), then `npm test`.
**Must not:** change masking; ask for a name that is already saved.

---

### S-7 — Multi-line values on macOS

**PR:** one.
**Depends on:** S-1.
**Blocks:** S-8.
**Research:** lookup · R-1 answered.
**Model:** opus — writes to the password store.
**Confidence:** 0.8 — `-X` is in this Mac's `security` help; the full round trip runs in this step. (Rewritten during the step: R-1 found `security -i`'s 4,094-byte line limit and B-5; Abhishek chose the two forms below and to fix B-5 here, 2026-11-05.)
**Files:** `src/store/macos.mjs`, `test/store.integration.test.mjs`, `test/macos-parse.test.mjs`.
**Today:** `write` refuses `\r`, `\n` and NUL and hands the value over with `-w "<quoted>"`. A line over 4,095 bytes is cut and its tail runs as its own `security` command (B-5); `maxValueLength` says 65,536.
**Change:** a new exported `addCommand(name, value)` builds the stdin line. A value with `\r` or `\n` goes as `-X <hex>`, where `<hex>` is `Buffer.from(value, 'utf8').toString('hex')`; any other value keeps `-w "<quoted>"`, which fits twice as much. A command over 4,094 bytes (without its line break) is refused before `security` runs, with a message that gives the real room for that name and kind of value. Keep the NUL refusal ("an environment variable cannot hold" one) and the read-back check. `maxValueLength` becomes 4,029, the most that fits on one line even with a one-letter name. In the integration test, add `'line1\nline2'`, a fake PEM block with BEGIN/END lines, and `'a\r\nb'` to the round trip, but only when `process.platform === 'darwin'` (S-8 removes that condition), plus two macOS-only tests: a second line is stored as data, and the longest value that fits saves while one byte more is refused with its tail never run. In `test/macos-parse.test.mjs`, add a hex-form line containing `0A` and unit tests for `addCommand`.
**Acceptance:** WHEN a value with line breaks is written on macOS THEN `read` SHALL return the identical string; WHEN a command would be longer than one `security -i` line THEN the write SHALL be refused before `security` runs.
**Verify:** on macOS `KEYPROMPT_STORE_TEST=1 node --test test/store.integration.test.mjs` passes; `node --test test/macos-parse.test.mjs` passes; CI is green. Write the answer into R-1.
**Must not:** put a value in a process argument (it travels inside the stdin command, as today); change the Linux or Windows stores.

---

### S-8 — Multi-line values on Linux and Windows

**PR:** one.
**Depends on:** S-7.
**Blocks:** nothing (A3 is macOS; this widens it).
**Research:** lookup · R-3 — the CI run in this step answers it.
**Model:** sonnet.
**Confidence:** 0.5 — not ready to write a fix, ready to run the experiment. First push only the test change (remove the darwin-only condition on `values` in the round-trip test; the two `onMac` tests are about `security -i` and stay macOS-only) and read CI. If Linux and Windows pass, record R-3 and stop: done. If one fails, file a bug with the CI log, fix it here only if the fix is in that one store file, otherwise stop and report.
**Files:** `test/store.integration.test.mjs`; maybe `src/store/linux.mjs` or `src/store/windows.mjs`.
**Acceptance:** WHEN CI runs the store round trip on Ubuntu, macOS and Windows THEN multi-line values SHALL round-trip exactly, or that store SHALL refuse them with a clear message — never save them changed.
**Verify:** CI green on all six jobs; R-3 answered with the CI run link.
**Must not:** loosen a test to make it pass.

---

### S-9 — The "Later" button (exit 6)

**PR:** one.
**Depends on:** S-4.
**Blocks:** S-10.
**Research:** none.
**Model:** opus — new card server endpoint.
**Confidence:** 0.85.
**Files:** `src/errors.mjs`, `src/card-server.mjs`, `src/card-page.mjs`, src/card-script.mjs, `src/cli.mjs`, `test/card-server.test.mjs`.
**Change:**
- `EXIT.DEFERRED = 6`.
- `POST /card/<token>/later`, with every check `/cancel` has (Host, Origin, content type). It answers 200, then the card promise rejects with `KeypromptError('The person chose Later for A, B. Nothing was saved.', { exitCode: EXIT.DEFERRED })`.
- The card gets a **Later** button left of Cancel. The page ends on "Okay, later. Nothing was saved."
- For `set`: that message on stderr, exit 6. For `run`: the command is not started; stderr says `keyprompt: the person chose Later for A, B. Nothing was saved and <command> did not run. Carry on with work that does not need these; ask again only when you are about to use them.`; exit 6.
**Acceptance:** WHEN the person clicks Later THEN keyprompt SHALL exit 6, store nothing, and for `run` not start the command.
**Verify:** card server tests: POST `/later` → the promise rejects with exit code 6 and nothing is stored; `/later` from a foreign Origin → 403. Then `npm test`.
**Must not:** re-open the card on its own or retry anything.

---

### S-10 — Teach agents and people the new card

**PR:** one.
**Depends on:** S-5, S-6, S-9.
**Blocks:** S-16.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.9.
**Files:** `skill/SKILL.md`, `src/cli.mjs` (the `HELP` text only), `README.md`, `test/cli.test.mjs`.
**Change:**
- `skill/SKILL.md`: one card for everything you need *right now* (never ask for keys you don't need yet); the FIELD grammar with a Twilio example; "hints change the look, every value is still masked"; on exit 6, tell the user in one line, continue other work, and ask again only when about to use it — never re-ask straight away.
- `HELP`: the FIELD grammar, `demo` (once S-11 lands; otherwise leave it out), and exit code 6.
- `README.md`: usage with several fields; an exit-code table 0–6.
- After merging, run `node bin/keyprompt.mjs install-skill` so the local Claude Code skill is current.
**Acceptance:** WHEN `keyprompt --help` runs THEN it SHALL show the FIELD grammar and exit code 6.
**Verify:** `test/cli.test.mjs` asserts the help contains `visible`, `multiline`, `optional` and `6`. Then `npm test`.
**Must not:** describe anything that isn't merged.

---

### S-11 — `keyprompt demo`: see the card without saving anything

**PR:** one.
**Depends on:** S-4. Approved (D-4, 2026-11-05).
**Blocks:** S-12.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.85.
**Files:** `src/cli.mjs`, `src/card-server.mjs` (pass a `demo` flag to the page), `src/card-page.mjs`, `test/cli.test.mjs`, `test/card-server.test.mjs`.
**Change:**
- New verb `demo`. It never calls `getStore()` or the catalog.
- Fields: `DEMO_API_KEY`, `DEMO_ACCOUNT_ID:visible`, `DEMO_PRIVATE_KEY:multiline:optional`.
- Reason: "A demo of the keyprompt card. Nothing you type here is saved." Requester: "keyprompt demo". Store label: "nowhere (demo)".
- The page shows a banner "Demo — nothing you type is saved."
- On submit, Later or Cancel it prints the outcome ("Demo finished. Nothing was saved.") and exits 0.
- Put the request in an exported `demoRequest()` so a test can check it.
**Acceptance:** WHEN `keyprompt demo` runs and the form is submitted THEN nothing SHALL be written to the store or the catalog.
**Verify:** a test passes `demoRequest()`'s `onSubmit` a store whose every method throws, and it must not throw. `test/card-server.test.mjs`: a demo card's page contains the banner. Manual: `node bin/keyprompt.mjs demo`.
**Must not:** touch the store or the catalog.

---

### S-12 — The buddy: an original creature, still poses

**PR:** one.
**Depends on:** S-11. Decision D-2 is made: the creature is **Pinguu**, a penguin who keeps keys in an ice vault.
**Blocks:** S-13, S-14.
**Research:** none.
**Model:** opus or fable — drawing a good character in SVG is design judgment. Load the `impeccable` or `design-taste-frontend` skill.
**Confidence:** 0.7 — the wiring is simple; the art quality is the risk. Show Abhishek the poses before merging.
**Note:** the caption table in the PRD is written about the card, not in Pinguu's voice. If Abhishek wants Pinguu to speak in the first person ("I'm not looking"), that is a copy change in this step; every line must still be literally true (invariant 9). **Demo (S-11):** in a demo card the `{store}` captions ("It goes to your {store}…", "Locked in your {store}.") are false, because its store label is "nowhere (demo)" and nothing is saved. Give demo its own captions (for example "Demo: nothing you type is saved."); the page marks it with `data-demo` on `main.card`, and `card-script.mjs` already has a `demo` constant.
**Files:** new src/buddy.mjs (exports `buddySvg()`, `buddyStyle()`, `MOODS`), `src/card-page.mjs`, src/card-script.mjs, src/card-style.mjs, new test/buddy.test.mjs.
**Change:**
- One inline SVG under 8 KB with a `viewBox`. Colours come from the page's CSS variables (light and dark). Named groups for body, eyes, lids, arms, key, vault door, envelope, note and zzz.
- `data-mood` on the `.buddy` element shows the right parts through CSS. No animation yet.
- The card script sets the mood. `listening` on load; `peek-proof` while a hidden box has focus; `watching` while a shown box has focus; `stashing` while a submit is pending. On the outcome: `locked` (saved), `one-run`, `later`, `bye`, `asleep`, `oops`, or `closed`.
- A caption under the creature (`aria-live="polite"`) with the exact strings from the PRD table.
- In demo mode only: a row of buttons to preview every mood.
**Acceptance:** WHEN the card is in each of the 11 moods THEN the creature SHALL show that mood's pose and its PRD caption, in light and dark mode.
**Verify:** `node --test test/buddy.test.mjs` checks:
- `MOODS` equals the PRD list.
- The SVG contains no `<script`, no `<image`, and no `http` reference.
- The served page still sends `default-src 'none'`.

Then `npm test`. Manual: `node bin/keyprompt.mjs demo`, click every mood, screenshot light and dark.
**Also:** the shown name comes from one constant, `export const BUDDY_NAME = 'Pinguu'` in src/buddy.mjs. No other file spells the name, so a rename is one line (R-4). *(Removed in S-22: the penguin has no name now.)*
**Must not:**
- Load anything from outside the page, or add an animation library.
- Let Pinguu react to what was typed or how long it is.
- Copy or echo Pingu's look or sounds: no black-and-white claymation emperor penguin with an orange beak, no "noot noot".

Pinguu is our own design: flat vector shapes, rounded, a key-shaped head tuft and a scarf, colours from the card's palette.

---

### S-13 — The buddy moves

**PR:** one.
**Depends on:** S-12.
**Blocks:** S-14.
**Research:** none.
**Model:** sonnet with the `design-motion-principles` skill (opus if the motion looks wrong to Abhishek).
**Confidence:** 0.8.
**Note (S-12):** `buddyStyle()` already sets still transforms on `.eyes` (where the buddy looks), `.pg` (the tilt in `asleep` and `oops`) and `.dial` (`locked`). A CSS animation on an element's `transform` replaces its still transform while it runs, so animate an inner group, or repeat the still transform inside the keyframes. The parts to move are the named groups in `buddySvg()`: `pg` (the whole penguin), `body`, `eyes`, `arms`, `key`, `door`, `door-open`, `dial`, `envelope`, `note`, `sign`, `sparkle`, `zzz`.
**Files:** src/buddy.mjs, src/card-script.mjs, test/buddy.test.mjs.
**Change:**
- One CSS keyframe set per mood:
  - `listening`: slow bob, 2.4 s loop
  - `peek-proof`: arms up, 200 ms
  - `stashing` → `locked`: the key travels into the vault (600 ms), the door shuts (250 ms), the dial spins (400 ms)
  - `one-run`: the envelope is handed over (600 ms), then fades
  - `later`: the note lands, 300 ms
  - `bye`: waves twice
  - `asleep`: zzz loop
  - `oops`: head shake, 300 ms
- Only `transform` and `opacity` animate.
- `@media (prefers-reduced-motion: reduce)` sets all animation to none.
- The done screen waits for the stash animation, but never more than 1.2 s.
**Acceptance:** WHEN the computer prefers reduced motion THEN nothing SHALL animate; WHEN a save succeeds THEN the done screen SHALL appear within 1.5 s of the server's answer.
**Verify:** test/buddy.test.mjs asserts the style has a reduced-motion block setting `animation: none`. Manual: macOS Settings → Accessibility → Display → Reduce motion, on and off, with `node bin/keyprompt.mjs demo`.
**Must not:** animate width, height, top or left; loop anything except `listening` and `asleep`.

---

### S-14 — Honest receipt and a visible deadline

**PR:** one.
**Depends on:** S-12 (S-13 is optional; the receipt works without motion); B-6 fixed (S-20). Since S-20 the server waits for a save that is under way at the deadline and answers it, so at zero the page must keep waiting for a pending Save's answer instead of saying "This card timed out. Nothing was saved."
**Blocks:** S-16.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.85.
**Note (S-11):** in a demo card nothing is saved, so the receipt line "Saved in your {store}" would be false there. A demo keeps its own finish screen (`main.card[data-demo]`); do not replace it with the receipt. Since S-12 that screen is the title "Demo finished", the `locked` pose and the caption "Nothing was saved. This is how a real save looks."
**Note (S-12):** the done screen is now the card header (the `<h1>` becomes the outcome title, the buddy shows the pose and the caption) plus `#done-view`, which holds only "You can close this tab." The receipt list goes into `#done-view`. At zero, call the script's `finish('Timed out', 'asleep')` path or its equivalent, so `asleep` and its caption appear; until then `asleep` can only be seen through the demo's preview buttons.
**Note (S-13):** after a successful Save the script waits up to `STASH_MS` (600 ms, from src/buddy.mjs) for the key's trip before `finish(...)`, and not at all with reduced motion (`settle` in src/card-script.mjs). A receipt filled in by `finish` appears after that wait. The countdown must not call the `asleep` finish during that wait, because the save has already been answered.
**Files:** `src/card-server.mjs` (pass `expiresAt` to the page), `src/card-page.mjs`, src/card-script.mjs, `test/card-server.test.mjs`.
**Change:**
- The done screen lists every field and where it went. The wording is "Saved in your {store}", "Handed to this one command, not saved", "Kept the saved value", "Left empty" or "Not saved (Later)".
- Under the list, it says: "keyprompt masks exact copies in that command's output. It cannot stop a command from sending the key elsewhere — see SECURITY.md."
- The footer shows "Card closes in m:ss". At zero the creature goes `asleep`, the form is disabled, and the card says "This card timed out. Nothing was saved."
**Acceptance:** WHEN a card saves A and leaves optional B empty THEN the done screen SHALL say "A — Saved in your {store}" and "B — Left empty".
**Verify:** a test checks the served page carries `expiresAt`. Then `npm test`. Manual in a real browser.
**Must not:** show any value or any part of one.

---

### S-15 — Make the headline true (bugs B-1, B-2)

**PR:** one.
**Depends on:** S-1. The GitHub description change needs Abhishek's yes (it is public).
**Blocks:** S-17.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.95.
**Files:** `README.md`, `package.json`, `SECURITY.md`; the GitHub repo description.
**Change:**
- New one-liner: "Give API keys to AI coding agents without pasting them into the chat. A card opens in your browser, the key goes into your OS keychain, and there is no command that prints it back."
- The README "Why" bullet "Agents use keys, not see them." becomes: "**No command prints a saved key.** `keyprompt run` puts it into one command's environment and masks exact copies in that command's output. A command can still transform or send it; see SECURITY.md."
- `SECURITY.md` "What it does not protect against" gains a plain line (B-2): "The agent itself can read a saved key straight from the OS store (for example with `security find-generic-password` on macOS), because it runs as you. keyprompt's skill tells it not to; nothing stops it."
- After Abhishek's yes: `gh repo edit abhisheksharma001/keyprompt --description "<the one-liner>"`.
**Acceptance:** WHEN `git grep -nE "without ever seeing|not see them|without seeing" -- README.md package.json` runs THEN it SHALL print nothing, and `gh repo view --json description` SHALL show the new line.
**Verify:** the two commands above. Then `npm test`.
**Must not:** weaken any other honest statement in `SECURITY.md`.

---

### S-16 — README, screenshots and 0.2.0

**PR:** one.
**Depends on:** S-10, S-14, S-15, S-22 (the fresh name check is done, R-4 on 2026-11-06, and Abhishek chose to drop the name) and S-23 (so a screenshot of a real card shows a true footer).
**Blocks:** S-17.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.85.
**Files:** `README.md`, new screenshots under `docs/` (made with `keyprompt demo`), new CHANGELOG.md, `package.json` (version 0.2.0).
**Change:** the top of the README shows the new card with the creature and a three-line quick start. CHANGELOG lists 0.2.0. Replace the old screenshots.
**Acceptance:** WHEN someone opens the README THEN the first screen SHALL show the new card and how to install it.
**Verify:** view `README.md` on the branch on GitHub. Then `npm test`.
**Must not:** claim anything that isn't merged.

---

### S-17 — Publish 0.2.0 to npm (owner step)

**PR:** one (tag, release notes, README/skill switch to `npx -y keyprompt`).
**Depends on:** S-16, B-1 fixed, CI green, **Abhishek's explicit go** — publishing is public and permanent.
**Blocks:** Phase B (sharing).
**Research:** lookup · R-7 (re-check the name right before).
**Model:** sonnet.
**Confidence:** 0.85.
**Files:** `package.json` (`files`), `README.md`, `skill/SKILL.md`, `CHANGELOG.md`, `test/cli.test.mjs`, `docs/research.md` (R-7), `docs/steps.md`.
**Change:** Abhishek logs in (`! npm login`). Run `npm publish --dry-run`, review the file list, then `npm publish`. Tag `v0.2.0` and create a GitHub release. The README (both install blocks: the quick start at the top and "Install") and `skill/SKILL.md` switch from `npx -y github:abhisheksharma001/keyprompt` to `npx -y keyprompt`. Put the date on the 0.2.0 heading in `CHANGELOG.md` (it says "unreleased" until then). Found in S-16: `files` in `package.json` lists neither `docs/` nor `CHANGELOG.md`, so the package carries the README without its pictures; after the dry run, look at how the README's pictures would show on the npm page, and fix it (absolute picture links, or add the two pictures to `files`) before the publish.
**Acceptance:** WHEN someone runs `npx -y keyprompt --version` on a clean machine THEN it SHALL print 0.2.0.
**Verify:** that command, in a temp folder.
**Must not:** publish without the go; publish with CI red; publish files outside `package.json` `files`.

---

## Lite wins from the competitor teardowns (R-5) — approved 2026-11-05

### S-18 — Masking also catches encoded copies

**PR:** one.
**Depends on:** S-1 (independent of the card work).
**Blocks:** nothing.
**Research:** lookup — AgentSecrets does this (`commands/env.go:220-329` at commit be53766, MIT). Read it for ideas only; write our own.
**Model:** opus — this is the masking boundary.
**Confidence:** 0.75 — easy to add; the risk is false matches on very short values.
**Files:** `src/redact.mjs`, `test/redact.test.mjs`, `SECURITY.md`. Added while building, because their text would otherwise become false (invariant 9) or the acceptance needed a check at the `run` level: `test/run.test.mjs`, `README.md`, `skill/SKILL.md`, `CHANGELOG.md`, `docs/prd/card-v2.md` (the comparison table), `docs/bugs.md` (B-12), `docs/steps.md`.
**Today:** only exact copies are masked (`src/redact.mjs:10-11`).
**Change:**
- For each value of 8 or more characters, also mask its base64 (with and without padding), base64url, lowercase hex, and URL-encoded forms. A JSON-escaped form is added too, but only when it differs from the raw value.
- The label stays `[keyprompt:NAME]`.
- Values under 8 characters keep exact-only masking.
- `SECURITY.md` says exactly which forms are caught and that any other transformation still escapes.
**Acceptance:** WHEN a command prints the base64 of a saved value THEN the output SHALL show `[keyprompt:NAME]` instead.
**Verify:** `node --test test/redact.test.mjs`, with new cases for each form, a form split across chunks, and a short value that is not variant-masked. Commit first, then prove it by breaking it: remove the variants and watch exactly the new tests fail.
**Must not:** slow ordinary output noticeably (keep the per-position scan); claim in docs that transformed copies are caught in general.

### S-19 — Refuse a saved key pasted into a command

**PR:** one.
**Depends on:** S-1.
**Blocks:** nothing.
**Research:** none — Secretless AI does the same (secretless-ai src/commands/run.ts:66-79 at commit f2568f1, Apache-2.0); idea only.
**Model:** sonnet.
**Confidence:** 0.85.
**Files:** `src/cli.mjs` (the `run` branch), `test/cli.test.mjs`, `CHANGELOG.md` (an Unreleased line).
**Change:** before starting the command, if any secret value (8+ characters) appears inside any argument after `--`, refuse with exit 2: "The value of NAME appears in the command itself, so keyprompt did not start it. Leave it out: the command gets it in its environment as $NAME (see keyprompt --help)." The message never shows the value. (Built as above; the first draft said "A saved value", which is untrue for a value given for this run only.)
**Acceptance:** WHEN `run A -- echo <A's value>` runs THEN keyprompt SHALL exit 2 without starting the command.
**Verify:** a CLI test with a fake value, plus `npm test`.
**Must not:** print the value or any part of it.

---

## Fixes

### S-20 — Cancel and the deadline wait for a save under way (bug B-6)

**PR:** one.
**Depends on:** S-9 (its `/later` already answers 409 during a save). Abhishek queued it next on 2026-11-06.
**Blocks:** S-14.
**Research:** none.
**Model:** opus — it changes how the card server ends.
**Confidence:** 0.85 — the server change is small and each guard has a test; the page's Cancel is checked in a real browser with two tabs, not by a test.
**Files:** `src/card-server.mjs`, `src/card-script.mjs`, `test/card-server.test.mjs`, `docs/bugs.md`.
**Today:** `/cancel` and the deadline timer end the card at once, even while `onSubmit` is saving. The save goes on, so the agent gets exit 4 "closed the secret card without saving" or exit 5 "Nobody filled in the secret card in time" about a key that is stored (B-6). The page's Cancel ignores the server's answer and always says "Cancelled. Nothing was saved."
**Change:**
- The deadline timer, when a save is under way, marks the card expired and waits. That save decides: success resolves the card as saved; failure ends it with the save's own error (a non-`KeypromptError` becomes "Could not save. Try again."), and the page gets `422 { error, final: true }`.
- `/cancel` during a save answers `409 { error: 'Already saving. Wait a moment.' }`, as `/later` does.
- Once a body has arrived, the server checks again whether the card has ended; if it has, it answers 410 and nothing runs.
- The page's Cancel reads the answer: 200 → "Cancelled. Nothing was saved."; an error → show it and stay ("Closed" when the answer says final); no answer at all → "Closed", "This card is no longer active. You can close this tab.", because the page cannot know whether another tab saved.
**Acceptance:** WHEN the deadline passes or Cancel arrives while a save is under way THEN the card SHALL end only when that save ends, and SHALL report that save's real result.
**Verify:** `node --test --test-timeout=15000 test/card-server.test.mjs` with new tests: Cancel during a save gives 409 and the save's result stands; the deadline during a save that succeeds resolves the card; the deadline during a save that fails rejects with that error and a final 422; a body still arriving at the deadline gets 410 and is never saved. Commit, then break each guard and watch its test fail. In a real browser, two tabs of one card with a slow fake save: tab 1 saves, tab 2's Cancel shows "Already saving. Wait a moment."; after the save, tab 2's Cancel shows "Closed". Then `npm test`.
**Must not:** weaken any card guard; make the card wait on anything but a save it already accepted; change what `/later` does.

---

### S-21 — An ended card says one sentence that is true for every ending (bug B-7)

**PR:** one.
**Depends on:** nothing. B-7 is logged, and S-14 shrank its window but did not close it. Abhishek said "next" on 2026-11-06 with S-14 merged.
**Blocks:** nothing.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.95 — B-7 was reproduced; the change is one sentence in four places, and each place gets a test.
**Files:** `src/card-server.mjs`, `src/buddy.mjs`, `src/card-script.mjs`, `docs/prd/card-v2.md`, `docs/bugs.md`, `test/card-server.test.mjs`, `test/card-script.test.mjs`.
**Today:** once a card has ended (saved, Cancel, Later or the deadline), any later request gets `410 { error: 'This card was already used. Close this tab.', final: true }`, and the page shows the buddy's `closed` pose with "This card was already used. You can close this tab." After a timeout, or when another tab saved, that is false or unknown: the page cannot tell why the card ended (invariant 9).
**Change:**
- The server's 410 text (both places: a request that arrives after the card ended, and a body that finished arriving after it ended) becomes "This card is no longer active. Close this tab." `final: true` and the status stay.
- The `closed` caption becomes "This card is no longer active. You can close this tab." in `src/buddy.mjs` and in the PRD buddy table, whose row is renamed "Card no longer active" (and A5's list says "no longer active" instead of "already used"). The PRD's note about Cancel getting no answer now explains why the caption claims nothing about how the card ended.
- The page's Cancel, when it gets no answer, no longer carries its own copy of the sentence: it uses the `closed` caption, so the words live in one place.
**Acceptance:** WHEN a card has ended (saved, cancelled, Later or timed out) and a request reaches it THEN the server SHALL answer 410 "This card is no longer active. Close this tab." and the page SHALL show the `closed` pose with "This card is no longer active. You can close this tab."
**Verify:** `node --test --test-timeout=15000 test/card-server.test.mjs test/card-script.test.mjs test/buddy.test.mjs` with new tests: the 410 text after each of the four endings, and for a body still arriving at the deadline; the page shows the `closed` caption for a final 410 and for a Cancel that gets no answer. Commit, then break each place (server site 1, server site 2, caption, the page's own copy) and watch a test fail. Then `npm test`; `git grep -n "already used" -- src test` prints nothing.
**Must not:** change when a card ends, the status codes, `final: true`, or any other message; touch B-8; add a dependency.

---

### S-22 — Drop the mascot's name (decision R-4)

**PR:** one.
**Depends on:** nothing. Abhishek chose "Drop the name" on 2026-11-06 after the fresh R-4 check below.
**Blocks:** S-16 (its screenshots show the demo card's preview row, which names the penguin) and S-17.
**Research:** none. R-4 was re-checked on 2026-11-06 (evidence below).
**Model:** sonnet.
**Confidence:** 0.95 — one constant with three uses; the only test that mentions it is named below.
**Files:** `src/buddy.mjs`, `src/card-page.mjs`, `test/buddy.test.mjs`, `docs/prd/card-v2.md`, `docs/research.md`, `docs/steps.md`.
**Today:** `BUDDY_NAME = 'Pinguu'` in `src/buddy.mjs`; the demo card's preview row reads "Pinguu's poses:" and its group label "Preview Pinguu's poses". No other text a person sees names the penguin: not the README, the npm page, the skill or a real card. `test/buddy.test.mjs` ("only src/buddy.mjs spells the buddy's name") keeps the name in that one file.
**Change:**
- Remove `BUDDY_NAME`. The demo row says "The penguin's poses:" and its label "Preview the penguin's poses" (written out in `src/card-page.mjs`, still escaped by the same helper).
- The name test becomes a guard that the old name is gone: no `.mjs` file under `src/` spells "Pingu" (case-insensitive).
- `docs/prd/card-v2.md` (the playback list, "The buddy" section, decision D-2) says the penguin is unnamed since 2026-11-06 and why; `docs/research.md` R-4 gets the answer below and the status "decided 2026-11-06: no name".
**Acceptance:** WHEN someone opens the demo card THEN no text on it SHALL name the penguin, and `git grep -n -i pingu -- src README.md package.json skill` SHALL print nothing.
**Verify:** `node --test --test-timeout=15000 test/buddy.test.mjs test/card-server.test.mjs`, then `npm test`. Commit, then put "Pinguu" back in `src/card-page.mjs` and watch the guard fail. Look at the demo card (`node bin/keyprompt.mjs demo`) in light and dark.
**Must not:** change a pose, a caption or the look of the penguin; touch the footer (S-23); add a dependency.

**R-4 re-check, 2026-11-06 (not legal advice):**
- PINGU, US application 99410827, owner Joker, Inc. (Mattel's attorney), toys and games (class 28). Notice of allowance 12 May 2026; statement-of-use deadline **12 Nov 2026**. trademarkia.com/pingu-99410827, read 2026-11-06, live.
- Mattel opposes look-alike marks: it filed against HIJARBIE (Barbie) on 2026-09-01. ttabvue.uspto.gov/ttabvue/ttabvue-91310048-OPP-1.pdf, cached 2026-10-11. The earlier Pingu-specific one is PINU (TTAB 91303787, in R-4).
- Japan's patent office dismissed Joker's opposition to "pingu・pongu" on 2026-05-22, a compound word, so it says little about "Pinguu". blog.marks-iplaw.jp/2026/06/05/pingu-vs-pingu-pongu, cached 2026-08-02.
- Keenable searches for "Pinguu" trademark and Mattel action on 2026-11-06 found nothing new. Weak evidence: the USPTO's own search cannot be queried with the tools used here.
- Judgment: the name appears in one visible place and costs one line to drop, and the risk rises with popularity and with publication on npm, so it goes.

---

### S-23 — The card footer says only what is true (bugs B-9 and B-10)

**PR:** one.
**Depends on:** nothing. Abhishek chose the wording on 2026-11-06 ("Say only what is true").
**Blocks:** S-16 (a README screenshot of a real card must show a true footer) and S-17.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.9 — the wording is decided; each ending has a test, and the page was checked in a real browser.
**Files:** `src/card-page.mjs`, `src/card-script.mjs`, `docs/prd/card-v2.md`, `test/card-script.test.mjs`, `test/card-server.test.mjs`, `docs/steps.md`, `docs/bugs.md`.
**Today:** every real card ends with "Stored in your {store} · never shown to your agent"; with Remember unticked, "Held for this one command only · never shown to your agent". After Cancel, Later, a timeout or a closed card the footer still names the store (B-9), and "never shown to your agent" is a guarantee a command the agent writes can break (B-10, invariant 9).
**Change:**
- The footer's note is "Stored in your {store}" (a demo keeps "Demo · nothing is stored"); with Remember unticked, "Held for this one command only".
- `finish` hides the whole `<footer id="footer">` unless the card ended with a Save, a one-run Save or a demo's pretend save.
- `docs/prd/card-v2.md` gets "The footer" section with the exact texts.
**Acceptance:** WHEN a card ends in Cancel, Later, a timeout, "no longer active" or a final error THEN the page SHALL show no footer, and WHEN a card is open or ended with a Save THEN its footer SHALL read "Stored in your {store}" (or "Held for this one command only" with Remember unticked), and no card text SHALL say the agent never sees a key.
**Verify:** `node --test --test-timeout=15000 test/card-script.test.mjs test/card-server.test.mjs`, then `npm test`. Commit, then break each guard and watch its test fail. A scratch card in Chrome, light and dark: open, untick Remember, Cancel, Later, Save.
**Must not:** change when a card ends, a caption, the receipt, the clock or any server answer; touch B-8 or B-11; add a dependency.

---

### S-24 — `run --no-redact` works only when the output goes straight to a terminal (bug B-11)

**PR:** one.
**Depends on:** nothing. Abhishek chose "Terminal only" on 2026-11-06 from four options: terminal only, a card that asks each time, remove the flag, keep it as documented.
**Blocks:** S-17 (B-11 was to be decided before the npm publish).
**Research:** lookup (done):
- Claude Code's Bash tool gives a command no terminal: `[ -t 1 ]` is false and `process.stdout.isTTY` is undefined (run in Claude Code on macOS, 2026-11-06).
- 1Password's `op run --no-masking` turns masking off with no such check; its docs show it printing a secret (https://www.1password.dev/cli/reference/commands/run, read 2026-11-06, live).
- On macOS, `script -q /dev/null COMMAND` gives COMMAND a terminal (stdout and stderr both TTYs) and passes its exit code through (run here, 2026-11-06). So an agent can get past this check on purpose.

**Model:** sonnet (opus laid out the decision).
**Confidence:** 0.9 — `isTTY` is the same check `src/browser.mjs` already trusts before printing the card link; the refusal has a test on every OS; the terminal path is checked by hand with `script` on macOS, not by a test.
**Files:** `src/cli.mjs`, `test/cli.test.mjs`, `README.md`, `skill/SKILL.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/prd/card-v2.md`, `docs/bugs.md`, `docs/steps.md`, `.claude/CLAUDE.md`.
**Today:** `run --no-redact` hands the command keyprompt's own stdout and stderr, whatever they are. An agent can type `keyprompt run NAME --no-redact -- printenv NAME` and the saved key lands in the chat (B-11, reproduced in S-15). The option exists for full-screen programs, which need a terminal; an agent's shell tool such as Claude Code's has none, so there the option can only leak.
**Change:**
- `run` with `--no-redact` checks that keyprompt's stdout and stderr are both a terminal. If either is not, it stops with exit 2: "--no-redact works only when keyprompt's output goes straight to a terminal, and here it does not. Run the command again without --no-redact; masking stays on." The check runs after the usage checks and before the store is read or a card opens.
- The check is an exported function, `outputIsTerminal(stdout, stderr)`, so a test can hand it fake streams. No environment variable or option skips it: anything that could, an agent could set.
- The words follow: `HELP`, the README (options line, exit code 2), the skill (agents: don't use it), `SECURITY.md` (the `--no-redact` limit, with what it does not stop), `CHANGELOG.md` (0.2.0, Changed), the PRD's command line and decision D-6, and invariant 3 in `.claude/CLAUDE.md`, which now names this one exception.

**Acceptance:** WHEN `keyprompt run NAME --no-redact -- COMMAND` runs with its stdout or stderr not a terminal THEN it SHALL exit 2 with that message, without reading the store, opening a card or starting COMMAND; and WHEN both are a terminal THEN it SHALL behave as before.
**Verify:** `node --test --test-timeout=15000 test/cli.test.mjs` with a new test: `outputIsTerminal` with fake streams (both, only stdout, only stderr, neither), and `run NAME --no-redact -- COMMAND` from a pipe exits 2 with the message, opens no card and starts nothing. The opt-in card test no longer tries `--no-redact` from a pipe (`test/card-server.test.mjs` already covers a card that does not mask). Commit, then break the check (removed, `||` for `&&`, stderr ignored) and watch the new test fail. By hand on macOS with a throwaway Keychain item: from a pipe, exit 2; inside `script -q /dev/null`, the value prints with `--no-redact` and is masked without it. Then `npm test`.
**Must not:** change masking itself, `run` without `--no-redact`, or any card; add a way to skip the check; add a dependency.

### S-25 — Masking finds a key's base64 inside longer base64 (bug B-12)

**PR:** one.
**Depends on:** nothing. Abhishek chose "Shifted pieces" on 2026-11-06 from three options: shifted pieces, decode and check, leave it as documented.
**Blocks:** nothing.
**Research:** lookup (done):
- GitHub Actions masks each secret's base64 also with its first 1 and 2 bytes dropped (Base64StringEscapeShift1 and Base64StringEscapeShift2), with a comment naming `base64(user:password)` as the reason, and switches them on for every secret (lines 103-105 of src/Runner.Common/HostContext.cs). Source: actions/runner at cf65f3e, src/Sdk/DTLogging/Logging/ValueEncoders.cs, read with `gh api`, live, 2026-11-06. Dropping whole bytes leaves up to 2 of them (16 bits) visible; S-25 keeps every character made only of the value's bits, which leaves at most 8 bits.
- Secret scanners decode instead: trufflehog decodes every run of 20 or more base64 characters (pkg/decoders/base64.go at f8221ca), gitleaks every run of 16 or more (detect/codec/encodings.go and base64.go at 5f6ec56), and both then search the decoded text. Read with `gh api`, live, 2026-11-06. For a command's output as it streams, that means holding back every word of letters and digits until it ends, which is why it was not chosen.

**Model:** opus — the masking boundary (B-12).
**Confidence:** 0.9 — a test checks exactly which characters stay in 45 cases (every start and end place in a 3-byte group); the real `curl -v -u` line was run on macOS; the 8-bit bound is arithmetic (6-bit characters over 8-bit bytes).
**Files:** `src/redact.mjs`, `test/redact.test.mjs`, `SECURITY.md`, `README.md`, `skill/SKILL.md`, `CHANGELOG.md`, `docs/prd/card-v2.md` (the comparison table), `docs/bugs.md`, `docs/steps.md`.
**Today:** `copiesOf` masks the value's whole base64. Base64 writes every 3 bytes as 4 characters, so when the text before the value is not a multiple of 3 bytes long (the `apiuser:` in `curl -v -u apiuser:KEY`), every character of the value's base64 changes and nothing is masked. Text after the value can break the match too, depending on the value's length.
**Change:**
- `base64Pieces(bytes)` in `src/redact.mjs`: for each start offset 0, 1 and 2, put that many zero bytes before the value, encode as base64 and as base64url, and keep only the characters whose 6 bits all come from the value: from character ⌈8·offset/6⌉ up to, not including, ⌊8·(offset + length)/6⌋.
- `copiesOf` adds those pieces for a value of 8 or more characters, so a piece is at least 10 characters long. Nothing else in the redactor changes: the same per-position scan, longest copy first, and as before only bytes that could still start a copy are held back.
- The character just before the label and the one just after it can mix the value's bits with the text around it, and they stay: at most 4 bits of the value's first byte and 4 of its last. `SECURITY.md`, the README, the skill and `CHANGELOG.md` say so.

**Acceptance:** WHEN a command started by `keyprompt run` prints the base64 or base64url of a value together with other text before or after it THEN every character made only of the value's bits SHALL be replaced with `[keyprompt:NAME]`.
**Verify:** `node --test --test-timeout=15000 test/redact.test.mjs` with new tests: values of 18, 19 and 20 characters with 5 texts before and 3 after, checking exactly which characters stay; the `curl -v -u apiuser:KEY` line split at every point; base64url at each offset. Commit, then break it (pieces removed, offset 0 only, offsets 0 and 1 only, base64url dropped, a mixed character kept at either end) and watch the new tests fail. By hand on macOS with a throwaway Keychain item: `curl -v -u apiuser:$NAME` through `run`, on main and on the branch. Then `KEYPROMPT_STORE_TEST=1 npm test`.
**Must not:** mask the text around the value; change any other encoded form or the scan; add a dependency.

### S-26 — A failed update of the list of names no longer fails a save that worked (bug B-3)

**PR:** one.
**Depends on:** nothing.
**Blocks:** nothing.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.9 — the bug was reproduced before the fix (the card said "Could not save" for a value that was in the Keychain); the fix has tests on every OS and a real-store test on the CLI; the end-to-end run by hand is macOS only.
**Files:** `src/cli.mjs`, `src/catalog.mjs` (only `catalogPath` is exported, so the line names the file from one place), `test/cli.test.mjs`, `CHANGELOG.md`, `docs/prd/card-v2.md`, `docs/bugs.md`, `docs/steps.md`.
**Today:** the card's Save runs `saveAll` (every value to the OS store) and then `recordSavedMany` (the names to `~/.keyprompt/catalog.json`). If the second fails with anything that is not a `KeypromptError` (a full disk, a folder that cannot be written, a `catalog.json` that is not JSON), the card server answers 422 "Could not save. Try again." for values that are saved, and the agent ends up told "without saving" (B-3).
**Change:**
- `saveAndRecord(store, values, reason)` in `src/cli.mjs`: `saveAll`, then `recordSavedMany` in a `try`. On a failure of the list it returns one line from `catalogNotUpdated(names, storeLabel, error)` and does not throw. A failure of `saveAll` still throws as before.
- `askWithCard` calls it from `onSubmit` and writes any returned line to stderr.
- The line: `keyprompt: Saved A in the macOS Keychain, but could not update the list of names (EACCES), so "keyprompt list" may not show it. The save itself worked. The list is <path>/catalog.json.` The code in brackets is there only when the error has a plain code (`/^[A-Z0-9_]{1,20}$/`); the error text is never repeated.
- `docs/prd/card-v2.md` says so under "Saving: all or nothing". `CHANGELOG.md` gets a Fixed entry.

**Acceptance:** WHEN every value was written to the OS store and the list of names cannot be read or written THEN the card SHALL answer Saved, `set` SHALL exit 0 with its usual report on stdout, and stderr SHALL carry one line saying the values are saved and the list was not updated.
**Verify:** `node --test --test-timeout=15000 test/cli.test.mjs` with new tests: the Map-store ones (a file where the folder should be; a `catalog.json` that is not JSON and is left as it was; a working list says nothing and a failing store still fails without touching the list; the code filter), and the opt-in one on the real CLI. Commit, then break `src/cli.mjs` (try removed, error swallowed, a line when fine, a store failure swallowed, any code repeated, the error text repeated, the path left out, the line never written, `askWithCard` back to the old calls) and watch the tests fail. Then `KEYPROMPT_STORE_TEST=1 npm test`.
**Must not:** change `delete` (B-13), the catalog's format or place, `saveAll`, the card server or the card page; repair or rewrite a corrupt catalog; add a dependency.

### S-27 — A failed update of the list of names no longer fails a delete that worked (bug B-13)

**PR:** one.
**Depends on:** S-26 (the line shares its code filter).
**Blocks:** nothing.
**Research:** none.
**Model:** sonnet.
**Confidence:** 0.9 — the bug was reproduced before the fix (`delete` exited 1 with a raw `ENOTDIR` for a value that was already gone); the fix has tests on every OS and a real-store test on the CLI; the end-to-end run by hand is macOS only.
**Files:** `src/cli.mjs`, `test/cli.test.mjs`, `CHANGELOG.md`, `docs/bugs.md`, `docs/steps.md`.
**Today:** `keyprompt delete NAME` runs `store.remove(name)` and then `recordRemoved(name)`. If the second throws (a `catalog.json` that is not JSON or cannot be read, a folder that cannot be written), `main` prints `keyprompt: unexpected error: …` with the raw error text and exits 1, although the value is already gone (B-13).
**Change:**
- `removeAndRecord(store, name)` in `src/cli.mjs`: `store.remove`, then `recordRemoved` in a `try`. On a failure of the list it returns `{ removed, note }` with one line from `catalogNotUpdatedAfterDelete(name, error)` and does not throw. A failure of `store.remove` still throws and the list is not touched.
- The `delete` command writes `note` to stderr, prints its usual stdout line and returns its usual code (0 when the value was deleted, 3 when it was not saved).
- The line: `keyprompt: Could not update the list of names (EACCES), so "keyprompt list" may still show NAME. The list is <path>/catalog.json.` It says nothing about the value, because the name may never have been saved. The code in brackets is there only when the error has a plain code (`/^[A-Z0-9_]{1,20}$/`); the error text is never repeated.
- The "plain code only" filter moves out of `catalogNotUpdated` into one small `plainCode(error)` helper that both lines use. S-26's line does not change.

**Acceptance:** WHEN the store has removed the value (or had none) and the list of names cannot be read or written THEN `delete` SHALL exit 0 (or 3 for a name that was not saved) with its usual stdout line, and stderr SHALL carry one line saying the list of names was not updated.
**Verify:** `node --test --test-timeout=15000 test/cli.test.mjs` with new tests: the Map-store ones (a folder where `catalog.json` should be; a `catalog.json` that is not JSON, for a saved and a never-saved name, left as it was; a working list says nothing and loses the name, and a failing store still fails and leaves the list alone; the code filter), and the opt-in one on the real CLI. Commit, then break `src/cli.mjs` (try removed, error swallowed, a line when fine, a store failure swallowed, the list touched before the store answers, any code repeated, the error text repeated, the path left out, the line never written, `delete` back to the old calls, the line claiming the delete worked, the exit code changed) and watch the tests fail. Then `KEYPROMPT_STORE_TEST=1 npm test`.
**Must not:** change what `delete` prints or returns when the list works, `recordRemoved`, the catalog's format or place, S-26's line; repair or rewrite a corrupt catalog; add a dependency.

### S-28 — On `run`, Save works with every box empty when every box is optional (bug B-4)

**PR:** one. Server, page, buddy, CLI and docs go together: a server that accepts the empty Save without the page would show "Saved" for nothing, and the old docs lines would be false the moment it merges (invariant 9).
**Depends on:** Abhishek's decision on B-4, given 2026-11-07 ("Run without it", D-7 in the PRD).
**Blocks:** nothing.
**Research:** none.
**Model:** opus — it changes a card server endpoint.
**Confidence:** 0.85 — reproduced before the fix (the card answered 400 and only Cancel ended it); tested at every layer, end to end on the real CLI, and by hand in Chrome in light and dark with Remember ticked and unticked. The new pose is the plain one (no new drawing), which is Abhishek's to judge.
**Files:** `src/card-server.mjs`, `src/cli.mjs`, `src/card-script.mjs`, `src/buddy.mjs`, `test/card-server.test.mjs`, `test/card-script.test.mjs`, `test/buddy.test.mjs`, `test/cli.test.mjs`, `docs/prd/card-v2.md`, `README.md`, `skill/SKILL.md`, `CHANGELOG.md`, `docs/bugs.md`, `docs/steps.md`.
**Today:** `keyprompt run API_KEY,ORG_ID:optional -- COMMAND` with `API_KEY` saved opens a card with only the optional `ORG_ID` box (a card shows only the names not saved yet). Save with it empty answers "Paste at least one value." (`readValues` in `src/card-server.mjs`), so the only way off the card is Cancel (exit 4): the command never starts, and the next run opens the same card again.
**Change:**
- `CardRequest.allowEmpty` in `src/card-server.mjs`. With it, `readValues` lets a submit with no values through. A required box is checked first, so this happens only when every box is optional (or already saved). Such a submit answers `200 { remembered: false, receipt }` (every line "Left empty"), ends the card with no values, and never calls `onSubmit`: nothing reaches the store or the list of names.
- `run` passes `allowEmpty: true` through `askWithCard`. `set` and `demo` do not, so an empty `set` card still answers 400.
- The agent's line after a `run` card moves into `runCardLine(fields, answer, storeLabel)` in `src/cli.mjs`. With no values: `keyprompt: ORG_ID was left empty on the card, so keyprompt gives the command no value for it.` (several: "A and B were … for them"). It does not say "not set": `run` copies the agent's own environment, so a variable already set there stays set. With values the line is what it was.
- The page (`src/card-script.mjs`): when every box is empty (trimmed, as the server trims) Save does not show the key going into the vault and does not wait for that trip. On a 200 it shows the receipt and ends with the title "Left empty" and the mood `skipped`, with no masking sentence (nothing from this card goes to the command) and no footer (B-9: it would name a store the key never reached).
- The mood `skipped` in `src/buddy.mjs`, caption "Nothing was saved. The command gets no value from this card." Its pose is the plain one: the penguin by the shut vault, holding nothing, still.
- Docs: the PRD (D-7; A5; the command-line, protocol, receipt and footer lines; the buddy table, now 12 rows), the README and skill hint tables (the skill told agents never to mark every name `:optional`), and `--help`. The PRD line that an empty optional name is "simply absent from the command's environment" is corrected where it was made.

**Acceptance:** WHEN `run` opens a card whose boxes are all optional and the person presses Save with every box empty THEN the card SHALL end with the title "Left empty" and the `skipped` caption, nothing SHALL be saved or listed, stderr SHALL carry one line naming those names as left empty, and `run` SHALL carry on to the command, which gets no value for them from keyprompt; WHEN the same happens on a `set` card THEN it SHALL still answer "Paste at least one value."
**Verify:** `KEYPROMPT_STORE_TEST=1 npm test` with the new tests: `test/card-server.test.mjs` (an allowed empty submit ends with no values and never calls the store; a required box is still refused), `test/card-script.test.mjs` (no trip into the vault, the ending with Remember ticked and unticked, and a refused empty Save), `test/buddy.test.mjs` (12 moods), `test/cli.test.mjs` (`runCardLine`, and the opt-in end-to-end run with a fake browser, which also checks `set` still refuses). Commit, then break each guard and watch a test fail. Then the card by hand in Chrome, light and dark.
**Must not:** let `set` or `demo` end with no values; call `onSubmit`, the store or the list of names for an empty submit; let a required box stay empty; change what a Save that gave values says or does; change the Save button's label (B-14); add a dependency.

---

### S-29 — Release 0.2.1 (owner step)

**PR:** one (version bump, dated CHANGELOG, this entry). The tag and the GitHub release follow the merge, as in S-17.
**Depends on:** S-28 done (PR #31), CI green on the PR head, **Abhishek's explicit go** for the publish (public and permanent), his npm login, and a Touch ID approval.
**Blocks:** nothing.
**Research:** lookup · npm's state is read live right before the publish (`npm view keyprompt dist-tags`, `npm whoami`); the publish route is the one S-17 found.
**Model:** sonnet.
**Confidence:** 0.85 — the route worked once (S-17), the package contents are checked by a dry run, and only `package.json`, `package-lock.json`, `CHANGELOG.md` and this register change. What can still go wrong is on npm's side (a login that expired, a 2FA prompt).
**Files:** `package.json`, `package-lock.json`, `CHANGELOG.md`, `docs/steps.md`.
**Today:** `main` (f8a1c31) carries S-18, S-19, S-25, S-26, S-27 and S-28, but npm's `latest` is 0.2.0 (`npm view keyprompt version`, 2026-11-07), so `npx -y keyprompt` still gives the version without them.
**Change:** `npm version 0.2.1 --no-git-tag-version` (both files say 0.2.1). The CHANGELOG's "Unreleased" heading becomes "0.2.1 — 2026-11-07" with one lead sentence that matches the bullets under it. Then: `npm pack --dry-run` and a read of its file list; a PR; CI; Abhishek's go; the publish from the PR head CI tested (the route S-17 learned: `npm login --auth-type=web`, then `printf '\n' | script -q /dev/null npm publish --access public --auth-type=web`, approved with Touch ID); this row gets what npm answered. After the merge: tag `v0.2.1` on the squash commit once `npm pack` there gives the same shasum, and a GitHub release.
**Acceptance:** WHEN someone runs `npx -y keyprompt --version` on a clean machine THEN it SHALL print 0.2.1.
**Verify:** that command in an empty folder with an empty npm cache; `npm view keyprompt dist-tags` says `latest` is 0.2.1; `npm test` (the CHANGELOG test wants a section for the version in `package.json`).
**Must not:** publish without the go or with CI red; publish files outside `package.json` `files`; touch any file under `src/`, `bin/`, `skill/` or `test/`; add a dependency; type or ask for a password or a 2FA code.

---

### S-30 — The Save button says plain "Save" when any box is optional (bug B-14)

**PR:** one. The code, its tests, the PRD sketch and the CHANGELOG go together: the sketch and the changelog would be false the moment the label changes (invariant 9).
**Depends on:** Abhishek's choice of wording for B-14, given 2026-11-07 ("Plain 'Save' if any box optional", D-8 in the PRD).
**Blocks:** B-15 (the README's demo pictures are retaken after S-31, so once).
**Research:** none.
**Model:** sonnet — one line in a page renderer and its tests.
**Confidence:** 0.9 — the rule is tested in three cases, broken three ways, and looked at in a real browser (headless Chromium) in both themes; the wording is Abhishek's call.
**Files:** `src/card-page.mjs`, `test/card-server.test.mjs`, `docs/prd/card-v2.md`, `CHANGELOG.md`, `docs/bugs.md`, `docs/steps.md`.
**Today:** `renderCard` says "Save all N" whenever a card has several boxes, counted by boxes and not by how many will be filled, so a card with an optional box left empty saves fewer than the button says. A lone box says "Save securely" even when, on `run`, it may be left empty.
**Change:** `renderCard` works out `mayLeaveEmpty = fields.some((f) => f.optional)`. The label is "Save" when `mayLeaveEmpty`, otherwise "Save all N" (several boxes), otherwise "Save securely" (one box). "Replace value(s)" is unchanged. PRD: the sketch shows `[Save]`, one line states the rule, and D-8 records the choice. CHANGELOG: a new "Unreleased" section holds the fix.
**Acceptance:** WHEN a card has at least one optional box THEN its button SHALL read "Save"; WHEN every box on a card must be filled THEN it SHALL read "Save all N" for several boxes and "Save securely" for one.
**Verify:** `KEYPROMPT_STORE_TEST=1 npm test` (151 of 151), including the changed multi-field test and the new label test in `test/card-server.test.mjs`. Commit, then break the label line three ways and watch a test fail each time. Then `keyprompt demo` in a browser, light and dark.
**Must not:** change a Replace label, the "Use for this run" label, the card script or the server; add a count that moves as the person types; add a dependency.

---

## Next release (v0.3) — ranked candidates, not frozen

1. **`keyprompt mcp` — become the page an MCP agent opens.** Claude Code 2.1.287 added "URL prompts from MCP servers" on the 2025-11-25 protocol: it asks you, then opens the URL in your browser (live CHANGELOG via `gh`, 2026-11-05). VS Code declares URL mode support. A small stdio MCP server with a `request_secret` tool answering with URL elicitation would make the card native in those agents, with the shell command still there for everything else. Needs R-6 closed and a yes on how to build it (hand-written JSON-RPC vs the MCP SDK dependency, invariant 7).
2. **A Claude Code guard hook, lite.** Secretless AI's best idea, in about 50 lines:
   - Before a tool runs (PreToolUse on Bash): block commands that read keyprompt's own store directly (`security find-generic-password -s keyprompt`, `secret-tool lookup service keyprompt`) or dump the environment.
   - When you send a prompt (UserPromptSubmit): warn when it looks like it contains a key.

   An honest `keyprompt status` would then say "Enforced in Claude Code; advice only elsewhere". This turns B-2 from "nothing stops it" into "Claude Code stops it".
3. **A project manifest** (`keyprompt setup`): read the names a project needs (for example from `.env.example`) and ask for every missing one in one card. This is the "live checklist" and "handover" idea from the reports, built on S-5.
4. **A names-only activity log**: when each name was handed to which command and its exit code, never values. It feeds the receipt and a future handover checklist.
5. **`--json` results for agents**: machine-readable saved / deferred / missing lists, like Infisical's and AgentSecrets' structured "missing" errors.

## Parked — with the reason

- Per-project keys, dev/prod gate, wrong-account display, key notes: valuable for agency work; next after v0.3, once you've used v0.2 on real client projects.
- Provider presets: D-3 (developer first).
- Windows values over 1,280 characters: R-2, low confidence.
- An HTTP proxy or API gateway: Infisical's territory (cloud, certificate trust, HTTP only); a different product.
- Cloud sync, teams, telemetry: invariant 6 and the reports' "avoid" list. Two competitors ship telemetry by default; we never will.
