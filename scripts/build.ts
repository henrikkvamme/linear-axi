const revisionFlag = Bun.argv.indexOf("--revision")
const explicitRevision = revisionFlag >= 0 ? Bun.argv[revisionFlag + 1] : undefined
const outputFlag = Bun.argv.indexOf("--outfile")
const outfile = outputFlag >= 0 ? Bun.argv[outputFlag + 1] : "dist/linear-axi"

const insideWorktree = Bun.spawnSync({
  cmd: ["git", "rev-parse", "--is-inside-work-tree"],
  stdout: "pipe",
  stderr: "pipe"
}).stdout.toString().trim() === "true"
const checkoutRevision = insideWorktree ? Bun.spawnSync({
  cmd: ["git", "rev-parse", "HEAD"],
  stdout: "pipe",
  stderr: "pipe"
}).stdout.toString().trim() : undefined
const gitRevision = explicitRevision ?? checkoutRevision

if (!gitRevision || !/^[0-9a-f]{40}$/i.test(gitRevision)) {
  console.error("Release build requires an exact 40-hex immutable revision. Pass --revision <commit>.")
  process.exit(1)
}
if (checkoutRevision && explicitRevision && explicitRevision.toLowerCase() !== checkoutRevision.toLowerCase()) {
  console.error(`Release build revision ${explicitRevision} does not match checkout HEAD ${checkoutRevision}.`)
  process.exit(1)
}
if (insideWorktree) {
  const dirty = Bun.spawnSync({
    cmd: ["git", "status", "--porcelain", "--untracked-files=normal"],
    stdout: "pipe",
    stderr: "pipe"
  }).stdout.toString().trim()
  if (dirty.length > 0) {
    console.error("Release build requires a clean checkout so the immutable revision identifies the compiled source exactly.")
    process.exit(1)
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
