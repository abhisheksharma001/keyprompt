# keyprompt

**Give API keys to AI coding agents without pasting them into the chat.**

When an agent (Claude Code, Codex, Cursor, …) needs a key, it runs one command. A secure card opens in your browser, you paste the key there, and it goes straight into your computer's password store: the macOS Keychain, Windows Credential Manager, or the Linux keyring. The agent then uses the key without ever seeing it.

<p align="center">
  <img src="docs/card.png" width="380" alt="The keyprompt secret card: the secret's name, why it is needed, a masked field, Cancel and Save securely">
  &nbsp;
  <img src="docs/saved.png" width="380" alt="After saving: Saved securely and kept private, never shown to your agent">
</p>

## Why

A key pasted into an AI chat is in the conversation log for good: in the transcript, in the model's context, often synced to the cloud. You can't take it back, so the only safe fix is to rotate the key. keyprompt makes the safe path the easy one:

- **The value never enters the chat.** It travels from your clipboard to the card to the OS password store.
- **Agents use keys, not see them.** `keyprompt run` puts the key into one command's environment and masks any copy of it in that command's output.
- **There is no "get" command.** Nothing prints a saved key, so an agent can't be talked into revealing one.
- **Works on Windows, macOS and Linux**, with nothing to sign up for and no cloud service.

## Install

Needs Node.js 18.17 or later.

```sh
npm install -g github:abhisheksharma001/keyprompt
keyprompt install-skill        # teach Claude Code to use it
```

Or run it without installing: `npx -y github:abhisheksharma001/keyprompt <command>`.

On Linux, also install `secret-tool`: `sudo apt install libsecret-tools` (Debian/Ubuntu) or `sudo dnf install libsecret` (Fedora). macOS and Windows need nothing extra.

## How it works for you

1. You ask your agent to do something that needs a key ("run the eval", "deploy to Fly").
2. The agent runs `keyprompt set OPENAI_API_KEY --reason "..."` and tells you a card opened.
3. You paste the key into the card and click **Save securely**.
4. From then on the agent runs commands with the key, e.g. `keyprompt run OPENAI_API_KEY -- python eval.py`, and never sees the value. Next week, in a new chat, it's still there: no popup.

## Commands

| Command | What it does |
|---|---|
| `keyprompt set NAME [--reason TEXT]` | Opens the secret card. Saves the value in the OS password store. Waits until you save or cancel. If NAME already exists, the card says **Replace secret**; the old value is never shown. |
| `keyprompt run NAME[,NAME...] -- COMMAND` | Runs COMMAND with `$NAME` set. A key that isn't saved yet opens the card first, where you can also choose **this run only**. Exact copies of the value in COMMAND's output appear as `[keyprompt:NAME]`. |
| `keyprompt has NAME` | Exit 0 if saved, 3 if not. Never shows the value. |
| `keyprompt list` | Saved names, reasons and dates. Never values. |
| `keyprompt delete NAME` | Removes it from the password store. |
| `keyprompt install-skill` | Installs the Claude Code skill (`~/.claude/skills/keyprompt/SKILL.md`). |

Names look like environment variables (`OPENAI_API_KEY`, `STRIPE_SECRET_KEY`), because that's what `run` sets.

Options: `--reason TEXT` (shown on the card: why it's needed), `--by TEXT` (shown on the card: who's asking), `--no-redact` (pass output through untouched, for full-screen terminal programs).

Exit codes: `0` ok, `2` bad usage, `3` not saved, `4` you cancelled the card, `5` nobody filled it in within 5 minutes. `run` exits with the command's own exit code.

## For agents

**Claude Code:** run `keyprompt install-skill` once. The skill tells Claude never to ask for keys in chat and to use `keyprompt` instead.

**Codex, Cursor, Gemini CLI and anything that reads `AGENTS.md`:** add this block to your `AGENTS.md` (project or global):

```markdown
## Secrets (API keys, tokens)
- Never ask the user to paste a secret into the chat, and never print, echo, log or write one to a file.
- To get a secret, run `keyprompt set NAME --reason "<why, in plain words>"` yourself. It opens a secure card in the user's browser and waits; tell the user a card opened.
- To use one, run `keyprompt run NAME -- <command>`; the command reads it from `$NAME`. `keyprompt has NAME` checks whether it exists.
- If the user pastes a secret into the chat anyway, tell them it is now exposed and should be rotated, then store the new one with `keyprompt set`.
- If `keyprompt` is not installed, use `npx -y github:abhisheksharma001/keyprompt` instead.
```

Using a key as a command-line argument (an `Authorization` header, say)? Let a shell inside `run` expand it, so the value never appears in the agent's own command:

```sh
keyprompt run API_TOKEN -- sh -c 'curl -sS -H "Authorization: Bearer $API_TOKEN" https://api.example.com/me'
```

On Windows: `keyprompt run API_TOKEN -- powershell -NoProfile -Command "Invoke-RestMethod https://api.example.com/me -Headers @{Authorization = 'Bearer ' + $env:API_TOKEN}"`

## Where keys are stored

| OS | Store | Item |
|---|---|---|
| macOS | Login Keychain (Keychain Access app) | service `keyprompt`, account `NAME` |
| Windows | Credential Manager → Windows Credentials | generic credential `keyprompt:NAME` |
| Linux | Secret Service (GNOME Keyring / KWallet) | attributes `service=keyprompt account=NAME` |

You can see or delete them there yourself at any time. `~/.keyprompt/catalog.json` keeps names, reasons and dates for `keyprompt list`; it never holds a value.

## Limits

- Needs a desktop session to open the card. Over plain SSH or in CI it stops with a clear message; use that environment's own secret store (GitHub Actions secrets, for example).
- Masking catches exact copies of a value. A program that prints a key base64-encoded, URL-encoded or only partly is not masked, so agents must still not print secrets on purpose.
- Windows Credential Manager holds values up to 1,280 characters. On macOS, values must be a single line.

See [SECURITY.md](SECURITY.md) for exactly what keyprompt protects against and what it doesn't.

## Development

```sh
npm install
npm test                                  # unit tests
KEYPROMPT_STORE_TEST=1 npm test           # plus a real round trip through this machine's password store
```

`KEYPROMPT_BROWSER=/path/to/program` opens the card with a specific browser (or a test driver) instead of the default one.

## License

MIT
