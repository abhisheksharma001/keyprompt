# Changelog

What changed in each version of keyprompt. Everything listed under a version is merged to `main`.

## Unreleased

### Added

- **Masking catches encoded copies too.** `run` now also replaces the base64, base64url, lowercase hex, URL-encoded and JSON-escaped forms of a value of 8 or more characters with `[keyprompt:NAME]`. Shorter values are still caught only as exact copies. Any other transformation still gets through; `SECURITY.md` has the exact list.

## 0.2.0 — 2026-11-06

The first version on npm: `npm install -g keyprompt`, or `npx -y keyprompt <command>` without installing.

### Added

- **One card for several keys.** `keyprompt set A B C` and `keyprompt run A,B -- COMMAND` open one card with a box for each name, up to 12. `set` saves all of them or none. A name can carry hints after a colon: `:visible` (the box shows what you type), `:multiline` (a paste box that keeps line breaks) and `:optional`.
- **Line breaks inside a value** (a PEM key, a JSON key file) are now kept on macOS too. In 0.1.0 a value there had to be a single line. Windows and Linux already kept them, and CI now checks that with short values. The size limits for each system are in the README.
- **A Later button.** It saves nothing and ends the card with exit code 6, so the agent knows you chose Later and can carry on. `run` does not start its command.
- **`keyprompt demo`** opens a sample card that saves nothing, so you can see how it looks.
- **A penguin on the card**, with a pose and a short movement for each of 11 moments (listening, saving, locked, Later, timed out, and more). It is drawn inline in the page, so nothing loads from the network. When your computer asks for less motion, it stays still.
- **A receipt.** After a save, the card lists each name and what happened to it. It never shows a value.
- **A clock** in the footer shows how long the card stays open.

### Changed

- `keyprompt run` opens one card for every missing value. In 0.1.0 it opened one card per name.
- `run --no-redact` works only when keyprompt's output goes straight to a terminal. When it does not (a pipe or a file, as in Claude Code's shell tool), `run` stops with exit code 2 before reading a key, so an agent's shell tool can no longer turn masking off by accident. `SECURITY.md` says what this does not stop.
- The README, the `package.json` description and `SECURITY.md` no longer say the agent "never sees" a key. They say what is true: the key goes to one command, exact copies are masked in its output (not with `--no-redact`), and a command can still transform or send it. `SECURITY.md` now also says plainly that the agent itself can read a saved key from your operating system's password store, because it runs as you.
- The card footer reads "Stored in your {store}", or "Held for this one command only" when you untick Remember. A card that ended without saving has no footer.
- A card that has ended says one sentence, "This card is no longer active", however it ended.
- `keyprompt --help`, the README and the Claude Code skill describe the new field hints, one card for what you need right now, and exit codes 0 to 6.

### Fixed

- **macOS:** a pasted value longer than about 4,000 bytes on one line was cut off by the `security` tool, and the text after the cut ran as a separate `security` command. keyprompt now refuses such a value before `security` runs, and the card says it is too long. This was in 0.1.0.
- Pressing Cancel, or reaching the 5-minute deadline, while a save was under way said "Nothing was saved" even though the save went on. The save now decides. For `run`, a save that finishes after the deadline starts the command, because the key was given.
- After the deadline, the card said "This card was already used".
- The card footer said "never shown to your agent", which overstates it: an agent can read a saved key from the password store (see `SECURITY.md`).
- The card footer said "Stored in your macOS Keychain" on cards that stored nothing, such as after Cancel, Later or a timeout.

## 0.1.0 — 2026-11-05

The first version: `keyprompt set`, `run`, `has`, `list`, `delete` and `install-skill`. A card in your browser takes the key, the OS password store keeps it (macOS Keychain, Windows Credential Manager, Linux Secret Service), and `run` hands it to one command and masks exact copies in that command's output.
