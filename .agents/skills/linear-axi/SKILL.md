---
name: linear-axi
description: Linear AXI CLI workflow. Use when agents need to inspect or safely mutate Linear issues, attachments, projects, documents, releases, milestones, status updates, labels, relations, comments, teams, or users, or project a Wayfinder frontier.
---

# Linear AXI

Use `linear-axi` as the Linear interface for agents. It prints compact TOON on stdout and uses AXI exits: `0` success, empty, or no-op; `1` runtime or domain failure; `2` usage failure before mutation dispatch.

Read `COMMANDS.md` when you need exact flags, examples, retry mechanics, or command-specific safety. Keep this file loaded for the ordered workflow and trust boundaries.

## Ordered workflow

1. Resolve the intended workspace and team from the task context.
   Completion criterion: you have the workspace URL key or UUID and, for team-scoped work, the team key or UUID. Names are display-only and never workspace authorization evidence.

2. Prove the installed generation before any live work.
   Completion criterion:

   ```sh
   linear-axi capabilities require \
     --api-level 2 \
     --capability mutation-identity-v1 \
     --capability attachment-files-v1
   ```

   Exit `0` is required. Exit `1` names missing capabilities and the managed update action. Exit `2` means the binary predates capability introspection and must be updated before live work.

3. Verify authentication against the intended workspace and team.
   Completion criterion: `linear-axi auth status` reports the expected workspace stable ID or URL key, and `linear-axi teams list --limit 50` contains the expected team key or UUID.

   If unauthenticated or connected to the wrong workspace, run `linear-axi auth login` on the user's machine and keep the process alive. Select the workspace already resolved from the task and authorize it. For a remote CLI, use `linear-axi auth login --notify`, open the exact authorize URL in the shared browser, and complete only human-required authentication there. After login, repeat both verification commands. A different workspace or missing expected team is an incomplete login, so restart OAuth with the intended workspace.

4. Read the target and establish exact selectors before mutation.
   Completion criterion: every target resolves uniquely and the requested state is understood. Treat not-found, archived, ambiguous, truncated, and conflict results as stop conditions. Fetch full rich text before replacing it and carry its canonical `updatedAt` into the mutation.

5. Mutate only with explicit identity expectations.
   Completion criterion: every mutation carries `--expect-workspace <workspace-uuid-or-url-key>` and team-scoped mutations also carry `--expect-team <team-key-or-uuid>`.

   ```sh
   linear-axi issues state \
     --id BEN-123 \
     --state Done \
     --expect-workspace bender \
     --expect-team BEN

   linear-axi attachments upload \
     --issue BEN-123 \
     --file ./result.md \
     --expect-workspace bender \
     --expect-team BEN
   ```

   A `workspace_mismatch` or `team_mismatch` means no mutation was sent. Correct the credential or target and re-evaluate intent. Do not substitute a workspace name for its stable ID or URL key.

6. Verify completion in Linear and verify intended GitHub linkage.
   Completion criterion:

   - Re-read the ticket with `linear-axi issues inspect --id <issue> --full`.
   - If the task means complete, inspect `linear-axi workflow-states list --team <team>` and set the intended final state with `issues state` or `issues close`, including both identity expectations.
   - If a GitHub PR or diff was intended, run `linear-axi diffs list --query <issue-identifier> --repo <repo> --full` and inspect the issue's expanded attachment or diff data. Confirm the expected GitHub URL or diff is associated.
   - Re-read the issue and diff after writes. Missing intended state or linkage means the task is incomplete.
   - If no GitHub linkage was intended, say so explicitly in the completion result.

## Safety rules

- Live mutation requires explicit user intent that identifies the target and desired change. Read commands never authorize a later mutation.
- Preserve AXI output authority. Read TOON once, use its help after exit `2`, and do not rerun merely to confirm an empty result.
- Preserve retry safety. Reuse caller-retained UUIDs only for the same intent. Treat unknown mutation outcomes as inspection work and never blindly repeat an official or attachment mutation.
- Preserve directed relation semantics. In the `--blocked-by` shorthand, `--issue` is blocked and `--blocked-by` is the blocker.
- Preserve attachment file boundaries. Read only bounded supported text, inspect downloaded binary files locally, and resume uploads only with the same issue and unchanged file metadata.
- Preserve current-state pagination. Replay returned cursors exactly and restart without a cursor when membership or ordering may have changed.

## Updating the CLI

Use `$axi` for the process boundary, `$effect-v4` for Effect code, and `bun run skill:generate` after command-spec changes. Keep mechanics generated in `COMMANDS.md`. Verify with `bun run check`.
