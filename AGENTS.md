# Agent Instructions

This project builds `linear-axi`, a Bun TypeScript CLI for agent-facing Linear operations.

Use `$effect-v4` when writing Effect code in this repository.
Use `$linear-axi` when operating the CLI or updating its agent-facing behavior.

## Vendored Repositories

Effect v4 source is vendored at `repos/effect`.
The installed package is `effect@4.0.0-beta.94`.
The vendored subtree split is `bdca35449d5dfce5b4433da75ec0a88d0a9b2b27`.

- Treat `repos/effect` as read-only reference material.
- Read `repos/effect/LLMS.md` before writing Effect code.
- Prefer examples and tests from `repos/effect` over guesses.
- Do not import from `repos/effect`; application code imports normal package dependencies.
- Keep `repos/effect` excluded from tests and typechecking.
