---
name: linear-axi
description: Linear AXI CLI workflow. Use when agents need to inspect or mutate Linear teams, issues, labels, relations, or comments, or project a Wayfinder frontier through the standalone `linear-axi` CLI.
---

# Linear AXI

Use `linear-axi` as the Linear interface for agents. It prints data and errors as TOON on stdout and uses AXI exits: `0` success, empty, or no-op; `1` runtime, auth, API, not-found, ambiguity, or conflict error; `2` pre-dependency usage error.

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
linear-axi issues list --fields id,identifier,title,assignee,labels,updatedAt --after <cursor>
linear-axi issues view --id <issue-id-or-key> --full
linear-axi issues create --team <key-or-id> --title "..." --description-file <path> --parent <issue> --label <label>
linear-axi issues assign --id <issue-id-or-key> --assignee me
linear-axi issues unassign --id <issue-id-or-key> --if-assignee me
linear-axi issues close --id <issue-id-or-key>
linear-axi issues update --id <issue-id-or-key> --description-file <path> --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ>
linear-axi labels list --workspace --name <exact-name>
linear-axi labels list --team <key-or-id> --name <exact-name>
linear-axi labels list --issue <issue-id-or-key> --include-archived --fields id,name,archivedAt
linear-axi labels create --workspace --name <name> --color '#5E6AD2' --if-absent
linear-axi labels apply --issue <issue> --label <label>
linear-axi relations create --issue <blocked-issue> --blocked-by <blocker-issue>
linear-axi relations list --issue <blocked-issue> --blocked-by
linear-axi relations create --issue <blocker> --related-issue <blocked> --type blocks
linear-axi relations list --issue <issue> --type blocks --direction both
linear-axi comments list --issue <issue> --limit 50 --full
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

4. Treat every mutating command as a live mutation.
   Completion criterion: run issue create, assign, unassign, close, or description update; label create or apply; relation create; and comment create only after explicit user intent identifies the target and desired change. Auth status, team, issue, label, relation, and comment reads plus Wayfinder frontier remain read-only.

5. Interpret state filters and resolve ambiguity explicitly.
   Completion criterion: treat completed, canceled, and duplicate as the three terminal workflow types. `issues list --state open` excludes all three, while `--state closed` includes all three. Treat missing, archived, and ambiguous identity errors as authoritative. Never pick the first team, issue, label, workflow state, or user candidate. Retry with the intended UUID. Assign only to an active, unarchived, assignable user. Issue summaries retain attached archived label names, so use `labels list --issue <issue> --include-archived --fields id,name,archivedAt` when label status matters.

6. Read TOON stdout directly.
   Completion criterion: do not rerun only to confirm an empty state or error; structured output is authoritative unless the command exits non-zero.

7. Let usage errors self-correct.
   Completion criterion: after exit `2`, use the `help` field from stdout to repair the command in one step.

8. Do not leave stale OAuth listeners running.
   Completion criterion: if a browser handoff times out, is interrupted, or the user lands on `This site can't be reached`, stop the old `auth login` process and restart with a fresh authorize URL. OAuth codes and state are one-use.

9. Handle remote-browser loopback callbacks.
   Completion criterion: if the user approves Linear OAuth and the live browser lands on `http://127.0.0.1:14582/oauth/callback?...` with `This site can't be reached`, keep the still-running `auth login` process alive and paste that full callback URL into the CLI stdin. Then read the waiting CLI output and verify the configured credentials file was written. Do not paste the callback code or resulting tokens in the final answer.

10. Preserve directed relation semantics.
    Completion criterion: prefer `relations create --issue <blocked> --blocked-by <blocker>` and `relations list --issue <blocked> --blocked-by` for blocking relationships. Create maps the blocker to the source and the blocked issue to the target, and names both in its output. List maps to incoming `blocks`, reports the query as top-level `blockedIssue`, and names each row's counterpart `blockerIssue`. Do not combine the shorthand with generic relation flags. For the generic `relations create --type blocks` form, pass the source blocker as `--issue` and the target blocked issue as `--related-issue`. Treat source, target, and type as the relation identity; a reverse relation is distinct. Never create a self-block, including through two references that resolve to the same issue.

11. Treat assignment as a non-atomic claim convention.
    Completion criterion: claim only an unassigned issue, never pass `--replace` for a Wayfinder claim, and release with `--if-assignee me`. Read-after-write verification narrows but cannot eliminate concurrent claim races.

12. Replace descriptions only from the latest version.
    Completion criterion: fetch the full issue, merge locally, then pass the exact canonical `updatedAt` emitted by the CLI to `issues update --if-updated-at`. On conflict, refetch and merge again. Linear has no atomic compare-and-swap, so keep resolution comments canonical and do not claim that the final read/write race is eliminated.

13. Reuse caller-retained mutation UUIDs safely.
    Completion criterion: pass a UUID v4 with `--id` when issue, label, relation, or comment creation must be retryable. Reuse it only for the same intended content and scope. Rich-text comparisons tolerate normalized newlines and Linear's angle-bracket form for HTTP(S) Markdown links. Treat `changed: false` as a successful no-op and any UUID/content conflict as a stop condition.

14. Follow every list cursor exactly.
    Completion criterion: for issue, label, relation, and comment lists, replay the same filters with the returned `page.endCursor` as `--after`. For Wayfinder frontier, use `pageInfo.endCursor`. Never construct or edit a cursor. Relation pages and issue-scoped exact-name label pages are current-state projections, so restart without `--after` when current membership matters.

15. Validate the Wayfinder projection before claiming.
    Completion criterion: require exactly one active production `wayfinder:map` label, or for isolated verification one `WF-VERIFY-<run>:map` label whose type labels use the same prefix. Before candidate loading, require all four active, ordinary, non-group labels to resolve uniquely among workspace and map-team labels, even when the map has no candidates: `<prefix>:research`, `<prefix>:prototype`, `<prefix>:grilling`, and `<prefix>:task`. Then require exactly one of those labels on every direct open, unblocked, unassigned child. Treat any projection error as a metadata repair task, not as an empty frontier.

16. Treat frontier pages as current-state projections.
    Completion criterion: restart without `--after` when current membership or ordering matters. Frontier pagination does not provide snapshot isolation.

## Updating The CLI

- Use `$axi` for output and process-boundary decisions.
- Use `$effect-v4` for Effect code changes.
- Add regression tests for new commands, especially unknown flags, missing required flags, truncation, and live-mutation guards.
- Verify with `bun run check`.
