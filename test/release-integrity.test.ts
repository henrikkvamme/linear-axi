import { describe, expect, test } from "bun:test"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { Effect } from "effect"
import { commandSpecs, parseArgs, topLevelHelp } from "../src/args"
import { runCommand } from "../src/commands"
import type { LinearGateway } from "../src/linear"
import { officialMutationTools } from "../src/official-commands"

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

const runFixtureCommand = (cwd: string, cmd: ReadonlyArray<string>) => {
  const result = Bun.spawnSync({ cmd: [...cmd], cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString().trim()
}

const createReleaseFixture = (): { root: string; revision: string } => {
  const root = mkdtempSync(join(tmpdir(), "linear-axi-release-source-"))
  for (const path of [
    ".agents",
    ".env.example",
    ".gitignore",
    "assets",
    "docs",
    "LICENSE",
    "package.json",
    "README.md",
    "scripts",
    "src"
  ]) {
    cpSync(join(repoRoot, path), join(root, path), { recursive: true })
  }
  runFixtureCommand(root, ["git", "init", "--quiet"])
  runFixtureCommand(root, ["git", "config", "user.email", "release-test@example.com"])
  runFixtureCommand(root, ["git", "config", "user.name", "Release Test"])
  runFixtureCommand(root, ["git", "add", "."])
  runFixtureCommand(root, ["git", "commit", "--quiet", "-m", "release fixture"])
  writeFileSync(join(root, ".git", "info", "exclude"), "node_modules\n", { flag: "a" })
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir")
  return { root, revision: runFixtureCommand(root, ["git", "rev-parse", "HEAD"]) }
}

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

  for (const relation of [
    {
      name: "blocked-by creation",
      args: ["relations", "create", "--issue", "BEN-2", "--blocked-by", "SAM-1"],
      method: "createRelation"
    },
    {
      name: "blocked-by removal",
      args: ["relations", "remove", "--issue", "BEN-2", "--blocked-by", "SAM-1"],
      method: "removeRelation"
    },
    {
      name: "generic creation",
      args: ["relations", "create", "--issue", "SAM-1", "--related-issue", "BEN-2", "--type", "blocks"],
      method: "createRelation"
    },
    {
      name: "generic removal",
      args: ["relations", "remove", "--issue", "SAM-1", "--related-issue", "BEN-2", "--type", "blocks"],
      method: "removeRelation"
    }
  ] as const) {
    test(`${relation.name} verifies the source issue team`, async () => {
      let mutations = 0
      let identityInput: unknown
      const gateway = {
        close: () => Effect.void,
        mutationIdentity: (input: unknown) => {
          identityInput = input
          const key = (input as { issue?: string }).issue?.split("-")[0] ?? "BEN"
          return Effect.succeed({
            workspace: { id: "11111111-1111-4111-8111-111111111111", urlKey: "bender", name: "Bender" },
            team: { id: `${key === "BEN" ? "2" : "3"}2222222-2222-4222-8222-222222222222`, key, name: key }
          })
        },
        [relation.method]: () => {
          mutations += 1
          return Effect.die("mutation must not run")
        }
      } as unknown as LinearGateway
      const parsed = parseArgs([
        ...relation.args,
        "--expect-workspace", "bender",
        "--expect-team", "BEN"
      ], commandSpecs)

      const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/tmp/linear-axi")))

      expect(identityInput).toEqual({ issue: "SAM-1" })
      expect(error).toMatchObject({ code: "team_mismatch", actual: { key: "SAM" } })
      expect(mutations).toBe(0)
    })
  }

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

  test("only team-resolvable official mutations accept a team expectation", () => {
    const officialMutations = commandSpecs.filter((spec) =>
      spec.operation === "mutation" && spec.officialTools?.some((tool) => officialMutationTools.has(tool)))
    const documentUpdate = officialMutations.find((spec) => spec.path.join(" ") === "documents update")!

    expect(documentUpdate.flags.has("expect-team")).toBe(true)
    expect(documentUpdate.valueFlags?.has("expect-team")).toBe(true)
    expect(documentUpdate.help).toContain("[--expect-team <team-key-or-uuid>]")
    for (const spec of officialMutations.filter((candidate) => candidate !== documentUpdate)) {
      expect(spec.flags.has("expect-team"), spec.path.join(" ")).toBe(false)
      expect(spec.valueFlags?.has("expect-team"), spec.path.join(" ")).toBe(false)
      expect(spec.help, spec.path.join(" ")).not.toContain("--expect-team")
    }

    expect(() => parseArgs([
      "projects", "update",
      "--id", "project-id",
      "--state", "started",
      "--expect-workspace", "bender",
      "--expect-team", "BEN"
    ], commandSpecs)).toThrow("unknown flag --expect-team")

    expect(parseArgs([
      "documents", "update",
      "--id", "document-id",
      "--issue", "BEN-123",
      "--title", "New title",
      "--expect-workspace", "bender",
      "--expect-team", "BEN"
    ], commandSpecs).flags.get("expect-team")).toBe("BEN")
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
    const packageJson = await Bun.file("package.json").json() as { version: string; files: ReadonlyArray<string> }
    const officialMcp = await Bun.file("src/official-mcp.ts").text()
    const buildInfo = await Bun.file("src/build-info.ts").text()
    const flake = await Bun.file("flake.nix").text()

    expect(packageJson.version).toBe("0.2.0")
    expect(packageJson.files).toContain("scripts/build.ts")
    expect(packageJson.files).toContain("scripts/package-revision.ts")
    expect(packageJson.files).toContain("scripts/release-provenance.ts")
    expect(packageJson.files).toContain("SOURCE_REVISION")
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

  test("published source builds with its packaged immutable revision", () => {
    const { root, revision } = createReleaseFixture()

    try {
      const archiveName = runFixtureCommand(root, ["npm", "pack"])
      const archive = join(root, archiveName.split("\n").at(-1)!)
      const unpacked = join(root, "unpacked")
      mkdirSync(unpacked)
      runFixtureCommand(root, ["tar", "-xzf", archive, "-C", unpacked])
      const packagedRoot = join(unpacked, "package")

      expect(readFileSync(join(packagedRoot, "SOURCE_REVISION"), "utf8").trim()).toBe(revision)
      expect(existsSync(join(packagedRoot, "scripts", "build.ts"))).toBe(true)
      expect(existsSync(join(packagedRoot, "scripts", "package-revision.ts"))).toBe(true)
      expect(existsSync(join(packagedRoot, "scripts", "release-provenance.ts"))).toBe(true)
      expect(existsSync(join(root, "SOURCE_REVISION"))).toBe(false)

      const build = Bun.spawnSync({
        cmd: ["bun", "run", "build"],
        cwd: packagedRoot,
        stdout: "pipe",
        stderr: "pipe"
      })
      expect(build.exitCode).toBe(0)

      const capabilities = Bun.spawnSync({
        cmd: [join(packagedRoot, "dist", "linear-axi"), "capabilities"],
        cwd: packagedRoot,
        stdout: "pipe",
        stderr: "pipe"
      })
      expect(capabilities.exitCode).toBe(0)
      expect(capabilities.stdout.toString()).toContain(`revision: ${revision}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("release builds reject a dirty Git checkout", () => {
    const { root, revision } = createReleaseFixture()

    try {
      writeFileSync(join(root, "README.md"), "dirty\n")
      const result = Bun.spawnSync({
        cmd: ["bun", "scripts/build.ts", "--revision", revision, "--outfile", join(root, "linear-axi")],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe"
      })
      expect(result.exitCode).toBe(1)
      expect(result.stderr.toString()).toContain("requires a clean checkout")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  for (const indexFlag of ["--assume-unchanged", "--skip-worktree"] as const) {
    test(`release builds reject tracked files marked ${indexFlag}`, () => {
      const { root, revision } = createReleaseFixture()

      try {
        runFixtureCommand(root, ["git", "update-index", indexFlag, "README.md"])
        writeFileSync(join(root, "README.md"), "hidden dirty source\n")
        const result = Bun.spawnSync({
          cmd: ["bun", "scripts/build.ts", "--revision", revision, "--outfile", join(root, "linear-axi")],
          cwd: root,
          stdout: "pipe",
          stderr: "pipe"
        })

        expect(result.exitCode).toBe(1)
        expect(result.stderr.toString()).toContain("index exemptions")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }

  test("release provenance finds index exemptions from a subdirectory", () => {
    const { root } = createReleaseFixture()
    const nested = join(root, "nested")
    mkdirSync(nested)

    try {
      runFixtureCommand(root, ["git", "update-index", "--assume-unchanged", "README.md"])
      writeFileSync(join(root, "README.md"), "hidden dirty source\n")
      const modulePath = join(repoRoot, "scripts", "release-provenance.ts")
      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "-e",
          `import { verifyCleanCheckout } from ${JSON.stringify(modulePath)}; verifyCleanCheckout("Release build")`
        ],
        cwd: nested,
        stdout: "pipe",
        stderr: "pipe"
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr.toString()).toContain("index exemptions")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("release builds reject a revision that differs from the checkout", () => {
    const { root } = createReleaseFixture()

    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "scripts/build.ts", "--revision", "0000000000000000000000000000000000000000", "--outfile", join(root, "linear-axi")],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe"
      })
      expect(result.exitCode).toBe(1)
      expect(result.stderr.toString()).toContain("does not match checkout HEAD")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  for (const probe of ["worktree", "HEAD", "index", "status"] as const) {
    test(`release builds fail closed when the Git ${probe} probe fails`, () => {
      const fixture = mkdtempSync(join(tmpdir(), "linear-axi-git-probe-"))
      const fakeGit = join(fixture, "git")
      const revision = Bun.spawnSync({
        cmd: ["git", "rev-parse", "HEAD"],
        cwd: repoRoot,
        stdout: "pipe"
      }).stdout.toString().trim()
      const script = `#!/bin/sh
case "${probe}:$*" in
  "worktree:rev-parse --is-inside-work-tree") echo "worktree probe failed" >&2; exit 42 ;;
  "HEAD:rev-parse --is-inside-work-tree"|"index:rev-parse --is-inside-work-tree"|"status:rev-parse --is-inside-work-tree") echo true ;;
  "HEAD:rev-parse HEAD") echo "HEAD probe failed" >&2; exit 42 ;;
  "index:rev-parse HEAD"|"status:rev-parse HEAD") echo "${revision}" ;;
  "index:ls-files -v -z -- :/") echo "index probe failed" >&2; exit 42 ;;
  "status:ls-files -v -z -- :/") exit 0 ;;
  "status:status --porcelain --untracked-files=all --ignore-submodules=none") echo "status probe failed" >&2; exit 42 ;;
esac
`
      writeFileSync(fakeGit, script)
      chmodSync(fakeGit, 0o755)

      try {
        const result = Bun.spawnSync({
          cmd: [process.execPath, "scripts/build.ts", "--revision", revision, "--outfile", join(fixture, "linear-axi")],
          cwd: repoRoot,
          env: {
            ...process.env,
            PATH: [fixture, dirname(process.execPath), process.env.PATH ?? ""].join(delimiter)
          },
          stdout: "pipe",
          stderr: "pipe"
        })

        expect(result.exitCode).toBe(1)
        expect(result.stderr.toString()).toContain(`could not verify Git ${probe}`)
      } finally {
        rmSync(fixture, { recursive: true, force: true })
      }
    })
  }

  test("bundled skill preflights capabilities and verifies issue completion and GitHub linkage", async () => {
    const skill = await Bun.file(".agents/skills/linear-axi/SKILL.md").text()

    expect(skill).toContain("capabilities require")
    expect(skill).toContain("--capability mutation-identity-v1")
    expect(skill).toContain("--expect-workspace")
    expect(skill).toContain("--expect-team")
    expect(skill).toContain("issues inspect")
    expect(skill).toContain("diffs list")
    expect(skill).toContain("If no GitHub linkage was intended")
    expect(skill).toContain("Never use `issues assign --replace` to steal a claim")
    expect(skill).toContain("release work only with `issues unassign --if-assignee me`")
    expect(skill).toContain("paste the full callback URL into the waiting CLI")
    expect(skill).toContain("Do not restart auth blindly")
  })
})
