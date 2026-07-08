---
name: linear-axi
description: Linear AXI CLI workflow. Use when agents need to inspect or mutate Linear teams, issues, or comments through the local `linear-axi` Bun CLI, or when updating that CLI's agent-facing behavior.
---

# Linear AXI

Use `linear-axi` as the Linear interface for agents in this repo. It prints TOON on stdout and uses AXI exits: `0` success, `1` runtime/auth/API failure, `2` usage error.

## Commands

Run through Bun from the repo unless a packaged binary is on PATH:

```sh
bun src/main.ts
bun src/main.ts auth status
bun src/main.ts auth login --notify
bun src/main.ts teams list --limit 50
bun src/main.ts issues list --assignee me --limit 20
bun src/main.ts issues list --team <key-or-id> --limit 20
bun src/main.ts issues view --id <issue-id-or-key>
bun src/main.ts issues create --team <key-or-id> --title "..." --description "..."
bun src/main.ts comments create --issue <issue-id-or-key> --body "..."
```

## Rules

1. Check auth before live work when credentials are uncertain.
   Completion criterion: `auth status` returns `authenticated: true`, or the user is told to set `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN`.

2. Treat create/comment commands as live mutations.
   Completion criterion: only run them after explicit user intent names the issue/team/title/body or asks for that exact mutation.

3. Read TOON stdout directly.
   Completion criterion: do not rerun only to confirm an empty state or error; structured output is authoritative unless the command exits non-zero.

4. Let usage errors self-correct.
   Completion criterion: after exit `2`, use the `help` field from stdout to repair the command in one step.

5. Keep credentials out of output and prompts.
   Completion criterion: never ask the user to paste tokens; only ask them to configure environment variables outside the transcript.

6. For OAuth login with the live browser, navigate before handoff.
   Completion criterion: start `auth login`, copy the exact authorize URL from stderr, use `chrome-devtools-axi open <authorize-url>`, and verify the snapshot shows `axi-cli is requesting access` for the intended workspace before telling the user to open the live browser or click Authorize. The live WebRTC URL mirrors the shared browser's current tab; it does not navigate to the OAuth URL by itself.

7. Do not leave stale OAuth listeners running.
   Completion criterion: if a browser handoff times out, is interrupted, or the user lands on `This site can't be reached`, stop the old `auth login` process and restart with a fresh authorize URL. OAuth codes and state are one-use.

8. Handle remote-browser loopback callbacks.
   Completion criterion: if the user approves Linear OAuth and the live browser lands on `http://127.0.0.1:14582/oauth/callback?...` with `This site can't be reached`, keep the still-running `auth login` process alive and paste that full callback URL into the CLI stdin. Then read the waiting CLI output and verify `.env` was written. Do not paste the callback code or resulting tokens in the final answer.

## Updating The CLI

- Use `$axi` for output and process-boundary decisions.
- Use `$effect-v4` for Effect code changes.
- Add regression tests for new commands, especially unknown flags, missing required flags, truncation, and live-mutation guards.
- Verify with `bun run check`.
