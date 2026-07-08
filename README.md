# linear-axi

`linear-axi` is a Bun TypeScript CLI for agent-facing Linear operations. It uses Effect v4 beta for command workflows, `@linear/sdk` for Linear access, and TOON output for compact structured stdout.

## Setup

```sh
bun install
bun run check
```

Configure one Linear credential outside the transcript:

```sh
export LINEAR_API_KEY=...
# or
export LINEAR_ACCESS_TOKEN=...
```

`LINEAR_API_KEY` takes precedence when both are set.

The CLI also loads an untracked repo-local `.env` file before reading credentials from the environment:

```dotenv
LINEAR_API_KEY=...
LINEAR_TEAM=BEN
```

`.env` is gitignored. Keep committed files to non-secret defaults such as `.env.example`.

## OAuth Setup

For normal repo setup, run:

```sh
bun src/main.ts auth login --notify
```

That opens Linear OAuth consent, lets you choose the workspace in Linear, and saves the token to the repo-local `.env`.
If the browser redirects to `127.0.0.1` and says the site cannot be reached, paste the full callback URL into the still-running CLI and press Enter.

Linear OAuth has two phases:

1. Register an OAuth application to get a Client ID.
2. Authorize a workspace through the consent screen.

Linear's hosted MCP flow already has a Linear-owned OAuth client, so it can go straight to consent. `linear-axi` includes the public `axi-cli` OAuth Client ID for the same smooth path. To register a different OAuth client, get the registration values:

```sh
bun src/main.ts auth oauth setup --notify
```

Create a Linear OAuth application with a redirect callback that matches the CLI listener, for example:

```text
http://127.0.0.1:14582/oauth/callback
```

Enable Public if you want the same OAuth client to connect workspaces beyond the workspace where the app is created. Leave webhooks disabled for this CLI login flow. After Linear shows the Client ID, optionally store it in the untracked repo `.env` to override the built-in public client:

```dotenv
LINEAR_OAUTH_CLIENT_ID=...
```

Then authorize the current repo:

```sh
bun src/main.ts auth oauth connect --write-env --prompt-consent
```

Use `--notify` to request a Bender browser handoff for the Linear sign-in or consent step:

```sh
bun src/main.ts auth oauth connect --client-id <linear-oauth-client-id> --write-env --prompt-consent --notify
```

The command uses PKCE, validates OAuth `state`, exchanges the callback code for tokens, and writes the resulting token fields to `.env` only when `.env` is gitignored.

## Usage

```sh
bun src/main.ts
bun src/main.ts auth status
bun src/main.ts auth login --notify
bun src/main.ts auth oauth setup --notify
bun src/main.ts auth oauth connect --client-id <id> --write-env
bun src/main.ts teams list --limit 50
bun src/main.ts issues list --assignee me --limit 20
bun src/main.ts issues list --team <key-or-id> --limit 20
bun src/main.ts issues view --id <issue-id-or-key>
bun src/main.ts issues create --team <key-or-id> --title "..." --description "..."
bun src/main.ts comments create --issue <issue-id-or-key> --body "..."
```

Exit codes:

- `0`: success
- `1`: runtime, auth, or Linear API failure
- `2`: usage error

## Agent Context

Effect v4 source is vendored under `repos/effect` as read-only reference material. Application code imports from package dependencies, never from `repos/effect`.

Local skills:

- `$effect-v4`: Effect v4 beta workflow and subtree rules
- `$linear-axi`: Linear CLI usage and mutation safety
