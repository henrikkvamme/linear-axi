import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { commandSpecs, parseArgs, topLevelHelp } from "../src/args"
import { runCommand } from "../src/commands"
import type { LinearGateway } from "../src/linear"

const repoRoot = process.cwd()

const runCli = (...args: ReadonlyArray<string>) => Bun.spawnSync({
  cmd: ["bun", `${repoRoot}/src/main.ts`, ...args],
  cwd: repoRoot,
  env: {
    PATH: process.env.PATH ?? "",
    HOME: "/tmp/linear-axi-release-integrity-home",
    XDG_CONFIG_HOME: "/tmp/linear-axi-release-integrity-config"
  },
  stdout: "pipe",
  stderr: "pipe"
})

describe("release integrity", () => {
  test("source invocation reports build identity and named capabilities without credentials", () => {
    const result = runCli("capabilities")
    const stdout = result.stdout.toString()

    expect(result.exitCode).toBe(0)
    expect(result.stderr.toString()).toBe("")
    expect(stdout).toContain("version: 0.2.0")
    expect(stdout).toContain("revision: development")
    expect(stdout).toContain("apiLevel: 2")
    expect(stdout).toContain("mutation-identity-v1")
    expect(stdout).toContain("attachment-files-v1")
    expect(stdout).toContain("officialInventory:")
    expect(stdout).toContain("contentSha256: development")
  })

  test("every command is explicitly classified and every mutation requires workspace identity", () => {
    for (const spec of commandSpecs) {
      expect(spec.operation, spec.path.join(" ")).toMatch(/^(read|mutation|local)$/)
      if (spec.operation === "mutation") {
        expect(spec.flags.has("expect-workspace"), spec.path.join(" ")).toBe(true)
        expect(spec.valueFlags?.has("expect-workspace"), spec.path.join(" ")).toBe(true)
        expect(spec.required?.has("expect-workspace"), spec.path.join(" ")).toBe(true)
        expect(spec.help.split("\n")[0], spec.path.join(" ")).toContain("--expect-workspace")
        const examples = spec.help.split("\n").filter((line) =>
          /^(?:Usage:\s+|or:\s+)?linear-axi /.test(line.trimStart())
        )
        expect(examples.length, spec.path.join(" ")).toBeGreaterThan(0)
        for (const example of examples) {
          expect(example, spec.path.join(" ")).toContain("--expect-workspace")
          if (spec.mutationTargets?.some((target) => example.includes(`--${target.flag}`))) {
            expect(example, spec.path.join(" ")).toContain("--expect-team")
          }
        }
      }
      for (const tool of spec.officialTools ?? []) {
        if (/^(save|create|delete|merge|resolve|submit)_/.test(tool)) {
          expect(spec.operation, `${spec.path.join(" ")}: ${tool}`).toBe("mutation")
        }
      }
    }
    for (const line of topLevelHelp.split("\n").filter((line) =>
      /^  linear-axi (attachments upload|issues (create|assign|unassign|close|state|parent (set|clear)|update)|labels (create|apply|add|remove|replace)|relations (create|remove)|comments create) /.test(line)
    )) {
      expect(line).toContain("--expect-workspace")
    }
  })

  test("a missing mutation workspace expectation is a usage failure", () => {
    expect(() => parseArgs(
      ["issues", "state", "--id", "BEN-123", "--state", "Done"],
      commandSpecs
    )).toThrow("--expect-workspace is required")
  })

  test("a Sambu credential cannot mutate Bender", async () => {
    let mutations = 0
    const gateway = {
      close: () => Effect.void,
      mutationIdentity: () => Effect.succeed({
        workspace: { id: "11111111-1111-4111-8111-111111111111", urlKey: "sambu", name: "Sambu" },
        team: { id: "22222222-2222-4222-8222-222222222222", key: "SAM", name: "Sambu" }
      }),
      changeIssueState: () => {
        mutations += 1
        return Effect.die("mutation must not run")
      }
    } as unknown as LinearGateway
    const parsed = parseArgs([
      "issues", "state",
      "--id", "BEN-123",
      "--state", "Done",
      "--expect-workspace", "bender",
      "--expect-team", "BEN"
    ], commandSpecs)

    const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/tmp/linear-axi")))

    expect(error).toMatchObject({
      _tag: "LinearDomainError",
      code: "workspace_mismatch",
      expected: { idOrUrlKey: "bender" },
      actual: { urlKey: "sambu", name: "Sambu" }
    })
    expect(mutations).toBe(0)
  })

  test("a wrong resolved issue team makes zero native mutation calls", async () => {
    let mutations = 0
    const gateway = {
      close: () => Effect.void,
      mutationIdentity: () => Effect.succeed({
        workspace: { id: "11111111-1111-4111-8111-111111111111", urlKey: "bender", name: "Bender" },
        team: { id: "22222222-2222-4222-8222-222222222222", key: "SAM", name: "Sambu" }
      }),
      changeIssueState: () => {
        mutations += 1
        return Effect.die("mutation must not run")
      }
    } as unknown as LinearGateway
    const parsed = parseArgs([
      "issues", "state",
      "--id", "BEN-123",
      "--state", "Done",
      "--expect-workspace", "bender",
      "--expect-team", "BEN"
    ], commandSpecs)

    const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/tmp/linear-axi")))

    expect(error).toMatchObject({
      code: "team_mismatch",
      expected: { idOrKey: "BEN" },
      actual: { key: "SAM", name: "Sambu" }
    })
    expect(mutations).toBe(0)
  })

  test("relation removal by immutable id verifies its resolved team before mutation", async () => {
    let mutations = 0
    let identityInput: unknown
    const gateway = {
      close: () => Effect.void,
      mutationIdentity: (input: unknown) => {
        identityInput = input
        return Effect.succeed({
          workspace: { id: "11111111-1111-4111-8111-111111111111", urlKey: "bender", name: "Bender" },
          team: { id: "22222222-2222-4222-8222-222222222222", key: "SAM", name: "Sambu" }
        })
      },
      removeRelation: () => {
        mutations += 1
        return Effect.die("mutation must not run")
      }
    } as unknown as LinearGateway
    const parsed = parseArgs([
      "relations", "remove",
      "--id", "33333333-3333-4333-8333-333333333333",
      "--expect-workspace", "bender",
      "--expect-team", "BEN"
    ], commandSpecs)

    const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/tmp/linear-axi")))

    expect(identityInput).toEqual({ relation: "33333333-3333-4333-8333-333333333333" })
    expect(error).toMatchObject({ code: "team_mismatch", actual: { key: "SAM" } })
    expect(mutations).toBe(0)
  })

  test("an official-backed mutation is guarded before tools/call", async () => {
    let mutationCalls = 0
    const gateway = {
      close: () => Effect.void,
      mutationIdentity: () => Effect.succeed({
        workspace: { id: "11111111-1111-4111-8111-111111111111", urlKey: "sambu", name: "Sambu" }
      }),
      callOfficialTool: (name: string) => {
        if (name === "save_project") mutationCalls += 1
        return Effect.succeed({
          id: "project-id",
          name: "Project",
          state: "planned",
          archivedAt: null
        })
      },
      resolveProjectUpdateAssociations: () => Effect.succeed({ teams: [], initiatives: [] })
    } as unknown as LinearGateway
    const parsed = parseArgs([
      "projects", "update",
      "--id", "project-id",
      "--state", "started",
      "--expect-workspace", "bender"
    ], commandSpecs)

    const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/tmp/linear-axi")))

    expect(error).toMatchObject({ code: "workspace_mismatch" })
    expect(mutationCalls).toBe(0)
  })

  test("an unresolved expected team makes zero official mutation calls", async () => {
    let mutationCalls = 0
    const gateway = {
      close: () => Effect.void,
      mutationIdentity: () => Effect.succeed({
        workspace: { id: "11111111-1111-4111-8111-111111111111", urlKey: "bender", name: "Bender" }
      }),
      callOfficialTool: (name: string) => {
        if (name === "save_project") mutationCalls += 1
        return Effect.succeed({
          id: "project-id",
          name: "Project",
          state: "planned",
          archivedAt: null
        })
      },
      resolveProjectUpdateAssociations: () => Effect.succeed({ teams: [], initiatives: [] })
    } as unknown as LinearGateway
    const parsed = parseArgs([
      "projects", "update",
      "--id", "project-id",
      "--state", "started",
      "--expect-workspace", "bender",
      "--expect-team", "BEN"
    ], commandSpecs)

    const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/tmp/linear-axi")))

    expect(error).toMatchObject({
      code: "team_mismatch",
      expected: { idOrKey: "BEN" },
      actual: null
    })
    expect(mutationCalls).toBe(0)
  })

  test("capability requirements are credential-free and structured", () => {
    const satisfied = runCli(
      "capabilities", "require",
      "--api-level", "2",
      "--capability", "mutation-identity-v1",
      "--capability", "attachment-files-v1"
    )
    expect(satisfied.exitCode).toBe(0)
    expect(satisfied.stdout.toString()).toContain("satisfied: true")

    const missing = runCli(
      "capabilities", "require",
      "--api-level", "3",
      "--capability", "future-capability"
    )
    const stdout = missing.stdout.toString()
    expect(missing.exitCode).toBe(1)
    expect(stdout).toContain("capability_requirements_unsatisfied")
    expect(stdout).toContain("future-capability")
    expect(stdout).toContain("nixus config apply --yes --update tools")
  })

  test("--version aliases the structured build output", () => {
    const result = runCli("--version")
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("build:")
    expect(result.stdout.toString()).toContain("version: 0.2.0")
    expect(result.stdout.toString()).toContain("apiLevel: 2")
  })

  test("package, MCP client, flake, and build metadata share version 0.2.0", async () => {
    const packageJson = await Bun.file("package.json").json() as { version: string }
    const officialMcp = await Bun.file("src/official-mcp.ts").text()
    const buildInfo = await Bun.file("src/build-info.ts").text()
    const flake = await Bun.file("flake.nix").text()

    expect(packageJson.version).toBe("0.2.0")
    expect(officialMcp).toContain("version: PACKAGE_VERSION")
    expect(buildInfo).toContain("packageMetadata.version")
    expect(flake).toContain(`version = "${packageJson.version}";`)
  })

  test("release builds reject an unknown revision", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "scripts/build.ts", "--revision", "unknown", "--outfile", "/tmp/linear-axi-unknown-revision"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe"
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("exact 40-hex immutable revision")
  })

  test("release builds reject a revision that differs from the checkout", () => {
    const parentRevision = Bun.spawnSync({
      cmd: ["git", "rev-parse", "HEAD^"],
      cwd: repoRoot,
      stdout: "pipe"
    }).stdout.toString().trim()
    const result = Bun.spawnSync({
      cmd: ["bun", "scripts/build.ts", "--revision", parentRevision, "--outfile", "/tmp/linear-axi-mismatched-revision"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe"
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("does not match checkout HEAD")
  })

  test("bundled skill preflights capabilities and verifies issue completion and GitHub linkage", async () => {
    const skill = await Bun.file(".agents/skills/linear-axi/SKILL.md").text()

    expect(skill).toContain("capabilities require")
    expect(skill).toContain("--capability mutation-identity-v1")
    expect(skill).toContain("--expect-workspace")
    expect(skill).toContain("--expect-team")
    expect(skill).toContain("issues inspect")
    expect(skill).toContain("diffs list")
    expect(skill).toContain("If no GitHub linkage was intended")
  })
})
