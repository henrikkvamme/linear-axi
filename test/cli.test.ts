import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const repoRoot = process.cwd()

const runCli = (...args: ReadonlyArray<string>) => {
  const cwd = mkdtempSync(join(tmpdir(), "linear-axi-cli-test-"))
  return Bun.spawnSync({
    cmd: ["bun", join(repoRoot, "src/main.ts"), ...args],
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? ""
    },
    stdout: "pipe",
    stderr: "pipe"
  })
}

const stdoutText = (result: ReturnType<typeof runCli>) => new TextDecoder().decode(result.stdout)

describe("linear-axi process", () => {
  test("prints top-level help", () => {
    const result = runCli("--help")

    expect(result.exitCode).toBe(0)
    expect(stdoutText(result)).toContain("linear-axi teams list")
  })

  test("rejects unknown flags with usage exit", () => {
    const result = runCli("teams", "list", "--bogus")

    expect(result.exitCode).toBe(2)
    expect(stdoutText(result)).toContain("unknown flag --bogus")
  })

  test("reports unauthenticated live commands as runtime errors", () => {
    const result = runCli("teams", "list")

    expect(result.exitCode).toBe(1)
    expect(stdoutText(result)).toContain("Linear credentials are not configured")
  })

  test("auth status succeeds without credentials", () => {
    const result = runCli("auth", "status")

    expect(result.exitCode).toBe(0)
    expect(stdoutText(result)).toContain("authenticated: false")
  })

  test("invalid limits exit as usage errors", () => {
    const result = runCli("teams", "list", "--limit", "0")

    expect(result.exitCode).toBe(2)
    expect(stdoutText(result)).toContain("--limit must be an integer")
  })

  test("help with a value exits as a usage error", () => {
    const result = runCli("--help", "auth")

    expect(result.exitCode).toBe(2)
    expect(stdoutText(result)).toContain("--help does not take a value")
  })
})
