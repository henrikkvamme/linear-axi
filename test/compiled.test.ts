import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repoRoot = process.cwd()
const bundledSkillSha256 = (root: string): string => {
  const hash = createHash("sha256")
  for (const path of [
    ".agents/skills/linear-axi/COMMANDS.md",
    ".agents/skills/linear-axi/SKILL.md"
  ]) {
    hash.update(`${path}\0`)
    hash.update(readFileSync(join(root, path)))
    hash.update("\0")
  }
  return hash.digest("hex")
}

test("standalone binary runs without a source checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "linear-axi-compiled-test-"))
  const binary = join(root, "linear-axi")
  const home = join(root, "empty-home")
  const source = join(root, "source")
  const revision = Bun.spawnSync({ cmd: ["git", "rev-parse", "HEAD"], cwd: repoRoot, stdout: "pipe" }).stdout.toString().trim()

  try {
    mkdirSync(join(source, "scripts"), { recursive: true })
    mkdirSync(join(source, "docs"), { recursive: true })
    mkdirSync(join(source, ".agents", "skills"), { recursive: true })
    cpSync(join(repoRoot, "src"), join(source, "src"), { recursive: true })
    cpSync(join(repoRoot, "docs", "linear-mcp-parity.json"), join(source, "docs", "linear-mcp-parity.json"))
    cpSync(join(repoRoot, "scripts", "build.ts"), join(source, "scripts", "build.ts"))
    cpSync(join(repoRoot, "scripts", "release-provenance.ts"), join(source, "scripts", "release-provenance.ts"))
    cpSync(join(repoRoot, ".agents", "skills", "linear-axi"), join(source, ".agents", "skills", "linear-axi"), { recursive: true })
    cpSync(join(repoRoot, "package.json"), join(source, "package.json"))
    writeFileSync(join(source, "SOURCE_REVISION"), `${revision}\n`)
    symlinkSync(join(repoRoot, "node_modules"), join(source, "node_modules"), "dir")
    const build = Bun.spawnSync({
      cmd: ["bun", "scripts/build.ts", "--revision", revision, "--outfile", binary],
      cwd: source,
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

    const capabilities = Bun.spawnSync({
      cmd: [binary, "capabilities"],
      cwd: root,
      env: { HOME: home, PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe"
    })
    const capabilityOutput = new TextDecoder().decode(capabilities.stdout)
    expect(capabilities.exitCode).toBe(0)
    expect(new TextDecoder().decode(capabilities.stderr)).toBe("")
    expect(capabilityOutput).toContain("version: 0.2.0")
    expect(capabilityOutput).toContain(`revision: ${revision}`)
    expect(capabilityOutput).toContain("apiLevel: 2")
    expect(capabilityOutput).toContain("mutation-identity-v1")
    expect(capabilityOutput).toContain("attachment-files-v1")
    expect(capabilityOutput).toContain(`contentSha256: ${bundledSkillSha256(repoRoot)}`)

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
      ["attachments", "list"],
      ["attachments", "view"],
      ["attachments", "download"],
      ["attachments", "read"],
      ["attachments", "upload"],
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
      if (command.join(" ") === "labels create") {
        expect(helpStdout).toContain("--parent <group-id-or-name>")
        expect(helpStdout).not.toContain("--parent <issue>")
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

    for (const [args, message] of [
      [["attachments", "upload", "--issue", "ENG-123", "--file", root], "regular file"],
      [["attachments", "read", "--id", "attachment-1", "--max-bytes", "0"], "--max-bytes must be an integer"]
    ] as const) {
      const invalidAttachment = Bun.spawnSync({
        cmd: [binary, ...args],
        cwd: root,
        env: { HOME: home, PATH: process.env.PATH ?? "" },
        stdout: "pipe",
        stderr: "pipe"
      })
      const invalidStdout = new TextDecoder().decode(invalidAttachment.stdout)
      expect(invalidAttachment.exitCode).toBe(2)
      expect(new TextDecoder().decode(invalidAttachment.stderr)).toBe("")
      expect(invalidStdout).toContain(message)
      expect(invalidStdout).not.toContain("Linear credentials are not configured")
    }

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

    const conflicting = Bun.spawnSync({
      cmd: [
        binary, "projects", "update", "--id", "project-id", "--summary", "text", "--clear-summary",
        "--expect-workspace", "engineering"
      ],
      cwd: root,
      env: { HOME: home, PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe"
    })
    expect(conflicting.exitCode).toBe(2)
    expect(new TextDecoder().decode(conflicting.stderr)).toBe("")
    expect(new TextDecoder().decode(conflicting.stdout)).toContain("--summary and --clear-summary are mutually exclusive")

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
}, 30_000)

test("compiled revisions are injected immutably at build time", () => {
  const root = mkdtempSync(join(tmpdir(), "linear-axi-revisions-"))
  const revisions = [
    Bun.spawnSync({ cmd: ["git", "rev-parse", "HEAD"], cwd: repoRoot, stdout: "pipe" }).stdout.toString().trim(),
    Bun.spawnSync({ cmd: ["git", "rev-parse", "HEAD^"], cwd: repoRoot, stdout: "pipe" }).stdout.toString().trim()
  ]
  try {
    const reported = revisions.map((revision, index) => {
      const snapshot = join(root, `source-${index}`)
      const archive = join(root, `source-${index}.tar`)
      mkdirSync(snapshot)
      const archived = Bun.spawnSync({
        cmd: ["git", "archive", "--format=tar", `--output=${archive}`, revision],
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe"
      })
      expect(archived.exitCode).toBe(0)
      const extracted = Bun.spawnSync({
        cmd: ["tar", "-xf", archive, "-C", snapshot],
        stdout: "pipe",
        stderr: "pipe"
      })
      expect(extracted.exitCode).toBe(0)
      symlinkSync(join(repoRoot, "node_modules"), join(snapshot, "node_modules"), "dir")
      const binary = join(root, `linear-axi-${index}`)
      const build = Bun.spawnSync({
        cmd: ["bun", "scripts/build.ts", "--revision", revision, "--outfile", binary],
        cwd: snapshot,
        stdout: "pipe",
        stderr: "pipe"
      })
      expect(build.exitCode).toBe(0)
      const result = Bun.spawnSync({ cmd: [binary, "capabilities"], cwd: root, stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode).toBe(0)
      expect(new TextDecoder().decode(result.stderr)).toBe("")
      const match = new TextDecoder().decode(result.stdout).match(/revision: ([0-9a-f]{40})/)
      expect(match?.[1]).toBe(revision)
      return match?.[1]
    })
    expect(reported[0]).not.toBe(reported[1])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("compiled attachment commands render representative successful output", () => {
  const root = mkdtempSync(join(tmpdir(), "linear-axi-compiled-attachment-"))
  const binary = join(root, "attachment-fixture")
  const source = join(root, "trace.txt")
  const destination = join(root, "downloaded.txt")
  try {
    writeFileSync(source, "hello world\n")
    const build = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "--no-compile-autoload-dotenv", "--outfile", binary, "test/compiled-attachment-fixture.ts"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe"
    })
    expect(build.exitCode).toBe(0)
    for (const [args, expected] of [
      [["attachments", "list", "--issue", "ENG-123"], "attachments[1]"],
      [["attachments", "view", "--id", "attachment-1"], "authenticated-signed-https"],
      [["attachments", "read", "--id", "attachment-1"], "hello world"],
      [["attachments", "download", "--id", "attachment-1", "--output", destination], "downloaded.txt"],
      [[
        "attachments", "upload", "--issue", "ENG-123", "--file", source,
        "--expect-workspace", "engineering", "--expect-team", "ENG"
      ], "attachment uploaded and verified"]
    ] as const) {
      const result = Bun.spawnSync({ cmd: [binary, ...args], cwd: root, stdout: "pipe", stderr: "pipe" })
      const stdout = new TextDecoder().decode(result.stdout)
      expect(result.exitCode).toBe(0)
      expect(new TextDecoder().decode(result.stderr)).toBe("")
      expect(stdout).toContain(expected)
      expect(stdout).not.toContain("uploads.linear.app")
    }
    expect(readFileSync(destination, "utf8")).toBe("hello world\n")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
