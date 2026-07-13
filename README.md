# linear-axi

![linear-axi banner](assets/linear-axi-banner.png)

Agent-friendly Linear from your shell.

`linear-axi` is a Bun CLI for Linear workspaces. It is built for agents: compact [AXI](https://axi.md/) output, strict exit codes, self-correcting errors, a standalone executable, and browser-based OAuth login.

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
linear-axi issues view --id <issue-id-or-key>
linear-axi issues create --team <key-or-id> --title "..." --description-file <path> --parent <issue> --label <label>
linear-axi issues assign --id <issue> --assignee me
linear-axi issues unassign --id <issue> --if-assignee me
linear-axi issues close --id <issue>
linear-axi issues update --id <issue> --description-file <path> --if-updated-at <RFC3339>
linear-axi labels list --workspace --name <exact-name>
linear-axi labels list --workspace --include-archived --fields id,name,archivedAt
linear-axi labels create --workspace --name <name> --color '#5E6AD2' --if-absent
linear-axi labels apply --issue <issue> --label <label>
linear-axi relations create --issue <blocker> --related-issue <blocked> --type blocks
linear-axi relations list --issue <issue> --type blocks --direction both
linear-axi comments list --issue <issue> --limit 50
linear-axi comments create --issue <issue> --body-file <path> --id <retained-uuid-v4>
linear-axi wayfinder frontier --map <map-issue> --first 20
```

Label lists return active labels by default. Pass `--include-archived` to include archived labels and request `archivedAt` with `--fields` when needed.

For `relations create --type blocks`, `--issue` is the blocker and `--related-issue` is the blocked issue.

Wayfinder frontier pagination uses `--first` and the returned `pageInfo.endCursor` with `--after`. Every page recomputes current Linear state and does not provide snapshot isolation, so membership or ordering changes can move issues across the cursor. Restart without `--after` when a fresh frontier is required.

Assignment is a verified claim convention, not an atomic claim. Another writer can race between the read and update. Wayfinder agents must not use `--replace` to claim work and should release only their own assignment with `--if-assignee`.

Full-description replacement requires `--if-updated-at`. The CLI rejects timestamps that are already stale, refetches after a write, and verifies the desired description and a changed timestamp. Linear does not expose an atomic compare-and-swap precondition, so an edit can still land in the final read/write window. Keep resolution comments as the canonical decision records, refetch and merge after any conflict, and never retry an old full description.

Exit codes:

- `0` success
- `1` runtime, auth, or Linear API failure
- `2` usage error

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
