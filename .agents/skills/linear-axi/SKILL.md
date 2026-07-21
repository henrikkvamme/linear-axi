---
name: linear-axi
description: Linear AXI CLI workflow. Use when agents need to inspect or safely mutate Linear issues, attachments, projects, documents, releases, milestones, status updates, labels, relations, comments, teams, or users, or project a Wayfinder frontier.
---

# Linear AXI

Use `linear-axi` as the Linear interface for agents. It prints data and errors as TOON on stdout and uses AXI exits: `0` success, empty, or no-op; `1` runtime, auth, API, not-found, ambiguity, or conflict error; `2` pre-dependency usage error.

Invoke it as `linear-axi <command>` when the binary is on PATH. If you are working inside the source checkout before installing a binary, use `bun src/main.ts <command>`.

## Commands

Read `COMMANDS.md` for the exact generated command, flag, usage, example, and command-specific safety reference.

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
linear-axi workflow-states list --team <key-or-id>
linear-axi issues state --id <issue> --state <id-or-unambiguous-name>
linear-axi issues parent set --id <child> --parent <parent>
linear-axi issues parent clear --id <child>
linear-axi issues update --id <issue-id-or-key> --description-file <path> --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ>
linear-axi issues update --id <issue> --priority 2 --due-date 2026-08-01 --project <project> --cycle <cycle>
linear-axi labels list --workspace --name <exact-name>
linear-axi labels list --team <key-or-id> --name <exact-name>
linear-axi labels list --issue <issue-id-or-key> --include-archived --fields id,name,archivedAt
linear-axi labels create --workspace --name <name> --color '#5E6AD2' --if-absent
linear-axi labels add --issue <issue> --label <label>
linear-axi labels remove --issue <issue> --label <label>
linear-axi labels replace --issue <issue> --labels-json '["Bug","Urgent"]'
linear-axi relations create --issue <blocked-issue> --blocked-by <blocker-issue>
linear-axi relations list --issue <blocked-issue> --blocked-by
linear-axi relations create --issue <blocker> --related-issue <blocked> --type blocks
linear-axi relations list --issue <issue> --type blocks --direction both
linear-axi relations remove --issue <blocked> --blocked-by <blocker>
linear-axi comments list --issue <issue> --limit 50 --full
linear-axi comments create --issue <issue> --body-file <path> --id <retained-uuid-v4>
linear-axi attachments list --issue <issue> --limit 100
linear-axi attachments view --id <attachment-id>
linear-axi attachments read --id <attachment-id> --max-bytes 32768
linear-axi attachments download --id <attachment-id> --output ./attachment.bin
linear-axi attachments upload --issue <issue> --file ./attachment.txt --title "Attachment"
linear-axi wayfinder frontier --map <map-issue> --first 20
linear-axi teams search --query <name>
linear-axi teams view --query <id-key-or-name>
linear-axi users list --query <name-or-email>
linear-axi users view --query <id-name-or-email>
linear-axi issues search --team <team> --query <text>
linear-axi issues inspect --id <issue> --relations --full
linear-axi comments search --project-id <project-id>
linear-axi cycles list --team-id <team-id> --type current
linear-axi documents list --query <text>
linear-axi documents view --id <id-or-slug> --full
linear-axi documents update --id <document-id> --title "New title"
linear-axi projects list --team <team>
linear-axi projects view --query <id-name-or-slug> --full
linear-axi projects update --id <project-id> --state <state>
linear-axi project-labels list --name <name>
linear-axi milestones list --project <project>
linear-axi milestones view --project <project> --query <id-or-name>
linear-axi milestones update --project <project> --id <milestone-id> --target-date YYYY-MM-DD
linear-axi release-pipelines list --team <team>
linear-axi releases list --pipeline <pipeline>
linear-axi releases view --id <id-or-slug>
linear-axi releases update --id <release-id> --stage <stage>
linear-axi release-notes list --pipeline <pipeline>
linear-axi release-notes view --id <id-or-slug> --full
linear-axi release-notes update --id <note-id> --title "New title"
linear-axi diffs list --repo <repository>
linear-axi diffs view --id <url-or-id> --full
linear-axi diffs threads --id <url-or-id>
linear-axi status-updates list --type project --project <project>
linear-axi status-updates view --type project --id <update-id>
linear-axi status-updates update --type project --id <update-id> --health onTrack
linear-axi agent-skills list
linear-axi agent-skills view --id <skill-id> --full
linear-axi docs search --query <question>
```

Official MCP intent mapping:

- Find richer issues or relations: `issues search`, then `issues inspect --relations --full`.
- Find or change workflow: `workflow-states list`, then `issues state`.
- Manage labels safely: `labels list`, then `labels add`, `labels remove`, or explicit `labels replace`.
- Manage hierarchy and dependencies: `issues parent set|clear`, `issues list --parent`, and `relations create|list|remove` with `--blocked-by`.
- Resolve members: `users list|view`; assignment accepts `me`, id, email, name, or display name and rejects ambiguous matches.
- Inspect product work: `projects list|view`, `milestones list|view`, `documents list|view`, `cycles list`, and `project-labels list`.
- Update existing product objects: `projects update`, `milestones update`, `documents update`, `status-updates update`, `releases update`, and `release-notes update`.
- Inspect releases and engineering context: `release-pipelines list`, `releases list|view`, `release-notes list|view`, and `diffs list|view|threads`.
- Inspect comments on any official parent: `comments search`; use `comments list` for the richer native issue view.
- Discover official guidance: `agent-skills list|view` and `docs search`.

The checked `docs/linear-mcp-parity.json` records all 47 observed official tools and every intentional decision status. `official` commands use the hosted tool, `native` commands use the SDK equivalent, and `native+official` combines both routes. Official-backed commands use the one credential selected by the CLI's documented precedence and need no separate MCP configuration. Do not improvise raw GraphQL or retry an unavailable create, delete, or binary operation. Ask for the scoped decision named in that manifest.

Conditional official command contracts:

- `comments search` requires exactly one parent flag; `--status-update-type` requires `--status-update-id`.
- `documents update` accepts at most one new parent among project, issue, initiative, and cycle. `--team` may accompany `--cycle` to identify its team; otherwise team participates in the one-parent constraint.
- `release-notes update --range-from` and `--range-to` must be provided together and cannot combine with `--releases-json`.
- `status-updates update` accepts at most one of project and initiative, and the parent flag must match `--type`.
- Every official `update` needs at least one property. Dates, timestamps, numeric ranges, and JSON arrays are validated before dispatch.

## Rules

1. Check auth before live work when credentials are uncertain.
   Completion criterion: `auth status` returns `authenticated: true`, or immediately start the OAuth flow below. Never ask the user to paste a token.

2. Use the zero-configuration OAuth login when unauthenticated.
   Completion criterion: run `linear-axi auth login` on the user's machine. It opens the default browser. Ask the user to select the intended Linear workspace and click Authorize, keep the CLI process alive, then verify `linear-axi auth status` reports `authenticated: true`. The token is stored with private permissions in `$XDG_CONFIG_HOME/linear-axi/credentials.env`, or `~/.config/linear-axi/credentials.env` when `XDG_CONFIG_HOME` is unset. If `LINEAR_AXI_ENV_FILE` is set in the process environment, that file is used instead. No OAuth app registration or token paste is required. Use `--no-open` only when the authorize URL should be opened manually.

3. Use the shared browser flow when the CLI runs remotely.
   Completion criterion: start `linear-axi auth login --notify` in a persistent exec session, copy the exact authorize URL from stderr, use `chrome-devtools-axi open <authorize-url>`, and verify the snapshot shows `axi-cli is requesting access`. Hand the browser to the user so they can select the intended workspace and click Authorize. The live WebRTC URL mirrors the shared browser's current tab and does not navigate by itself.

4. Treat every mutating command as a live mutation.
   Completion criterion: run any `create`, `update`, `assign`, `unassign`, `state`, `close`, `set`, `clear`, `add`, `remove`, `replace`, or attachment `upload` command only after explicit user intent identifies the target and desired change. Every live attachment upload requires an explicit issue and local file intent. Auth status and `list`, `view`, `inspect`, `search`, `threads`, attachment `read` and `download`, and Wayfinder frontier commands remain read-only with respect to Linear.

5. Interpret state filters and resolve ambiguity explicitly.
   Completion criterion: treat completed, canceled, and duplicate as the three terminal workflow types. `issues list --state open` excludes all three, while `--state closed` includes all three. Treat missing, archived, and ambiguous identity errors as authoritative. Never pick the first team, issue, label, workflow state, or user candidate. Retry with the intended UUID. Official details must exactly match the requested immutable ID or documented stable alias. Product updates canonicalize selectors, reject archived targets and additions, and verify scoped ownership; removals may resolve archived associations for cleanup. Assign only to an active, unarchived, assignable user. Issue summaries retain attached archived label names, so use `labels list --issue <issue> --include-archived --fields id,name,parentId,archivedAt` when label status or group matters.

6. Read TOON stdout directly.
   Completion criterion: do not rerun only to confirm an empty state or error; structured output is authoritative unless the command exits non-zero. `--full` disables local projection and text truncation, but associations still require explicit inclusion flags. Before replacing rich text, follow the exact full-view command emitted for every truncated body, content, description, instructions, or text field.

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

12. Replace rich text only from the latest version.
    Completion criterion: fetch the full object, merge locally, then pass the exact canonical `updatedAt` emitted by the CLI to the update command's `--if-updated-at`. This applies to issue descriptions, document and release-note content, project, release, and milestone descriptions, status-update bodies, and their clear flags. On conflict, refetch and merge again. Linear has no atomic compare-and-swap, so do not claim that the final read/write race is eliminated.

13. Reuse caller-retained mutation UUIDs safely.
    Completion criterion: pass a UUID v4 with `--id` when issue, label, relation, or comment creation must be retryable. Reuse it only for the same intended content and scope. Rich-text comparisons tolerate normalized newlines and Linear's angle-bracket form for HTTP(S) Markdown links. Treat `changed: false` as a successful no-op and any UUID/content conflict as a stop condition. Issue state, parent, label add/remove/replace, and relation removal mutations read back the requested state; if reconciliation remains indeterminate, run the exact read-only inspection command and do not repeat the mutation.

14. Use explicit set and clear semantics.
    Completion criterion: never encode clearing as an empty selector or empty value. Use the matching `--clear-*` flag and never combine it with its set flag. Product rich-text clears still require the latest `--if-updated-at`. The same canonical team, initiative, release, or issue relation cannot appear in both add and remove sets. Use `labels add` or `labels remove` when unrelated labels must survive; `labels replace` deliberately removes labels omitted from its JSON array, and `[]` clears all labels. Issue label selections accept ordinary labels only and at most one child from each label group. Create a top-level group with `labels create --group`, or an ordinary child under a same-scope top-level group with `--parent`; never combine those flags.

15. Follow every list cursor exactly.
    Completion criterion: for issue, label, relation, and comment lists, replay the same filters with the returned `page.endCursor` as `--after`. For Wayfinder frontier, use `pageInfo.endCursor`. Never construct or edit a cursor. Relation pages and issue-scoped exact-name label pages are current-state projections, so restart without `--after` when current membership matters.

16. Validate the Wayfinder projection before claiming.
    Completion criterion: require exactly one active production `wayfinder:map` label, or for isolated verification one `WF-VERIFY-<run>:map` label whose type labels use the same prefix. Before candidate loading, require all four active, ordinary, non-group labels to resolve uniquely among workspace and map-team labels, even when the map has no candidates: `<prefix>:research`, `<prefix>:prototype`, `<prefix>:grilling`, and `<prefix>:task`. Then require exactly one of those labels on every direct open, unblocked, unassigned child. Treat any projection error as a metadata repair task, not as an empty frontier.

17. Treat frontier pages as current-state projections.
   Completion criterion: restart without `--after` when current membership or ordering matters. Frontier pagination does not provide snapshot isolation.

18. Keep attachment content at safe file boundaries.
   Completion criterion: use `attachments read` only for bounded allowed UTF-8 text. Download images and other binary files for inspection with an appropriate local tool; never print binary bytes or base64. Downloads always refuse existing destinations because atomic expected-file replacement is unavailable; `--overwrite` fails closed when a destination exists. Upload retries must reuse the same explicit issue and file intent so private recovery metadata can reconcile before finalize. The deprecated base64 `create_attachment` path and attachment deletion are not exposed.

## Updating The CLI

- Use `$axi` for output and process-boundary decisions.
- Use `$effect-v4` for Effect code changes.
- Add regression tests for new commands, especially unknown flags, missing required flags, truncation, and live-mutation guards.
- Run `bun run skill:generate` after changing command specs or help.
- To refresh the frozen official inventory, authenticate locally and run `bun run parity:capture --date YYYY-MM-DD`, then update the manifest observation date, hash, mappings, and rationales. Never hand-edit the generated inventory.
- Verify with `bun run check`.
