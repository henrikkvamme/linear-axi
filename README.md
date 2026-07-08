# linear-axi

![linear-axi banner](assets/linear-axi-banner.png)

Agent-friendly Linear from your shell.

`linear-axi` is a Bun CLI for Linear workspaces. It is built for agents: compact [AXI](https://axi.md/) output, strict exit codes, self-correcting errors, and safe OAuth login through a repo-local `.env`.

## Install

```sh
git clone https://github.com/henrikkvamme/linear-axi.git
cd linear-axi
bun install
```

## Login

```sh
bun src/main.ts auth login --notify
```

The command opens Linear OAuth, lets you choose a workspace, and writes the token to `.env` only when `.env` is gitignored.

If your browser lands on `127.0.0.1` and says the site cannot be reached, paste the full callback URL into the still-running CLI.

You can also set credentials yourself:

```dotenv
# Choose one:
LINEAR_API_KEY=lin_api_...
LINEAR_ACCESS_TOKEN=...

# Optional:
LINEAR_TEAM=BEN
```

`LINEAR_API_KEY` takes precedence over `LINEAR_ACCESS_TOKEN`.

## Use

```sh
bun src/main.ts auth status
bun src/main.ts teams list --limit 50
bun src/main.ts issues list --assignee me --limit 20
bun src/main.ts issues view --id <issue-id-or-key>
bun src/main.ts issues create --team <key-or-id> --title "..." --description "..."
bun src/main.ts comments create --issue <issue-id-or-key> --body "..."
```

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
