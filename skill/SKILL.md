---
name: keyprompt
description: Get and use API keys, tokens and other secrets without the user pasting them into the chat. Use whenever a task needs a credential (an API key, a token, a password for a CLI, a webhook secret), whenever you are about to ask the user to paste one, or when the user pastes one anyway. keyprompt opens a secure secret card in the user's browser, saves the value in the OS password store (macOS Keychain, Windows Credential Manager, Linux keyring), and injects it into a command's environment, so the value never enters the conversation.
---

# keyprompt: secrets without the chat

The value of a secret must never enter this conversation: not from the user, not from a command's output, not from a file you read. keyprompt makes that the default path.

If `keyprompt` is not on PATH, use `npx -y keyprompt` in its place in every command below.

## Rules

1. **Never ask the user to paste a secret into the chat.** Ask with the card instead (below).
2. **Never print a secret.** No `echo $KEY`, no `cat .env`, no `printenv`, no `security find-generic-password -w`, no debug flags that dump headers (`curl -v` with an auth header).
3. **Never write a secret to a file or pass it on your own command line.** It reaches a program only through `keyprompt run`.
4. **If the user pastes a secret into the chat anyway, treat it as exposed.** Tell them it is now in the conversation log, recommend rotating it at the provider, and store the new value with the card. Do not reuse the pasted one.

## Check before asking

```
keyprompt has OPENAI_API_KEY      # exit 0 = saved, exit 3 = not saved
keyprompt list                    # names, reasons, dates; never values
```

## Ask for a secret

Run this yourself (do not ask the user to run it). It opens a secure card in the user's browser and blocks until they save, cancel or choose Later:

```
keyprompt set OPENAI_API_KEY --reason "Run the note-quality eval against gpt-4o-mini"
```

Then tell the user, in one line: "I opened a secure card in your browser for OPENAI_API_KEY. Paste the key there; it goes to your keychain, not to me."

Use an environment-variable style name that matches what the program expects (`OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `GITHUB_TOKEN`). Write `--reason` for the user: what it is for, in plain words.

### One card for everything you need right now

Put every value the next step needs on one card, so the user is interrupted once. Never ask for a key you don't need yet.

```
keyprompt set TWILIO_ACCOUNT_SID:visible TWILIO_AUTH_TOKEN --reason "Send a test SMS"
```

Each item is a FIELD: a NAME, then optional hints after a colon. Separate fields with spaces or commas; a card takes up to 12.

| Hint | What the box does |
|---|---|
| `:visible` | Shows what is typed. For an ID that is not secret, like the Twilio account SID above. |
| `:multiline` | A paste box that keeps line breaks. For a PEM private key or a JSON key file. |
| `:optional` | May stay empty. With `run`, the user may leave every optional box empty and press Save: nothing is saved, keyprompt gives the command no value for those names, and `run` carries on to the command, which must cope without them. `set` needs at least one value. |

Hints only change how a box looks on the card. Every value is still saved the same way and masked in `run` output, whatever the hint; a hint never makes a value safe to print.

### What the command returns

| Exit | Meaning |
|---|---|
| 0 | Saved. |
| 4 | The user cancelled the card. Nothing was saved. |
| 5 | Nobody filled it in within 5 minutes. Nothing was saved. |
| 6 | The user chose **Later**. Nothing was saved. |
| 1 | Something failed; the message says what. |

On exit 6, tell the user in one line that you will carry on without it ("OK, I'll leave OPENAI_API_KEY for later and carry on"), then do the work that doesn't need it. Ask again only when you are about to use it. Never run the command again straight away: that just reopens the card the user dismissed.

## Use a secret

```
keyprompt run OPENAI_API_KEY -- python eval.py
keyprompt run OPENAI_API_KEY,ANTHROPIC_API_KEY -- npm test
keyprompt run TWILIO_ACCOUNT_SID:visible,TWILIO_AUTH_TOKEN -- python send_sms.py
```

- The program reads the secret from its environment (`$OPENAI_API_KEY`). If a name is not saved yet, `run` opens one card for the missing names (hints work here too; names already saved are not asked again). The user can untick **Remember on this computer** to give a value for this one command only.
- `run` can stop before the command starts, with a message starting `keyprompt:` and an exit code from the table above (for example 4, 5 or 6). On exit 6 the command did not run; follow the exit 6 advice above. Once the command has started, the exit code is the command's own.
- Copies of the value in the command's output are replaced with `[keyprompt:NAME]`: the exact value and, for a value of 8 or more characters, its base64 (also inside longer base64, such as `user:KEY` in `curl -v -u`, where a few bits at the key's two ends can still show), base64url, lowercase hex, URL-encoded and JSON-escaped forms. Other transformations (part of the value, a hash) are usually not caught, so still never print secrets on purpose.
- When a tool needs the value as an argument, let a shell inside `run` expand it, so it never appears in your own command text:
  - macOS / Linux: `keyprompt run API_TOKEN -- sh -c 'curl -sS -H "Authorization: Bearer $API_TOKEN" https://api.example.com/me'`
  - Windows (PowerShell): `keyprompt run API_TOKEN -- powershell -NoProfile -Command "Invoke-RestMethod https://api.example.com/me -Headers @{Authorization = 'Bearer ' + $env:API_TOKEN}"`
- Don't use `--no-redact`. It turns masking off and is meant for a person running a full-screen program in their own terminal. When the output is not a terminal, as in your shell tool, it stops with exit code 2.

## If keyprompt's guard refuses a command

With keyprompt's guard installed, Claude Code refuses a command that reads a saved secret straight from the password store; the reason starts `keyprompt guard:` (Claude Code shows it as a hook error). Run the command that needs the secret as `keyprompt run NAME -- COMMAND` instead. Never try another way round the guard: no script file, no encoded command, no other tool, no editing Claude Code's settings and no `keyprompt uninstall-guard`. If the words were only text you were writing to a file (a heredoc, say), write the file with your file-editing tool instead.

When a message comes with a note from keyprompt's guard that it looks like it contains a key, follow rule 4.

## Replace or remove

- Wrong value or rotated key: run `keyprompt set NAME` again; the card says "Replace secret". With several names, a box the user leaves empty keeps its saved value.
- `keyprompt delete NAME` removes it.

## Size limits

The OS password store caps how long one value can be. Windows holds 1,280 characters. macOS holds about 4,000 bytes on one line, or about 2,000 with line breaks (a shorter name leaves a little more room). A value that is too long is refused and the card says so, with the numbers.

## When it can't work

keyprompt needs a desktop session to open the card. Over plain SSH or in CI it fails with a clear message: then tell the user to configure the secret in that environment's own secret store (for example GitHub Actions secrets), never to paste it to you.
