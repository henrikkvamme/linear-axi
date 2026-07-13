---
name: linear-axi
description: Linear AXI CLI workflow. Use when agents need to inspect or mutate Linear teams, issues, or comments through the standalone `linear-axi` CLI, or when updating that CLI's agent-facing behavior.
---

# Linear AXI

Use `linear-axi` as the Linear interface for agents. It prints TOON on stdout and uses AXI exits: `0` success, `1` runtime/auth/API failure, `2` usage error.

Invoke it as `linear-axi <command>` when the binary is on PATH. If you are working inside the source checkout before installing a binary, use `bun src/main.ts <command>`.

## Commands

```sh
linear-axi
linear-axi auth status
linear-axi auth login
linear-axi auth login --notify
linear-axi auth login --no-open
linear-axi teams list --limit 50
linear-axi issues list --assignee me --limit 20
linear-axi issues list --team <key-or-id> --limit 20
linear-axi issues list --parent <issue-id-or-key> --label <id-or-name> --assignee none --state open --limit 100
linear-axi issues view --id <issue-id-or-key>
linear-axi issues create --team <key-or-id> --title "..." --description-file <path> --parent <issue> --label <label>
linear-axi issues assign --id <issue-id-or-key> --assignee me
linear-axi issues unassign --id <issue-id-or-key> --if-assignee me
linear-axi issues close --id <issue-id-or-key>
linear-axi issues update --id <issue-id-or-key> --description-file <path> --if-updated-at <RFC3339>
linear-axi labels list --workspace --name <exact-name>
linear-axi labels create --workspace --name <name> --color '#5E6AD2' --if-absent
linear-axi labels apply --issue <issue> --label <label>
linear-axi relations create --issue <blocker> --related-issue <blocked> --type blocks
linear-axi relations list --issue <issue> --direction both
linear-axi comments list --issue <issue> --limit 50
linear-axi comments create --issue <issue> --body-file <path> --id <retained-uuid-v4>
linear-axi wayfinder frontier --map <map-issue> --first 20
```

## Rules

1. Check auth before live work when credentials are uncertain.
   Completion criterion: `auth status` returns `authenticated: true`, or immediately start the OAuth flow below. Never ask the user to paste a token.

2. Use the zero-configuration OAuth login when unauthenticated.
   Completion criterion: run `linear-axi auth login` on the user's machine. It opens the default browser. Ask the user to select the intended Linear workspace and click Authorize, keep the CLI process alive, then verify `linear-axi auth status` reports `authenticated: true`. The token is stored with private permissions in `$XDG_CONFIG_HOME/linear-axi/credentials.env`, or `~/.config/linear-axi/credentials.env` when `XDG_CONFIG_HOME` is unset. If `LINEAR_AXI_ENV_FILE` is set in the process environment, that file is used instead. No OAuth app registration or token paste is required. Use `--no-open` only when the authorize URL should be opened manually.

3. Use the shared browser flow when the CLI runs remotely.
   Completion criterion: start `linear-axi auth login --notify` in a persistent exec session, copy the exact authorize URL from stderr, use `chrome-devtools-axi open <authorize-url>`, and verify the snapshot shows `axi-cli is requesting access`. Hand the browser to the user so they can select the intended workspace and click Authorize. The live WebRTC URL mirrors the shared browser's current tab and does not navigate by itself.

4. Treat create/comment commands as live mutations.
   Completion criterion: only run them after explicit user intent names the issue/team/title/body or asks for that exact mutation.

5. Read TOON stdout directly.
   Completion criterion: do not rerun only to confirm an empty state or error; structured output is authoritative unless the command exits non-zero.

6. Let usage errors self-correct.
   Completion criterion: after exit `2`, use the `help` field from stdout to repair the command in one step.

7. Do not leave stale OAuth listeners running.
   Completion criterion: if a browser handoff times out, is interrupted, or the user lands on `This site can't be reached`, stop the old `auth login` process and restart with a fresh authorize URL. OAuth codes and state are one-use.

8. Handle remote-browser loopback callbacks.
   Completion criterion: if the user approves Linear OAuth and the live browser lands on `http://127.0.0.1:14582/oauth/callback?...` with `This site can't be reached`, keep the still-running `auth login` process alive and paste that full callback URL into the CLI stdin. Then read the waiting CLI output and verify the configured credentials file was written. Do not paste the callback code or resulting tokens in the final answer.

9. Preserve directed blocking semantics.
   Completion criterion: for `relations create --type blocks`, pass the blocker as `--issue` and the blocked issue as `--related-issue`. A reverse relation is distinct.

10. Treat assignment as a non-atomic claim convention.
    Completion criterion: claim only an unassigned issue, never pass `--replace` for a Wayfinder claim, and release with `--if-assignee me`. Read-after-write verification narrows but cannot eliminate concurrent claim races.

11. Replace descriptions only from the latest version.
    Completion criterion: fetch the full issue, merge locally, then pass that exact `updatedAt` to `issues update --if-updated-at`. On conflict, refetch and merge again. Linear has no atomic compare-and-swap, so keep resolution comments canonical and do not claim that the final read/write race is eliminated.

12. Treat frontier pages as current-state projections.
    Completion criterion: follow `pageInfo.endCursor` with `--after`, but restart without `--after` when current membership or ordering matters. Frontier pagination does not provide snapshot isolation.

## Updating The CLI

- Use `$axi` for output and process-boundary decisions.
- Use `$effect-v4` for Effect code changes.
- Add regression tests for new commands, especially unknown flags, missing required flags, truncation, and live-mutation guards.
- Verify with `bun run check`.
