const revisionFlag = Bun.argv.indexOf("--revision")
const explicitRevision = revisionFlag >= 0 ? Bun.argv[revisionFlag + 1] : undefined
const outputFlag = Bun.argv.indexOf("--outfile")
const outfile = outputFlag >= 0 ? Bun.argv[outputFlag + 1] : "dist/linear-axi"

const gitRevision = explicitRevision ?? Bun.spawnSync({
  cmd: ["git", "rev-parse", "HEAD"],
  stdout: "pipe",
  stderr: "pipe"
}).stdout.toString().trim()

if (!/^[0-9a-f]{40}$/i.test(gitRevision)) {
  console.error("Release build requires an exact 40-hex immutable revision. Pass --revision <commit>.")
  process.exit(1)
}
if (!outfile) {
  console.error("--outfile requires a path")
  process.exit(1)
}

const result = Bun.spawnSync({
  cmd: [
    "bun", "build", "--compile", "--no-compile-autoload-dotenv",
    "--define", `__LINEAR_AXI_BUILD_REVISION__=${JSON.stringify(gitRevision)}`,
    "--outfile", outfile,
    "src/main.ts"
  ],
  stdout: "inherit",
  stderr: "inherit"
})
process.exit(result.exitCode)
