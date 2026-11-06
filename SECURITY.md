# Security

keyprompt keeps secrets out of AI agents' conversations. This page says exactly what that covers.

## What it protects against

| Risk | How |
|---|---|
| A key pasted into an AI chat ends up in the transcript, the model's context and cloud logs | The key is typed into a card in your browser, never into the chat. |
| An agent printing a key (on purpose, by mistake, or after a prompt injection) | There is no keyprompt command that outputs a saved value (see the limits below). `run` puts it only into the environment of the command it starts. |
| A command echoing the key in its output (`curl -v`, stack traces, debug logs) | `run` replaces exact copies of the value in stdout and stderr with `[keyprompt:NAME]`, including copies split across output chunks (not with `--no-redact`, see below). |
| The key appearing in a process list or shell history | The value never travels as a command-line argument: keyprompt hands it to the OS store over stdin (`security -i` on macOS, PowerShell on Windows, `secret-tool` on Linux) and reads it back over stdout. |
| Another website or another local process filling or reading the card | The card server listens on 127.0.0.1 only, on a random port, behind a 256-bit one-time path token. Requests must carry `Host: 127.0.0.1:<port>` (blocks DNS-rebinding pages) and a POST must carry that exact `Origin` (blocks other sites). JSON only, size-capped. One successful submit, then the card is spent; it stops accepting anything after 5 minutes. The page sends a strict Content-Security-Policy, `no-store`, `no-referrer` and `X-Frame-Options: DENY`. |
| The card link leaking to the agent | The link is opened directly in the browser and is not printed, except to a human-attended terminal (a TTY) when no browser could be launched. |

## What it does not protect against

- **Malware or anything else running as you.** It can read your OS password store directly, like any app you've granted access. keyprompt is a context boundary for AI agents, not a vault against your own account.
- **The agent itself.** It can read a saved key straight from the OS store (for example with `security find-generic-password` on macOS), because it runs as you. keyprompt's skill tells it not to; nothing stops it.
- **`run --no-redact`.** This option passes the command's output through untouched, so a command that prints the key shows it. It works only when keyprompt's output goes straight to a terminal. When it does not (a pipe or a file, as in Claude Code's shell tool), `run` stops with exit code 2 before reading a key. That stops an agent from turning masking off by accident, not on purpose: an agent whose commands run in a real terminal, or one that starts keyprompt inside a program that makes a terminal (such as `script`), can still use it. keyprompt's skill tells it not to.
- **A command that transforms the secret before printing it** (base64, URL-encoding, part of the value, hashing). Masking only catches exact copies.
- **A command that sends the secret somewhere.** `run` gives the key to the command you name; if that command is malicious, it can use or send the key. Read what an agent proposes to `run`.
- **The `reason` on the card is written by the agent.** It tells you what the agent claims; check the secret's name and whether the request makes sense before pasting.
- **A shell that expands the value into another program's arguments** (`sh -c 'curl -H "Authorization: Bearer $TOKEN" …'`). The value never reaches the agent, but it is briefly visible in that program's process arguments on your machine.
- **Your clipboard.** Copying a key to paste it puts it on the clipboard, where other apps can read it.

## If a key was pasted into a chat

Treat it as exposed: rotate it at the provider (create a new one, revoke the old one), then save the new one with `keyprompt set`. Deleting the message usually does not remove it from logs.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.
