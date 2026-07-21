import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repoRoot = process.cwd()

test("standalone binary runs without a source checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "linear-axi-compiled-test-"))
  const binary = join(root, "linear-axi")
  const home = join(root, "empty-home")

  try {
    const build = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "--no-compile-autoload-dotenv", "--outfile", binary, "src/main.ts"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe"
    })
    expect(new TextDecoder().decode(build.stderr)).toBe("")
    expect(build.exitCode).toBe(0)
    chmodSync(binary, 0o755)

    const result = Bun.spawnSync({
      cmd: [binary, "--help"],
      cwd: root,
      env: { HOME: home, PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe"
    })
    const stdout = new TextDecoder().decode(result.stdout)
    const stderr = new TextDecoder().decode(result.stderr)

    expect(result.exitCode).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("linear-axi auth login")
    expect(stdout).not.toContain("LINEAR_AXI_REPO")

    for (const command of [
      ["issues", "assign"],
      ["issues", "unassign"],
      ["issues", "close"],
      ["issues", "update"],
      ["issues", "state"],
      ["issues", "parent", "set"],
      ["workflow-states", "list"],
      ["labels", "list"],
      ["labels", "create"],
      ["labels", "apply"],
      ["labels", "remove"],
      ["labels", "replace"],
      ["relations", "list"],
      ["relations", "create"],
      ["relations", "remove"],
      ["comments", "list"],
      ["comments", "create"],
      ["projects", "list"],
      ["projects", "update"],
      ["documents", "update"],
      ["users", "list"],
      ["status-updates", "update"],
      ["wayfinder", "frontier"]
    ]) {
      const helpResult = Bun.spawnSync({
        cmd: [binary, ...command, "--help"],
        cwd: root,
        env: { HOME: home, PATH: process.env.PATH ?? "" },
        stdout: "pipe",
        stderr: "pipe"
      })
      expect(helpResult.exitCode).toBe(0)
      expect(new TextDecoder().decode(helpResult.stderr)).toBe("")
      const helpStdout = new TextDecoder().decode(helpResult.stdout)
      expect(helpStdout).toContain(`linear-axi ${command.join(" ")}`)
      if (command.join(" ") === "relations create") {
        expect(helpStdout).toContain("--issue <blocked-issue> --blocked-by <blocker-issue>")
      }
      if (command.join(" ") === "relations list") {
        expect(helpStdout).toContain("--issue <blocked-issue> --blocked-by")
      }
      if (command.join(" ") === "projects update") {
        expect(helpStdout).toContain("--priority <integer:0..4>")
        expect(helpStdout).toContain("--start-date-resolution <halfYear|month|quarter|year>")
        expect(helpStdout).toContain("conflicts: --add-teams-json, --remove-teams-json")
        expect(helpStdout).toContain("--full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.")
      }
    }

    const rejected = Bun.spawnSync({
      cmd: [binary, "projects", "update", "--bogus"],
      cwd: root,
      env: { HOME: home, PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe"
    })
    expect(rejected.exitCode).toBe(2)
    expect(new TextDecoder().decode(rejected.stderr)).toBe("")
    expect(new TextDecoder().decode(rejected.stdout)).toContain("unknown flag --bogus")

    const repeated = Bun.spawnSync({
      cmd: [binary, "projects", "update", "--id", "project-id", "--state", "planned", "--state", "started"],
      cwd: root,
      env: { HOME: home, PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe"
    })
    expect(repeated.exitCode).toBe(2)
    expect(new TextDecoder().decode(repeated.stderr)).toBe("")
    expect(new TextDecoder().decode(repeated.stdout)).toContain("--state may only be specified once")

    const homeResult = Bun.spawnSync({
      cmd: [binary],
      cwd: root,
      env: { HOME: home, PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe"
    })
    const homeStdout = new TextDecoder().decode(homeResult.stdout)

    expect(homeResult.exitCode).toBe(0)
    expect(new TextDecoder().decode(homeResult.stderr)).toBe("")
    expect(homeStdout).toContain(`bin: ${realpathSync(binary)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
