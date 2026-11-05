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
| 4 Honest and shipped | S-15, S-16 → S-17 | Headline fixed, README and 0.2.0, npm publish |
| 4b Lite wins from the teardowns | S-18, S-19 | Masking catches encoded copies; refuse a key pasted into a command |
| Fixes | S-20 | B-6: the card never ends while a save is under way |

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
| S-12 | done 2026-11-06 (PR #15) | src/buddy.mjs holds `BUDDY_NAME`, `MOODS` (the PRD table word for word; a test parses the PRD and compares), `CAPTION_VARIANTS`, one inline SVG of about 5 KB and `buddyStyle()`. Each optional part lists the moods that show it (`data-show`) or hide it (`data-hide`), and `buddyStyle()` turns those lists into CSS, so a pose is data. No colour is written in the SVG: every fill comes from a class mapped to a `--b-*` variable set for light and for dark (OKLCH). The buddy replaces the lock icon in the card header, and the caption is a speech bubble beside it, under the title. The step said "under the creature"; beside keeps the form near the top. The header stays on the done screen: the title becomes the outcome ("Saved", "Ready", "Later", "Cancelled", "Closed", "Demo finished"), the caption says what happened, and the done view now holds only "You can close this tab." (the tick and the repeated sentence are gone). Three table captions (`listening`, `stashing`, `locked`) would be false on some cards, so they are replaced there, and the PRD now lists all five replacements: with Remember unticked (`listening`, `stashing`) and in a demo (`listening`, `stashing`, `locked`). The first box has focus on load, so a buddy that followed focus alone never showed the opening caption; it now follows focus only after the person's first click, key or paste in the form. A server error that names no field goes to the caption (red, `oops`) instead of the error line; one that names a field still goes to the error line, and the buddy follows the focused box. `asleep` can only be seen through the demo's preview until S-14 adds the countdown. The `closed` caption repeats B-7's false sentence after a timeout (noted in B-7). No test runs the page script: the mood changes were checked by hand in Chrome for every outcome in light and dark mode, with a scratch card that saves nothing and with `keyprompt demo`. |
| S-13 | done 2026-11-06 (PR #16) | `motionStyle()` in src/buddy.mjs adds one keyframe set per mood, written into `buddyStyle()`: listening breathes (a stretch from the feet, so they stay on the ground, 2.4 s loop), peek-proof's flippers swing up (200 ms), the key goes into the vault (`STASH_MS`, 600 ms), then on locked the door shuts from its hinge (250 ms) and the dial turns to its still 135° (400 ms), one-run's envelope is offered up and fades (600 + 300 ms), the later note drops on (300 ms), bye waves twice, asleep's z's float in turn (3 s loop), oops shakes while keeping its tilt (300 ms). Three choices go past the step text: the locked sparkle pops in last (at 650 ms), because popping first it said "locked" before the door shut; the envelope rises instead of sliding right, because sliding right it went onto the vault door and looked saved; and the flippers do not fade in, because a fade left one frame with no eyes and no flippers. After a successful Save the page waits `STASH_MS` minus the time the server took before its done screen (measured: 599 ms after the answer; with reduced motion 1 ms), so no wait is ever over 600 ms. Reduced motion sets `animation: none !important` on the buddy, which leaves the S-12 still poses, and the script skips the wait. Measured in Chrome: no animation in any mood with reduced motion, and the expected ones without it (`getAnimations()`). A frame-by-frame strip (each animation paused at set times) was checked in light and dark. Tests pin the step's rules: only `transform` and `opacity` in any keyframes, `infinite` only for listening and asleep, every keyframes set used, the reduced-motion block, a part with a still transform ending on it, and `STASH_MS` ≤ 1,200 and used by both the style and the script. Re-entering a mood replays its motion; clicking the same demo preview twice does not (the mood did not change). For the first ~100 ms of locked the vault shows plain ice (the dark opening has gone and the door is still narrow); left as is. B-8 logged: with Remember unticked the key still goes into the vault. |
| S-14 … S-19 | todo | — |

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
**Also:** the shown name comes from one constant, `export const BUDDY_NAME = 'Pinguu'` in src/buddy.mjs. No other file spells the name, so a rename is one line (R-4).
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
**Depends on:** S-10, S-14, S-15, and a fresh name check (R-4: a live search for "Pinguu" trademarks and any Mattel action; Abhishek keeps or renames).
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
**Change:** Abhishek logs in (`! npm login`). Run `npm publish --dry-run`, review the file list, then `npm publish`. Tag `v0.2.0` and create a GitHub release. The README and `skill/SKILL.md` switch from `npx -y github:abhisheksharma001/keyprompt` to `npx -y keyprompt`.
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
**Files:** `src/redact.mjs`, `test/redact.test.mjs`, `SECURITY.md`.
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
**Files:** `src/cli.mjs` (the `run` branch), `test/cli.test.mjs`.
**Change:** before starting the command, if any secret value (8+ characters) appears inside any argument after `--`, refuse with exit 2: "A saved value for NAME appears in the command itself. Pass it through the environment instead ($NAME); see `keyprompt --help`." The message never shows the value.
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
