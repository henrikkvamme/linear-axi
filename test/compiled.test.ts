import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
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
      ["labels", "list"],
      ["labels", "create"],
      ["labels", "apply"],
      ["relations", "list"],
      ["relations", "create"],
      ["comments", "list"],
      ["comments", "create"],
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
      expect(new TextDecoder().decode(helpResult.stdout)).toContain(`linear-axi ${command.join(" ")}`)
    }

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
    expect(homeStdout).toContain(`bin: ${binary}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
