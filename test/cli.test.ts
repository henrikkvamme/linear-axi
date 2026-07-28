import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const repoRoot = process.cwd()

const runCliInTemporaryDirectory = (...args: ReadonlyArray<string>) => {
  const cwd = mkdtempSync(join(tmpdir(), "linear-axi-cli-test-"))
  try {
    return {
      cwd,
      result: Bun.spawnSync({
        cmd: ["bun", join(repoRoot, "src/main.ts"), ...args],
        cwd,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: join(cwd, "home"),
          XDG_CONFIG_HOME: join(cwd, "config")
        },
        stdout: "pipe",
        stderr: "pipe"
      })
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const runCli = (...args: ReadonlyArray<string>) => runCliInTemporaryDirectory(...args).result

const stdoutText = (result: ReturnType<typeof runCli>) => new TextDecoder().decode(result.stdout)
const stderrText = (result: ReturnType<typeof runCli>) => new TextDecoder().decode(result.stderr)

describe("linear-axi process", () => {
  test("removes its isolated credential sandbox after each invocation", () => {
    const { cwd, result } = runCliInTemporaryDirectory("--help")

    expect(result.exitCode).toBe(0)
    expect(existsSync(cwd)).toBe(false)
  })

  test("prints content-first home output without credentials", () => {
    const result = runCli()
    const stdout = stdoutText(result)

    expect(result.exitCode).toBe(0)
    expect(stderrText(result)).toBe("")
    expect(stdout).toContain("bin:")
    expect(stdout).toContain("description:")
    expect(stdout).toContain("authenticated: false")
    expect(stdout).toContain("Run `linear-axi auth login` to choose and connect a Linear workspace.")
  })

  test("prints top-level help", () => {
    const result = runCli("--help")

    expect(result.exitCode).toBe(0)
    expect(stdoutText(result)).toContain("linear-axi teams list")
  })

  for (const command of [
    ["auth", "status"],
    ["auth", "login"],
    ["auth", "oauth", "setup"],
    ["auth", "oauth", "connect"],
    ["capabilities"],
    ["capabilities", "require"],
    ["teams", "list"],
    ["issues", "list"],
    ["issues", "view"],
    ["issues", "create"],
    ["issues", "assign"],
    ["issues", "unassign"],
    ["issues", "close"],
    ["issues", "update"],
    ["labels", "list"],
    ["labels", "create"],
    ["labels", "apply"],
    ["relations", "list"],
    ["relations", "create"],
    ["comments", "list"],
    ["comments", "create"],
    ["attachments", "list"],
    ["attachments", "view"],
    ["attachments", "download"],
    ["attachments", "read"],
    ["attachments", "upload"],
    ["wayfinder", "frontier"]
  ]) {
    test(`prints command help for ${command.join(" ")}`, () => {
      const result = runCli(...command, "--help")
      const stdout = stdoutText(result)

      expect(result.exitCode).toBe(0)
      expect(stderrText(result)).toBe("")
      expect(stdout).toContain("Usage: linear-axi")
      expect(stdout).toContain(command.join(" "))
    })
  }

  test("prints precise official command help before authentication", () => {
    const result = runCli("projects", "update", "--help")
    const stdout = stdoutText(result)

    expect(result.exitCode).toBe(0)
    expect(stderrText(result)).toBe("")
    expect(stdout).toContain("--priority <integer:0..4>")
    expect(stdout).toContain("--start-date-resolution <halfYear|month|quarter|year>")
    expect(stdout).toContain("conflicts: --add-teams-json, --remove-teams-json")
    expect(stdout).toContain("--full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.")
  })

  test("prints OAuth setup guidance without credentials", () => {
    const result = runCli("auth", "oauth", "setup")
    const stdout = stdoutText(result)

    expect(result.exitCode).toBe(0)
    expect(stderrText(result)).toBe("")
    expect(stdout).toContain("oauthSetup:")
    expect(stdout).toContain("phase: register-client")
    expect(stdout).toContain("redirectUri: \"http://127.0.0.1:14582/oauth/callback\"")
  })

  test("rejects unknown flags with usage exit", () => {
    const result = runCli("teams", "list", "--bogus")

    expect(result.exitCode).toBe(2)
    expect(stderrText(result)).toBe("")
    expect(stdoutText(result)).toContain("unknown flag --bogus")
  })

  test("attachment path and size usage errors happen before authentication", () => {
    for (const [args, message] of [
      [["attachments", "upload", "--issue", "ENG-123", "--file", ".", "--expect-workspace", "engineering"], "regular file"],
      [["attachments", "read", "--id", "attachment-1", "--max-bytes", "0"], "--max-bytes must be an integer"],
      [["attachments", "download", "--id", "attachment-1", "--output", "."], "destination already exists"]
    ] as const) {
      const result = runCli(...args)
      const stdout = stdoutText(result)
      expect(result.exitCode).toBe(2)
      expect(stdout).toContain(message)
      expect(stdout).not.toContain("Linear credentials are not configured")
    }
  })

  test("relation shorthand usage errors include repaired help before authentication", () => {
    for (const [args, message] of [
      [["relations", "create", "--issue", "ENG-124", "--blocked-by"], "--blocked-by requires a value"],
      [["relations", "create", "--issue", "ENG-124", "--blockd-by", "ENG-123"], "unknown flag --blockd-by"],
      [["relations", "create", "--issue", "ENG-124", "--blocked-by", "ENG-123", "--type", "blocks", "--expect-workspace", "engineering"], "must not combine"],
      [["relations", "list", "--issue", "ENG-124", "--blocked-by", "--direction", "incoming"], "must not combine"]
    ] as const) {
      const result = runCli(...args)
      const stdout = stdoutText(result)

      expect(result.exitCode).toBe(2)
      expect(stderrText(result)).toBe("")
      expect(stdout).toContain(message)
      expect(stdout).toContain("--issue <blocked-issue>")
      expect(stdout).not.toContain("Linear credentials are not configured")
    }
  })

  test("rejects unknown commands with usage exit", () => {
    const result = runCli("issues", "delete", "--id", "ENG-123")

    expect(result.exitCode).toBe(2)
    expect(stderrText(result)).toBe("")
    expect(stdoutText(result)).toContain("unknown command issues delete")
  })

  test("reports unauthenticated live commands as runtime errors", () => {
    const result = runCli("teams", "list")

    expect(result.exitCode).toBe(1)
    expect(stderrText(result)).toBe("")
    expect(stdoutText(result)).toContain("Linear credentials are not configured")
  })

  test("auth status succeeds without credentials", () => {
    const result = runCli("auth", "status")

    expect(result.exitCode).toBe(0)
    expect(stderrText(result)).toBe("")
    expect(stdoutText(result)).toContain("authenticated: false")
  })

  test("invalid limits exit as usage errors", () => {
    const result = runCli("teams", "list", "--limit", "0")

    expect(result.exitCode).toBe(2)
    expect(stderrText(result)).toBe("")
    expect(stdoutText(result)).toContain("--limit must be an integer")
  })

  test("invalid local cursors exit as usage errors before authentication", () => {
    const offsetTimestampCursor = `wf1.${Buffer.from(JSON.stringify({
      v: 1,
      order: 1,
      createdAt: "2026-01-01T01:00:00.000+01:00",
      id: "11111111-1111-4111-8111-111111111111"
    }), "utf8").toString("base64url")}`
    for (const args of [
      ["labels", "list", "--issue", "ENG-123", "--name", "fixture", "--after", "label:01"],
      ["relations", "list", "--issue", "ENG-123", "--after", "invalid"],
      ["relations", "list", "--issue", "ENG-123", "--after="],
      ["wayfinder", "frontier", "--map", "ENG-123", "--after", offsetTimestampCursor]
    ]) {
      const result = runCli(...args)

      expect(result.exitCode).toBe(2)
      expect(stderrText(result)).toBe("")
      expect(stdoutText(result)).toMatch(/invalid|not a valid/)
      expect(stdoutText(result)).not.toContain("Linear credentials are not configured")
    }
  })

  test("help with a value exits as a usage error", () => {
    const result = runCli("--help", "auth")

    expect(result.exitCode).toBe(2)
    expect(stderrText(result)).toBe("")
    expect(stdoutText(result)).toContain("--help does not take a value")
  })

  test("rejects issue creation before auth when required fields are missing", () => {
    const result = runCli("issues", "create", "--team", "ENG")
    const stdout = stdoutText(result)

    expect(result.exitCode).toBe(2)
    expect(stderrText(result)).toBe("")
    expect(stdout).toContain("--title is required")
    expect(stdout).not.toContain("Linear credentials are not configured")
  })

  test("rejects comment creation before auth when required fields are missing", () => {
    const result = runCli("comments", "create", "--issue", "ENG-123", "--expect-workspace", "engineering")
    const stdout = stdoutText(result)

    expect(result.exitCode).toBe(2)
    expect(stderrText(result)).toBe("")
    expect(stdout).toContain("exactly one of --body or --body-file is required")
    expect(stdout).not.toContain("Linear credentials are not configured")
  })

  test("reports blank assignee selectors before authentication", () => {
    for (const [args, flag] of [
      [["issues", "assign", "--id", "ENG-123", "--assignee", " ", "--expect-workspace", "engineering"], "--assignee"],
      [["issues", "unassign", "--id", "ENG-123", "--if-assignee", " ", "--expect-workspace", "engineering"], "--if-assignee"]
    ] as const) {
      const result = runCli(...args)
      const stdout = stdoutText(result)

      expect(result.exitCode).toBe(2)
      expect(stderrText(result)).toBe("")
      expect(stdout).toContain(`${flag} requires a user id, email, display name`)
      expect(stdout).not.toContain("Linear credentials are not configured")
    }
  })

  test("rejects malformed mutation flags before authentication", () => {
    const result = runCli("labels", "create", "--workspace", "--name", "fixture", "--color", "red", "--expect-workspace", "engineering")
    expect(result.exitCode).toBe(2)
    expect(stderrText(result)).toBe("")
    expect(stdoutText(result)).toContain("--color must use #RRGGBB")
    expect(stdoutText(result)).not.toContain("Linear credentials are not configured")
  })

  test("rejects empty identity and control flags before authentication", () => {
    for (const args of [
      ["issues", "create", "--team=", "--title", "Child"],
      ["issues", "create", "--team", "ENG", "--title", "Child", "--parent="],
      ["issues", "create", "--team", "ENG", "--title", "Child", "--label="],
      ["issues", "create", "--team", "ENG", "--title", "Child", "--id="],
      ["issues", "close", "--id", "ENG-123", "--state="]
    ]) {
      const result = runCli(...args)
      const stdout = stdoutText(result)

      expect(result.exitCode).toBe(2)
      expect(stderrText(result)).toBe("")
      expect(stdout).toContain("cannot be empty")
      expect(stdout).not.toContain("Linear credentials are not configured")
    }
  }, 15_000)
})
