---
name: effect-v4
description: Effect v4 beta workflow for this repo. Use when writing, reviewing, migrating, or debugging Effect code, configuring Effect tooling, or deciding how agents should use the vendored Effect source.
---

# Effect v4

Use Bun and the project-local Effect source. Do not use a global Effect clone.

## Workflow

1. Read `AGENTS.md` and `repos/effect/LLMS.md` before writing Effect code.
   Completion criterion: the relevant Effect v4 pattern is grounded in the vendored source or its `ai-docs`.

2. Confirm package/source alignment.
   Completion criterion: `package.json` still pins `effect@4.0.0-beta.94`, and `repos/effect` remains read-only reference material from subtree split `bdca35449d5dfce5b4433da75ec0a88d0a9b2b27`.

3. Implement with Effect-native boundaries.
   Completion criterion: async SDK or platform calls enter through `Effect.tryPromise`; recoverable failures are typed errors; CLI entrypoints run one Effect program at the process boundary.

4. Keep the subtree out of app tooling.
   Completion criterion: `tsconfig.json` excludes `repos`, and Bun test scripts target project tests explicitly rather than recursive discovery.

5. Verify with Bun.
   Completion criterion: `bun run typecheck` and `bun run test` pass, or failures are explained with the exact command and relevant output.

## Patterns

- Prefer `Effect.gen` for command workflows and `Effect.fn("name")` for reusable functions returning effects.
- Prefer services or gateway interfaces at external boundaries so tests can replace live SDK calls.
- Prefer Effect APIs over ambient globals when practical: `Config` over raw env in larger modules, Effect logging over ad hoc logs, Schema over untyped parsing at data boundaries.
- Keep v4 unstable imports behind narrow modules when they are needed; beta and `effect/unstable/*` APIs can change.

## Bun

- Add dependencies with `bun add`.
- Add dev dependencies with `bun add -d`.
- For beta packages, pin exact versions unless the user explicitly asks to float.
