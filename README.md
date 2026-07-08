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

## Usage

```sh
bun src/main.ts
bun src/main.ts auth status
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
