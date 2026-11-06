# Card v2 — many fields, "Later", and a buddy that tells the truth

**Status:** FROZEN 2026-11-05. Abhishek said "yes" to the playback below. A change is a new dated revision with its reason; a changed goal can never turn a failed result into a success.
**Owner:** Abhishek · **Planned by:** Claude Opus 5.5 · **Builds:** one step = one PR, see `docs/steps.md`

## Playback (confirmed by Abhishek 2026-11-05)

1. keyprompt stays a small local tool: one card in the browser, keys go to the OS keychain, no cloud, no signup.
2. When an agent needs a credential with several parts (Twilio SID + token, Google client ID + secret, a PEM key), **one card asks for all of them**.
3. The agent can mark a box as `visible` (IDs), `multiline` (PEM/JSON) or `optional`. That only changes how the card looks; **every value stays masked in output**.
4. All values save together or none do.
5. A **Later** button lets you put it off; the agent gets a clear "deferred" answer (exit 6) and carries on with other work.
6. A friendly penguin (it has no name, see D-2) sits on the card. **Every pose shows what really happened**: saved, used once, later, cancelled, timed out, failed.
7. The headline stops promising more than the code does.
8. A `keyprompt demo` command shows the card without saving anything — for you, for screenshots, for new users.
9. Built for you first (a developer on macOS), but public and tidy enough that others can pick it up.
10. Not in this release: per-project keys, key notes, presets, proxy, cloud, teams, MCP server.

## Goal

When my coding agent needs credentials, one friendly card collects every value it needs — including IDs and multi-line keys — lets me say "later", and shows me truthfully where each value went, without any value entering the chat.

## For whom

Abhishek first: a developer on macOS doing agency and client automation work, running Claude Code. The repo is public, so it must also make sense to a stranger developer who finds it.

## Success — acceptance sentences

- **A1** WHEN the agent runs `keyprompt set TWILIO_ACCOUNT_SID:visible TWILIO_AUTH_TOKEN --reason "Send a test SMS"` THEN one card SHALL open with two boxes (the SID shown as text, the token hidden), and saving SHALL store both values or neither.
- **A2** WHEN the agent runs `keyprompt run A,B -- <command>` and neither A nor B is saved THEN exactly one card SHALL open, asking for both.
- **A3** WHEN a PEM key is pasted into a `:multiline` box on macOS and saved THEN `keyprompt run` SHALL give the program exactly those bytes, line breaks included.
- **A4** WHEN the person clicks **Later** THEN keyprompt SHALL exit with code 6, save nothing, and (for `run`) not start the command.
- **A5** WHEN the card ends in any outcome (saved, used for one run, later, cancelled, timed out, failed, no longer active) THEN the buddy SHALL show that outcome's own pose and its caption from the table below, word for word.
- **A6** WHEN the agent marked a box `:visible` THEN that value SHALL still be masked in `keyprompt run` output.
- **A7** WHEN the computer is set to reduce motion THEN the buddy SHALL not animate; poses switch instantly.
- **A8** WHEN someone runs `keyprompt demo` THEN the card SHALL open with sample boxes, say it is a demo, and write nothing to the keychain or the catalog.
- **A9** WHEN anyone reads `README.md`, `package.json` or the GitHub description THEN no sentence SHALL claim the agent can never see or obtain a key.

## Not doing in this release

Per-project keys · key notes and "future-self warnings" · wrong-account checks · client handover checklist · provider presets ("where to find your Twilio SID") · paste-mistake checks · smart `.env` paste · Windows values over 1,280 characters (R-2) · an HTTP proxy or API gateway · cloud sync or teams · an MCP server (R-6) · telemetry of any kind. They are listed with reasons under "Parked" in `docs/steps.md`.

## Money ceiling

$0 in services. Nothing in this plan calls a paid API or needs an account.

---

## What a person sees today, and what they see instead

| Today | After card v2 |
|---|---|
| One card per secret. Twilio needs two cards, one after the other. | One card with every box the agent needs. |
| Every box is a hidden one-line field. A client ID is hidden too, so you can't check what you pasted. | IDs can be shown (`:visible`); keys stay hidden; PEM/JSON gets a paste box (`:multiline`). |
| A key with line breaks is refused on macOS. | Saved exactly (R-1). |
| Only Save or Cancel. | Save, **Later** or Cancel. |
| A grey lock icon and "Saved". | A creature whose pose and caption say exactly what happened, plus a receipt per value. |
| The card silently stops working after 5 minutes. | "Card closes in 4:12", then the creature falls asleep and says so. |

### Card layout (sketch)

```
┌────────────────────────────────────────────┐
│  (creature)   Secrets requested              │
│   "Paste them here. They go to your          │
│    macOS Keychain, not into the chat."       │
│                                              │
│  Claude Code in my-project asks:             │
│  "Send a test SMS"        ← agent's words    │
│                                              │
│  TWILIO_ACCOUNT_SID              shown       │
│  [ AC1234........................ ]          │
│  TWILIO_AUTH_TOKEN                           │
│  [ •••••••••••••••••••••••• ] [Show]         │
│  GOOGLE_PRIVATE_KEY      multi-line · opt.   │
│  [ Paste here ]  → "27 lines pasted" [Show]  │
│                                              │
│  [x] Remember on this computer   (run only)  │
│  [Later]  [Cancel]              [Save all 3] │
│  ──────────────────────────────────────────  │
│  macOS Keychain · card closes in 4:51        │
└────────────────────────────────────────────┘
```

## How it works

### Command line

```
keyprompt set FIELD [FIELD ...] [--reason TEXT] [--by TEXT]
keyprompt run FIELD[,FIELD ...] [--reason TEXT] [--by TEXT] [--no-redact] -- COMMAND [ARGS ...]
keyprompt demo

FIELD = NAME[:HINT[:HINT ...]]          e.g.  TWILIO_ACCOUNT_SID:visible
HINT  = visible | multiline | optional
```

- At most 12 fields per card.
- A hint only shapes the card. It never changes masking (decision D-1).
- `run` asks only for names that are not saved yet; hints on saved names are ignored.
- `set` on a name that is already saved shows "Saved — leave empty to keep"; an empty box keeps the old value.
- An empty `optional` box is not saved, and the variable is simply absent from the command's environment.
- `--no-redact` hands COMMAND keyprompt's own output untouched, so it works only when keyprompt's stdout and stderr are both a terminal. Otherwise `run` stops with exit 2 before reading a key or opening a card (decision D-6, bug B-11).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Saved (or the command ran and exited 0) |
| 1 | Error |
| 2 | Usage error |
| 3 | Not found (`has`) |
| 4 | Cancelled on the card |
| 5 | Nobody filled the card in time |
| **6** | **New: the person chose Later.** Nothing saved; `run` did not start the command. The agent should continue with other work and ask again only when it is about to need the value. |

`run` otherwise exits with the command's own code.

### Card protocol (internal, between the page and `src/card-server.mjs`)

- `GET /card/<token>` serves the page.
- `POST /card/<token>/submit` with `{ "values": { "NAME": "…" }, "remember": true }` returns `200 { remembered }`, or `400 { error, field? }`, `409`, `410`, `422 { error }`.
- `POST /card/<token>/cancel` → exit 4. `POST /card/<token>/later` → exit 6.
- All of today's guards stay: loopback only, one-time token, Host and Origin checks, JSON only, size cap (raised to 1 MiB for multi-line values), one successful submit, a deadline.

### Saving: all or nothing

For each value in order: read what was there before, then write. If any write fails, every earlier name is put back exactly as it was (old value restored, or removed if it was new), and the card shows the error. The catalog is written once, after everything succeeded.

### The buddy

The creature is a penguin who keeps keys in an ice vault. It has no name, by decision (D-2, R-4, 2026-11-06). It lives in its own file, and in code it is called `buddy`. The demo card's preview row calls it "the penguin".

| Moment | Mood id | Pose | Caption (exact) |
|---|---|---|---|
| Card opens | `listening` | Sits up, looking at the boxes, gentle bob | "Paste it here. It goes to your {store}, not into the chat." |
| Typing in a hidden box | `peek-proof` | Covers its eyes | "Not looking." |
| Typing in a shown box | `watching` | Looks at the box | "This box is shown on screen." |
| Save pressed, waiting | `stashing` | Carries the key towards the vault | "Putting it away…" |
| Saved | `locked` | Vault door shut, dial spins | "Locked in your {store}." |
| Used for one run only | `one-run` | Hands over an envelope, which disappears | "Handed to this one command. Not saved." |
| Later | `later` | Sticks a "later" note on the vault | "Okay, later. Nothing was saved." |
| Cancelled | `bye` | Waves | "Cancelled. Nothing was saved." |
| Timed out | `asleep` | Falls asleep, zzz | "This card timed out. Nothing was saved." |
| Save failed | `oops` | Shakes its head | The error message from the server, as is. |
| Card no longer active | `closed` | Sign on the vault | "This card is no longer active. You can close this tab." |

`{store}` is the store label: "macOS Keychain", "Windows Credential Manager", "Linux keyring (Secret Service)", or "nowhere (demo)".

**Where a table caption would be false, it is replaced (S-12, invariant 9).** These are the only replacements (`CAPTION_VARIANTS` in src/buddy.mjs):

| Card | Mood | Caption instead |
|---|---|---|
| "Remember on this computer" unticked | `listening` | "Paste it here. It goes to this one command, not into the chat." |
| "Remember on this computer" unticked | `stashing` | "Handing it over…" |
| Demo (no store, nothing saved) | `listening` | "Try it: type anything. Nothing is saved." |
| Demo | `stashing` | "Pretending to put it away…" |
| Demo, after Save | `locked` | "Nothing was saved. This is how a real save looks." |

A demo also has a row of buttons that preview every mood; a previewed caption starts with "Preview:", and `{store}` reads "password store" there. The `closed` caption says nothing about how the card ended, because the page often cannot know: the deadline may have passed, or another tab may have saved. It shows when the server answers that the card has ended (410), and when Cancel gets no answer at all.

**Caption rules (invariant 9):** captions describe what happened, never what is impossible. Banned: "your agent can never see this", "100% secure", "encrypted by …", "safe forever". The buddy reacts only to focus, field type and outcome — never to what was typed or its length.

**Tech rules (invariants 5 and 7):** inline SVG and CSS only, under 8 KB, colours from the page's CSS variables so light and dark both work. Only `transform` and `opacity` animate. `prefers-reduced-motion: reduce` means no animation. No animation libraries: GSAP or Motion would need an outside script, which the card's security policy blocks, and a new dependency.

### The receipt (done screen)

One line per value: "Saved in your macOS Keychain" / "Handed to this one command, not saved" / "Kept the saved value" / "Left empty" / "Not saved (Later)". Under it: "keyprompt masks exact copies in that command's output. It cannot stop a command from sending the key elsewhere — see SECURITY.md."

Where it shows (S-14):
- After a Save, one line per box, from the server's answer: names and outcomes only, never a value. After Later, every box reads "Not saved (Later)".
- Not after Cancel or a timeout (their caption already says nothing was saved), and not in a demo (a demo keeps nothing, so its answer has no receipt).
- The masking sentence shows only on a `run` card after a Save, and only when the output is masked: not with `--no-redact`, and never on a `set` card, whose page does not contain it. With `--no-redact` the card says nothing about masking.
- "Kept the saved value" appears only on `set`, for a box that is already saved and was left empty.

### The footer (S-23, B-9 and B-10)

The footer's note says where a Save puts the key, and nothing about what the agent can see: a command the agent writes can print or send a key (SECURITY.md), so "never shown to your agent" was not true (invariant 9). Abhishek chose this wording on 2026-11-06.

| Card | Footer note (exact) |
|---|---|
| Ordinary, "Remember on this computer" ticked or not offered | "Stored in your {store}" |
| "Remember on this computer" unticked | "Held for this one command only" |
| Demo | "Demo · nothing is stored" |
| Ended with nothing saved (Cancelled, Later, timed out, no longer active, a final error) | no footer at all (its line goes too): the note would name a store the key never reached |

After a Save or a one-run Save the note stays as it was. "Stored in your {store}" is also on the card before anything is saved, where it names the place a Save goes.

### The deadline (footer clock)

The footer shows "Card closes in m:ss", counting down to the server's deadline (`expiresAt`, passed to the page; the page and the server run on the same computer). At zero the form is replaced by the `asleep` pose, the title "Timed out" and the caption from the buddy table. The clock is a `role="timer"`, so a screen reader does not read it every second. If a request is still under way at zero (a Save, Later or Cancel), the page waits for its answer instead of announcing a timeout. For a Save the server waits too (B-6, fixed in S-20), so the card ends with what that save really did. The clock disappears once the card has ended.

---

## What others do — and where this lite version does better

As of 2026-11-05. **Sources:**
- Open-source products, read from source at pinned commits: Infisical/infisical `41db38d`, Infisical/cli `42e316e`, Infisical/agent-vault `2cb47bf`, the-17/agentsecrets `be53766`, opena2a-org/secretless-ai `f2568f1`.
- AgentsRoom and 1Password: live docs only. They are closed source, and their apps were not downloaded or decompiled.
- Nothing was installed or run.
- Full citations: R-5 in `docs/research.md`.

| | Infisical Agent Vault | AgentSecrets | Secretless AI | AgentsRoom | 1Password | **keyprompt v2** |
|---|---|---|---|---|---|---|
| Agent asks for a missing key *at that moment* | No — 403/407; the old "proposal" flow is deprecated | No — tells you to type `secrets set KEY=VALUE` in a terminal | No — an error only | "Add it in the app" | Website logins only; API-key entry not documented | **Yes — a card with several fields and Later** |
| Where the human types | Web dashboard wizard | A command-line argument (ends up in shell history) | A hidden terminal line; a pasted PEM keeps only its first line | Their desktop app | Their app | Browser card; masked; multi-line paste box |
| What you must set up | Account, cloud or enterprise-licensed self-host, a proxy, a trusted certificate; $2 per 1,000 requests after 5,000 | Account and a daemon | Nothing, but telemetry is on by default | Desktop app (Pro €7.99/mo) | Subscription and desktop app | **Nothing** |
| How the key reaches the program | HTTPS proxy adds it to requests (HTTP only) | Proxy/MCP; `env --` injects *every* secret | Environment, unmasked; an opt-in shell hook exports every secret | Filled in at launch | `op run` | Only the named keys, into one command |
| Output masking | None | Strong (encoded forms too) | None | Not mentioned | Yes (`op run`) | Exact copies; encoded forms proposed (S-18) |
| Enforced in Claude Code | — | — | Hooks block env dumps and pasted keys, redact transcripts | — | — | Skill instructions only; guard hook planned (v0.3) |
| Honest about limits | Docs say 7-day sessions; CLI default never expires | Claims agents "never hold, see, or receive" values; `SECURITY.md` linked but missing | Yes — "enforced vs advisory" | — | — | `SECURITY.md`; headline fix (B-1, B-2) |
| Size | Platform | ~24k lines Go | ~53k lines TS | App | App | ~1.8k lines JS |

**Where this lite version wins** (my judgment from the table):
1. It's the only one here that asks the person at the moment the key is needed, in a browser card, with several fields and Later. Closest rival: keymask, an npm package with a multi-field local form. It's unverified (R-9).
2. No account, daemon, certificate or telemetry. Evidence that people want this: AgentSecrets issue #5, "Local mode, no login", open since 2026-04-08.
3. Multi-line keys paste properly (Secretless keeps only the first line; AgentSecrets has no hidden input).
4. Only the named keys reach the command (AgentSecrets' `env` and Secretless' shell hook hand over everything).
5. The receipt: none of them shows the person where each value went.
6. Personality: none of them has any.

**Ideas we take, kept small:**
- In this release, if Abhishek says yes:
  - S-18: mask encoded copies too (from AgentSecrets).
  - S-19: refuse a saved key pasted into a command (from Secretless).
- For v0.3 (see `docs/steps.md`):
  - An MCP URL-mode server. Claude Code 2.1.287 now opens MCP "URL prompts" in the browser.
  - A Claude Code guard hook (from Secretless).
  - A project manifest.
  - A names-only activity log (from AgentSecrets and Infisical).
  - `--json` results.

**Things we will never do, seen in these tools:**
- Telemetry on by default.
- Keys on the command line.
- Injecting every secret.
- Sessions that never expire.
- An encryption key that can be rebuilt from HOME and USER.
- Decrypted values cached on disk.
- A destructive tool with no guard.
- Linking a `SECURITY.md` that doesn't exist.

**No longer special on its own:**
- Exact-copy masking: `op run` has it, and Codex 0.164.0 masks credentials in its remote shell.
- Multi-field forms: keymask and the Infisical dashboard have them.

The edge is how good the moment of asking feels, how honest the card is, and needing zero setup.

**Agents themselves (bundling risk):** as of the Claude Code 2.1.318 changelog (read live), Claude Code has no local "ask the human for a key" feature. It does now open MCP URL prompts. That makes the plan's v0.3 MCP server an opportunity rather than a threat.

## Will other people use it?

Honest view, from reports 8–10 plus the code:

- **The space is crowded with serious tools**, and the teardowns above show none of them makes the moment of asking *pleasant* or zero-setup. A friendly, honest card that installs in one line is a real difference for solo developers. That is a hypothesis, not proof. Small signs of demand: AgentSecrets has 196 stars and an open "local mode, no login" request. Watch keymask (R-9): it is the closest to this idea.
- **What decides it:**
  1. One-line install: `npx keyprompt` (needs the npm publish in S-17; the name is free today, R-7).
  2. The agent uses it with no setup (the skill, and the AGENTS.md block in the README).
  3. The first 10 seconds are fun: a short clip of the card at the top of the README, made with `keyprompt demo`.
  4. Claims that survive a sceptic (B-1 fixed, `SECURITY.md` kept sharp).
- **How we'll know, without telemetry (invariant 6):** you reach for it on your next two client projects without being reminded; GitHub stars and issues; npm weekly downloads (public numbers).
- **Phase B, after 0.2.0 — each one is public, so each needs your yes:** publish to npm; post a 20-second clip (Show HN, r/ClaudeAI, X); list the skill on a skills marketplace.

## Decisions

- **D-1** (2026-11-05, Abhishek: "ok"): agent hints change the look only; masking stays on for every value.
- **D-2** (2026-11-05, Abhishek: "pinguu (lets use this)"; **changed 2026-11-06, Abhishek: "Drop the name"**): the mascot is a penguin. On 2026-11-05 it was named **Pinguu**, with three guards: the name in one constant, a look clearly our own, and the name decided again before the README launch (S-16) and the npm publish (S-17). The re-check came on 2026-11-06 (R-4): PINGU is a pending US toy trademark owned by Mattel's subsidiary, Mattel opposes look-alike marks (one-letter-off "PINU" in December 2025, "HIJARBIE" in September 2026), and the name showed in one visible place. So the penguin now has **no name** (S-22): the constant is gone and a test fails if "Pingu" is spelled in `src/`. Guard 2 stays: the look must be clearly our own, not Pingu's (see S-12 "Must not"). The code's working name stays `buddy`.
- **D-3** (2026-11-05, Abhishek: "me"): the card is for Abhishek first, a developer. Copy may be technical; provider presets are parked.
- **D-4** (2026-11-05, Abhishek: "ok"): this release = multi-field card, Later, buddy with truthful poses, headline fix. **Approved 2026-11-05 (Abhishek: "yes"):** `keyprompt demo` (S-11), the card countdown (part of S-14), and the two lite wins from the teardowns: masking encoded copies (S-18) and refusing a key pasted into a command (S-19).
- **D-5** (2026-11-05): no animation libraries (invariants 5 and 7).
- **D-6** (2026-11-06, Abhishek: "Terminal only"): `run --no-redact` works only when the output goes straight to a terminal; otherwise it stops with exit 2 (S-24, bug B-11). Chosen over a card that asks each time, removing the flag, and keeping it as it was. It stops an agent's shell tool from turning masking off by accident. It does not stop an agent on purpose: one whose commands run in a real terminal, or one that wraps keyprompt in `script`, still can (`SECURITY.md`).
