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
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
