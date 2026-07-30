import { existsSync } from "node:fs"

const revisionFlag = Bun.argv.indexOf("--revision")
const explicitRevision = revisionFlag >= 0 ? Bun.argv[revisionFlag + 1] : undefined
const outputFlag = Bun.argv.indexOf("--outfile")
const outfile = outputFlag >= 0 ? Bun.argv[outputFlag + 1] : "dist/linear-axi"

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const probeGit = (probe: "worktree" | "HEAD" | "status", args: ReadonlyArray<string>): string => {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    stdout: "pipe",
    stderr: "pipe"
  })
  if (result.exitCode !== 0) {
    const diagnostic = result.stderr.toString().trim()
    fail(`Release build could not verify Git ${probe} (exit ${result.exitCode})${diagnostic ? `: ${diagnostic}` : "."}`)
  }
  return result.stdout.toString().trim()
}

let checkoutRevision: string | undefined
if (existsSync(".git")) {
  const worktree = probeGit("worktree", ["rev-parse", "--is-inside-work-tree"])
  if (worktree !== "true") {
    fail(`Release build could not verify Git worktree: expected true, received ${JSON.stringify(worktree)}.`)
  }
  checkoutRevision = probeGit("HEAD", ["rev-parse", "HEAD"])
  if (!/^[0-9a-f]{40}$/i.test(checkoutRevision)) {
    fail(`Release build could not verify Git HEAD: expected an exact 40-hex revision, received ${JSON.stringify(checkoutRevision)}.`)
  }
}
const gitRevision = explicitRevision ?? checkoutRevision

if (!gitRevision || !/^[0-9a-f]{40}$/i.test(gitRevision)) {
  fail("Release build requires an exact 40-hex immutable revision. Pass --revision <commit>.")
}
if (checkoutRevision && explicitRevision && explicitRevision.toLowerCase() !== checkoutRevision.toLowerCase()) {
  fail(`Release build revision ${explicitRevision} does not match checkout HEAD ${checkoutRevision}.`)
}
if (checkoutRevision !== undefined) {
  const dirty = probeGit("status", ["status", "--porcelain", "--untracked-files=normal"])
  if (dirty.length > 0) {
    fail("Release build requires a clean checkout so the immutable revision identifies the compiled source exactly.")
  }
}
if (!outfile) {
  console.error("--outfile requires a path")
  process.exit(1)
}

const bundledSkillFiles = [
  ".agents/skills/linear-axi/COMMANDS.md",
  ".agents/skills/linear-axi/SKILL.md"
] as const
const bundledSkillHasher = new Bun.CryptoHasher("sha256")
for (const path of bundledSkillFiles) {
  bundledSkillHasher.update(`${path}\0`)
  bundledSkillHasher.update(new Uint8Array(await Bun.file(path).arrayBuffer()))
  bundledSkillHasher.update("\0")
}
const bundledSkillSha256 = bundledSkillHasher.digest("hex")

const result = Bun.spawnSync({
  cmd: [
    "bun", "build", "--compile", "--no-compile-autoload-dotenv",
    "--define", `__LINEAR_AXI_BUILD_REVISION__=${JSON.stringify(gitRevision)}`,
    "--define", `__LINEAR_AXI_BUNDLED_SKILL_SHA256__=${JSON.stringify(bundledSkillSha256)}`,
    "--outfile", outfile,
    "src/main.ts"
  ],
  stdout: "inherit",
  stderr: "inherit"
})
process.exit(result.exitCode)
