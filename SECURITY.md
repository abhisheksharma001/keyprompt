# Security

keyprompt keeps secrets out of AI agents' conversations. This page says exactly what that covers.

## What it protects against

| Risk | How |
|---|---|
| A key pasted into an AI chat ends up in the transcript, the model's context and cloud logs | The key is typed into a card in your browser, never into the chat. |
| An agent printing a key (on purpose, by mistake, or after a prompt injection) | There is no keyprompt command that outputs a saved value (see the limits below). `run` puts it only into the environment of the command it starts. |
| A command echoing the key in its output (`curl -v`, stack traces, debug logs) | `run` replaces copies of the value in stdout and stderr with `[keyprompt:NAME]`, including copies split across output chunks (not with `--no-redact`, see below). A copy is the exact value or, for a value of 8 or more characters, one of these encoded forms of the whole value: base64 and base64url, each with or without `=` padding, also when the value was encoded together with other text (the `Authorization: Basic` line that `curl -v -u user:KEY` prints is the base64 of `user:KEY`; there the character just before `[keyprompt:NAME]` can still show up to 4 bits of the value's first byte, and the character just after it up to 4 bits of its last); lowercase hex; URL-encoding with uppercase `%XX`, as JavaScript's `encodeURIComponent` or RFC 3986 writes it; and JSON string escaping (`\"`, `\n`). A value under 8 characters is caught only as an exact copy, because its encoded forms are short enough to turn up in ordinary output by chance. |
| The key appearing in a process list or shell history | The value never travels as a command-line argument: keyprompt hands it to the OS store over stdin (`security -i` on macOS, PowerShell on Windows, `secret-tool` on Linux) and reads it back over stdout. |
| Another website or another local process filling or reading the card | The card server listens on 127.0.0.1 only, on a random port, behind a 256-bit one-time path token. Requests must carry `Host: 127.0.0.1:<port>` (blocks DNS-rebinding pages) and a POST must carry that exact `Origin` (blocks other sites). JSON only, size-capped. One successful submit, then the card is spent; it stops accepting anything after 5 minutes. The page sends a strict Content-Security-Policy, `no-store`, `no-referrer` and `X-Frame-Options: DENY`. |
| The card link leaking to the agent | The link is opened directly in the browser and is not printed, except to a human-attended terminal (a TTY) when no browser could be launched. |

## What it does not protect against

- **Malware or anything else running as you.** It can read your OS password store directly, like any app you've granted access. keyprompt is a context boundary for AI agents, not a vault against your own account.
- **The agent itself.** It can read a saved key straight from the OS store (for example with `security find-generic-password` on macOS), because it runs as you. keyprompt's skill tells it not to. In Claude Code, after you run `keyprompt install-guard`, a guard also refuses the obvious direct reads: a Bash or PowerShell command that runs the store's own read tool on a keyprompt item (`security find-generic-password` with `-w` or `-g`, `security dump-keychain -d`, `secret-tool lookup` or `search`, `Get-StoredCredential`, or CredRead through `Add-Type`). The guard is a guardrail, not a wall:
  - **It reads command text only.** A script file, an encoded command or another tool can still reach the store, and an agent that can edit Claude Code's settings file can remove the guard.
  - **It fails open.** If it cannot start, crashes, prints invalid JSON or takes longer than 10 seconds, Claude Code lets the command through and shows a hook error. Removing the Node version or the keyprompt install the hook points at does the same; running `keyprompt install-guard` again fixes it.
  - **It covers Claude Code only**, and only where you ran `install-guard`. Anywhere else, keyprompt does nothing to stop the agent reading the store.
- **`run --no-redact`.** This option passes the command's output through untouched, so a command that prints the key shows it. It works only when keyprompt's output goes straight to a terminal. When it does not (a pipe or a file, as in Claude Code's shell tool), `run` stops with exit code 2 before reading a key. That stops an agent from turning masking off by accident, not on purpose: an agent whose commands run in a real terminal, or one that starts keyprompt inside a program that makes a terminal (such as `script`), can still use it. keyprompt's skill tells it not to.
- **A command that transforms the secret in any other way before printing it.** Masking catches only the exact value and the encoded forms listed above. Not caught, for example: uppercase hex, part of the value, a hash, any other encoding, or base64 broken across lines in the middle of the value.
- **A command that sends the secret somewhere.** `run` gives the key to the command you name; if that command is malicious, it can use or send the key. Read what an agent proposes to `run`.
- **The `reason` and the "who is asking" on the card are written by the agent.** With `keyprompt mcp`, "who is asking" is the MCP client's own name for itself, as with `--by` it is whatever the agent typed. Both tell you what the agent claims; check the secret's name and whether the request makes sense before pasting.
- **`keyprompt mcp` only asks for keys and checks them.** No tool returns a value, and a key still reaches a program only through `keyprompt run` in a shell, so everything on this page about `run` still applies.
- **The activity log is a record, not proof.** `~/.keyprompt/activity.jsonl` holds names, program names and folders, never a value, but anything running as you can edit or delete it, and its folder paths can name a client or a project. A `run` line is written when the command ends, so a keyprompt that is killed with SIGKILL or crashes during a command leaves no line for it (on Ctrl-C it passes the signal on to the command and still writes the line). When several keyprompt processes write at once, they take turns to trim the file, and a line can still be lost when a writer appends without its turn (it waited more than about 2 seconds, or could not make the lock file), when a writer is stopped for over 10 seconds in the middle of trimming (a laptop asleep, a suspended process), or when two writers clear the same stale lock at the same moment.
- **A shell that expands the value into another program's arguments** (`sh -c 'curl -H "Authorization: Bearer $TOKEN" …'`). The value never reaches the agent, but it is briefly visible in that program's process arguments on your machine.
- **Your clipboard.** Copying a key to paste it puts it on the clipboard, where other apps can read it.

## If a key was pasted into a chat

Treat it as exposed: rotate it at the provider (create a new one, revoke the old one), then save the new one with `keyprompt set`. Deleting the message usually does not remove it from logs.

With the guard installed, Claude Code also shows a warning when a message looks like it contains a key. The warning names the kind of key and never repeats it. The guard does not stop the message, so the key has still reached Claude: rotate it all the same.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.
