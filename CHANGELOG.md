# Changelog

What changed in each version of keyprompt. Everything listed under a version is merged to `main`.

## Unreleased

### Added

- **A guard for Claude Code, if you want one.** `keyprompt install-guard` adds two hooks to Claude Code's user settings after showing them and asking (`--yes` skips the question), and leaves every other setting as it is; `keyprompt uninstall-guard` removes them and works only in your own terminal. With the guard, Claude Code refuses a Bash or PowerShell command that reads a keyprompt secret straight from the OS password store (such as `security find-generic-password -w`) and tells Claude to use `keyprompt run`. It also warns when a message looks like it contains a key, naming the kind of key and never repeating it; it does not block the message. The guard reads command text only, fails open (if it cannot run, Claude Code lets the command through and shows a hook error) and works in Claude Code only. The README and `SECURITY.md` say what it does not stop.
- **`--json` results for agents.** `set`, `has`, `list`, `delete`, `setup` and `log` take `--json` and print one line of JSON on stdout instead of sentences, failures included: the command, a status, the names and the exit code, and for a failure a `message` that says why in keyprompt's own words. A result never holds a value, a reason or what a password-store tool printed, and a message leaves out anything keyprompt did not write itself, such as an invalid name you typed or a store tool's error line. The exit codes do not change. `run` does not take `--json`.
- **`keyprompt setup` asks for a project's keys on one card.** It reads the names from `.env.example` in the current folder (or the file `--from FILE` names), skips the ones already saved, and opens one card for the rest, where every box may stay empty. It reads only a file whose name says it is a template (example, sample, template, schema or dist), so `.env` and `.env.local` are refused before they are opened; it keeps only the names, never the values; it asks for at most 12 at a time, in the file's order; and it writes nothing into the project. The report says what was saved, left empty, already saved and not asked yet, and which `keyprompt run` line to use.
- **A names-only activity log, and `keyprompt log`.** keyprompt now adds one line to `~/.keyprompt/activity.jsonl` when a key is saved, given to a command by `run` (with the program's own name and its exit code), deleted, or put off with Later, Cancel or no answer. A line holds the time, the names and the folder; never a value, a reason, the command's arguments, its output or its environment. The file keeps the newest 1,000 lines, writing it prints nothing, and a log that cannot be written never fails a command. `keyprompt log` shows the newest 50 (`--json` too), with control and invisible characters in a folder or program name shown as `?`. keyprompt processes running at once take turns to trim it.
- **`keyprompt mcp`, a small MCP server.** For agents that call MCP tools: `request_secret` opens the same card as `keyprompt set` and answers with `set --json`'s names-only result, and `check_secrets` says which names are saved. Neither returns a value or the card's address; a key is still used through `keyprompt run` in a shell. It is written by hand, so keyprompt still has one dependency. If the agent cancels a `request_secret` or its connection closes, the card closes; a save already under way still finishes. The README shows how to add it to Claude Code, VS Code, Cursor and Codex.

### Changed

- Exit code 4 now also means you said no to `install-guard` or `uninstall-guard`.
- Exit code 2 now also means `setup` will not read the example file: its name does not say it is a template, it is missing or over 1 MB, or it lists no names.

## 0.2.2 — 2026-11-07

Two things on the card now say what happens: the Save button on a card with an optional box, and the penguin when "Remember on this computer" is unticked.

### Fixed

- **The Save button no longer says "Save all 3" when a box may be left empty.** On a card with an optional box (`keyprompt set A B:optional`, or the card `keyprompt demo` opens), the button counted every box, so pressing it with the optional box empty saved fewer keys than the button said. Now a card with any optional box says plain "Save". A card where every box must be filled still says "Save all 2", and one required box still says "Save securely".
- **The penguin no longer puts the key in the vault when "Remember on this computer" is unticked.** With the box unticked, the key goes to the one command and is not stored, but pressing Save showed the penguin carrying a key into an open vault. Now it holds out an envelope and the vault stays shut while it waits; the vault opens only for a real save. The words on the card were already true. This adds one penguin pose, `handing`, to the 12 before it.

## 0.2.1 — 2026-11-07

Masking catches more copies of a key, `run` refuses a command that spells a key out, and three things that ended wrongly now end right: a save and a delete whose list of names could not be updated, and a `run` card where every box is optional.

### Added

- **Masking catches encoded copies too.** `run` now also replaces the base64, base64url, lowercase hex, URL-encoded and JSON-escaped forms of a value of 8 or more characters with `[keyprompt:NAME]`. Shorter values are still caught only as exact copies. Any other transformation still gets through; `SECURITY.md` has the exact list.
- **`run` refuses a command that spells out a key.** When the value of a name you gave `run` (8 or more characters) appears inside the command itself, `run` stops with exit code 2 and does not start the command. The message names the key and never shows it. Only the exact value is looked for; an encoded copy of it in the command is not.
- **Masking finds a key's base64 inside longer base64.** The `Authorization: Basic` line that `curl -v -u user:KEY` prints is the base64 of `user:KEY`, and masking used to miss the key there unless the text before it was a multiple of 3 bytes long. Now the key's part is replaced with `[keyprompt:NAME]` whatever comes before or after it. The character just before the label can still show up to 4 bits of the key's first byte, and the one just after it up to 4 bits of its last.

### Fixed

- **A save no longer fails because the list of names could not be updated.** `keyprompt list` reads a small file, `~/.keyprompt/catalog.json`, that `set` and `run` update after a save. If that file could not be written or read (a full disk, a folder you cannot write to, a file that is not JSON), the card said "Could not save. Try again." although the key was already in your password store, and once you closed the card the agent was told nothing was saved. Now the card says Saved, `set` and `run` carry on, and one line on stderr says the list of names was not updated. A corrupt `catalog.json` is not repaired.
- **`delete` no longer fails because the list of names could not be updated.** `keyprompt delete NAME` takes the key out of your password store and then takes the name off the list `keyprompt list` shows. If that list could not be read or written, the command ended with exit code 1 and a raw error line although the key was already gone, so the agent was told a delete had failed that had worked. Now `delete` ends as usual (0, or 3 for a name that was not saved) and one line on stderr says the list of names was not updated. A corrupt `catalog.json` is not repaired.
- **`run` no longer gets stuck on a card where every box is optional.** `keyprompt run API_KEY,ORG_ID:optional -- COMMAND` with `API_KEY` already saved opens a card with only the optional `ORG_ID` box. Pressing Save with it empty said "Paste at least one value.", so the only way off the card was Cancel, which stopped the command, and the next run opened the same card again. Now Save works with every box empty when every box on the card is optional: nothing is saved, the card says so, one line on stderr tells the agent the command gets no value for those names from keyprompt, and `run` carries on to the command. `set` still needs at least one value.

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
