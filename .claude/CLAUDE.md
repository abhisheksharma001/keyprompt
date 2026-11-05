# keyprompt — project rules

keyprompt is a small CLI that lets AI coding agents get API keys from a person without the key ever entering the chat. Node ESM (`.mjs`), one runtime dependency (`cross-spawn`). The "card" is a local web page served on 127.0.0.1.

- Working standard: `~/.claude/skills/mystandard/SKILL.md` — one step is one PR; stop after every PR.
- Feature plan: `docs/prd/card-v2.md` · Step register: `docs/steps.md` · Research flags: `docs/research.md` · Bugs: `docs/bugs.md`
- Threat model and limits: `SECURITY.md`

## Invariants — a PR that breaks one does not merge

1. **No command prints, returns or writes a saved secret value.** There is no `get`. keyprompt's own stdout/stderr never contain a value.
2. **A value reaches a program only through `keyprompt run`**, in the environment of the one command it starts.
3. **Masking covers every value handed to `run`, whatever the agent said.** Hints an agent gives (`:visible`, `:multiline`, `:optional`) change how the card looks, never what is protected. (`src/redact.mjs`)
4. **The card server stays locked down:** 127.0.0.1 only, one-time 256-bit path token, exact Host and Origin checks, JSON only, size cap, one successful submit, a deadline. (`src/card-server.mjs`)
5. **The card page loads nothing from the network.** No external scripts, fonts, images or CDNs. CSP stays `default-src 'none'` with one nonce'd inline script. The mascot is inline SVG + CSS only — no animation libraries.
6. **No telemetry, analytics, crash reporting or network calls** from keyprompt, ever.
7. **No new dependency (runtime or dev) without Abhishek's explicit yes.** Few dependencies is a trust feature.
8. **Values travel only over stdin/stdout of helper processes**, never as command-line arguments, never into logs, never into the catalog (`~/.keyprompt/catalog.json` holds names, reasons and dates only).
9. **Every word shown to people is literally true** — card text, mascot captions, CLI messages, README. Never "your agent can never see it", never "100% secure". Limits belong in `SECURITY.md`.
10. **Anything the agent writes (reason, requester, field names) is escaped** before it reaches the page, and the card presents it as the agent's words.

## Conventions

- ESM `.mjs`, JSDoc types, 2-space indent, no semicolons, single quotes — match the existing files.
- Errors for people: `throw new KeypromptError(message, { exitCode })` from `src/errors.mjs`. Plain English that says what to do next.
- Exit codes live in `EXIT` in `src/errors.mjs`. Adding one means updating `README.md` and `skill/SKILL.md` (in the docs step that follows).
- Tests: `node:test` + `node:assert/strict`, one file per area in `test/`. Card tests speak raw HTTP so they control Host and Origin (see `send` in `test/card-server.test.mjs`).
- Real password-store tests are opt-in: `KEYPROMPT_STORE_TEST=1 npm test` writes random `KEYPROMPT_TEST_*` names to your real OS store and deletes them.
- In docs, a backticked path inside this repo must exist. Planned files and paths in other repos are written in plain text.

## Research — live data, never guesses

Follow the "Live Research Rule" in `~/.claude/CLAUDE.md`. In short: check `date` first; anything that changes over time (an OS tool's flags, a browser feature, a competitor, an npm package, a price) is looked up live in a primary source and cited with URL + date + live/cached. Not sure, or found something unexpected? Search before acting, then write it into `docs/research.md` (and `docs/bugs.md` if it is a defect). A subagent brief starts with the date and time and copies these rules in.

## Verify

- `npm test` passes. CI runs Ubuntu, macOS and Windows on Node 20 and 22 (`.github/workflows/ci.yml`), including the real password-store round trip.
- `git grep -nE "console\.log|debugger" src/` prints nothing.
- Card changes: look at the card in a real browser in light and dark mode. Once the demo command lands (step S-11), use `node bin/keyprompt.mjs demo`, which saves nothing.
