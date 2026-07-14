# linear-axi

![linear-axi banner](assets/linear-axi-banner.png)

Agent-friendly Linear from your shell.

`linear-axi` is a Bun CLI for Linear workspaces. It is built for agents: compact [AXI](https://axi.md/) output in TOON, strict exit codes, self-correcting errors, a standalone executable, and browser-based OAuth login.

## Install

Build and install a standalone executable from source:

```sh
git clone https://github.com/henrikkvamme/linear-axi.git
cd linear-axi
bun install
bun run build
mkdir -p ~/.local/bin
install -m 0755 dist/linear-axi ~/.local/bin/linear-axi
```

The compiled `linear-axi` executable is self-contained. It does not need Bun, `node_modules`, or a source checkout at runtime.

Alternatively, install the Nix flake package:

```sh
nix profile install github:henrikkvamme/linear-axi#linear-axi
```

The flake supports Apple silicon macOS and x86-64 Linux.

## Login

```sh
linear-axi auth login
```

The command opens Linear OAuth in your default browser, lets you choose the intended workspace, and writes the token to `$XDG_CONFIG_HOME/linear-axi/credentials.env`, or `~/.config/linear-axi/credentials.env` when `XDG_CONFIG_HOME` is unset, with private permissions. No OAuth app registration or token paste is required.

For a remote agent using the shared browser, run `linear-axi auth login --notify`. The agent opens the exact OAuth URL in the shared browser and keeps the CLI alive until authorization completes. Use `linear-axi auth login --no-open` to print the URL and wait for authorization without launching a local browser.

If your browser lands on `127.0.0.1` and says the site cannot be reached, paste the full callback URL into the still-running CLI.

Rerun `linear-axi auth login` to switch workspaces or replace an expired credential. To disconnect completely, revoke the OAuth grant in Linear and delete the configured credentials file.

You can also set credentials yourself in the process environment, a repo-local `.env`, or the user credentials file:

```dotenv
# Choose one:
LINEAR_API_KEY=lin_api_...
LINEAR_ACCESS_TOKEN=...

# Optional:
LINEAR_TEAM=BEN
```

Process credentials override file credentials. The OAuth credentials file overrides repo-local `.env` credentials so a successful login selects the new workspace; repo credentials are used when no OAuth credentials exist, followed by `secrets.env` in the same user config directory. Other settings use process, repo, OAuth, then managed precedence. Within one source, `LINEAR_API_KEY` takes precedence over `LINEAR_ACCESS_TOKEN`.

Set `LINEAR_AXI_ENV_FILE` in the process environment to use a specific credentials file for both login and later commands. In that mode, credential precedence is process, explicit file, then repo `.env`, and the default OAuth and managed files are not loaded. `HOME`, `XDG_CONFIG_HOME`, and `LINEAR_AXI_ENV_FILE` values inside dotenv files are ignored so a repository cannot redirect credential storage.

## Use

```sh
linear-axi auth status
linear-axi teams list --limit 50
linear-axi issues list --assignee me --limit 20
linear-axi issues list --team BEN --label wayfinder:map --state open --limit 100
linear-axi issues list --parent BEN-100 --assignee none --state open --limit 100
linear-axi issues view --id <issue-id-or-key> [--full]
linear-axi issues create --team <key-or-id> --title "..." --description-file <path> --parent <issue> --label <label>
linear-axi issues assign --id <issue> --assignee me
linear-axi issues unassign --id <issue> --if-assignee me
linear-axi issues close --id <issue>
linear-axi issues update --id <issue> --description-file <path> --if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ>
linear-axi labels list --workspace --name <exact-name>
linear-axi labels list --workspace --include-archived --fields id,name,archivedAt
linear-axi labels create --workspace --name <name> --color '#5E6AD2' --if-absent
linear-axi labels apply --issue <issue> --label <label>
linear-axi relations create --issue <blocker> --related-issue <blocked> --type blocks
linear-axi relations list --issue <issue> --type blocks --direction both
linear-axi comments list --issue <issue> --limit 50
linear-axi comments create --issue <issue> --body-file <path> --id <retained-uuid-v4>
linear-axi wayfinder frontier --map <map-issue> --first 20
linear-axi <command> --help
```

`--description-file -` and `--body-file -` read from stdin. `issues view` truncates descriptions to 1,200 characters by default and reports the original length; pass `--full` before merging or replacing a description. Data, help, errors, no-ops, and definitive empty states are TOON on stdout. Successful mutations include `changed` and `result`; an already-satisfied mutation is a no-op with exit code `0`.

### Resolution, filters, and pagination

Team keys, issue identifiers, and label names are matched exactly without case sensitivity. UUIDs identify one exact object. Identity resolvers scan every matching page and never select the first match: active teams, issues, labels, and workflow states must be unique, while missing, archived, and ambiguous matches fail. Retry an ambiguity with the intended UUID. Archived or disabled users remain valid for issue filters and unassign preconditions, but assignment requires an active, unarchived, assignable user. When `--team` and `--parent` are combined for listing or creation, the parent must belong to that team. Label names used with an issue resolve uniquely among active workspace labels and labels for the issue's team.

`issues list` supports team, exact label, direct parent, assignee (`me`, `none`, or a user UUID), and open or closed state filters. Open excludes the three terminal workflow types: completed, canceled, and duplicate. Closed includes all three. Its default fields are `id,identifier,title,state`; `--fields` accepts `id,identifier,title,state,assignee,parent,labels,updatedAt,url,subIssueSortOrder`.

`labels list` can search all labels or select workspace, team, or issue scope. Label lists return active labels by default. Pass `--include-archived` to include archived labels. The default fields are `id,name,scope`; `--fields` also accepts `color,description,isGroup,archivedAt`. In contrast, issue details, mutation results, and `issues list --fields labels` retain the names of all attached labels, including archived labels; use `labels list --issue <issue> --include-archived --fields id,name,archivedAt` to inspect their status.

`issues list`, `labels list`, `relations list`, and `comments list` return `page.endCursor` when another page exists. Pass that exact value to the same command with `--after`. Wayfinder frontier instead returns `pageInfo.endCursor` and uses `--first`; `--limit` remains an alias for `--first`, but the two flags cannot be combined. Relation pages and issue-scoped exact-name label pages are recomputed from current data and are not snapshot-isolated, so restart without `--after` when current membership matters.

### Mutation safety

Issue, label, relation, and comment creation accept a caller-retained UUID v4 with `--id`. Repeating the same request with the same UUID is a no-op, while reuse for different content or scope is a conflict. Rich-text retry comparisons tolerate normalized line endings, trailing newlines, and Linear's angle-bracket form for HTTP(S) Markdown links. `labels create --if-absent` also treats a case-insensitive same-name label with matching color and description in the requested scope as a no-op. A directed relation is a no-op when its source, target, and type already exist, even without `--id`. Label creation and application accept ordinary labels only, not label groups.

Assignment is a verified claim convention, not an atomic claim. By default, assigning an already-assigned issue conflicts; `--replace` permits a deliberate overwrite. Wayfinder agents must not use `--replace` to claim work and should release only their own assignment with `--if-assignee`. Another writer can still race between the read and update.

Without `--state`, `issues close` is a no-op for an already terminal issue and otherwise selects the team's only completed workflow state. If the team has multiple completed states, pass the intended active completed-state UUID with `--state`; an explicit state transitions unless the issue is already in that exact state.

Full-description replacement requires `--if-updated-at` with the exact canonical `updatedAt` timestamp emitted by the CLI. The CLI rejects timestamps that are malformed or already stale, normalizes line endings and trailing newlines, refetches after a write, and verifies the desired description and a changed timestamp. Linear does not expose an atomic compare-and-swap precondition, so an edit can still land in the final read/write window. Keep resolution comments as the canonical decision records, refetch and merge after any conflict, and never retry an old full description.

Relations are directed tuples of source, target, and type (`blocks`, `related`, `duplicate`, or `similar`). For `--type blocks`, `--issue` is the blocker and `--related-issue` is the blocked issue. Relation lists report each match as `outgoing` or `incoming`; `--direction` defaults to `both`.

Comment bodies are truncated to 500 characters in lists unless `--full` is passed. `--body-file` avoids shell quoting for canonical resolution comments.

### Wayfinder frontier

`wayfinder frontier` is the single Wayfinder-specific projection. A production map must have exactly one active `wayfinder:map` label. An isolated verification map may instead use one `WF-VERIFY-<run>:map` label, where `<run>` contains only letters, digits, dots, underscores, or hyphens; its four type labels use that same prefix. Before loading candidates, frontier requires all four active, ordinary, non-group type labels to resolve uniquely among workspace and map-team labels, even when the map has no candidates: `<prefix>:research`, `<prefix>:prototype`, `<prefix>:grilling`, and `<prefix>:task`. Its active, direct children enter the frontier only when they are open, unblocked, and unassigned. Every current frontier candidate must have exactly one of those four type labels.

Results are ordered by Linear's manual sub-issue order with unset order last, then creation time, then UUID. Every page recomputes current Linear state and does not provide snapshot isolation, so membership or ordering changes can move issues across the cursor. Restart without `--after` when a fresh frontier is required.

Exit codes:

- `0` success
- `1` runtime, auth, Linear API, not-found, ambiguity, or conflict error
- `2` usage error detected before dependencies are called

## Agent Skill

Install the public skill with Vercel's `skills` CLI:

```sh
npx skills add henrikkvamme/linear-axi --skill linear-axi
```

Only `linear-axi` is intended to be installable from this repo.

## Develop

```sh
bun run check
```

Effect source is vendored under `repos/effect` as read-only reference material. Application code imports package dependencies, not the vendored source.
