import { resolve } from "node:path"
import {
  exportImmutableRevision,
  hasGitMetadata,
  readPackagedRevision,
  validateRevision,
  verifyCleanCheckout
} from "./release-provenance"

const revisionFlag = Bun.argv.indexOf("--revision")
const explicitRevisionValue = revisionFlag >= 0 ? Bun.argv[revisionFlag + 1] : undefined
const outputFlag = Bun.argv.indexOf("--outfile")
const outfile = outputFlag >= 0 ? Bun.argv[outputFlag + 1] : "dist/linear-axi"

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

if (!outfile) fail("--outfile requires a path")

const invocationRoot = process.cwd()
const resolvedOutfile = resolve(invocationRoot, outfile)
let sourceRoot = invocationRoot
let cleanupSnapshot: (() => void) | undefined
let gitRevision: string
try {
  const explicitRevision = explicitRevisionValue === undefined
    ? undefined
    : validateRevision(explicitRevisionValue, "Release build revision")

  if (hasGitMetadata()) {
    const checkoutRevision = verifyCleanCheckout("Release build")
    if (explicitRevision && explicitRevision !== checkoutRevision) {
      throw new Error(`Release build revision ${explicitRevision} does not match checkout HEAD ${checkoutRevision}.`)
    }
    gitRevision = explicitRevision ?? checkoutRevision
    const snapshot = exportImmutableRevision("Release build", gitRevision)
    sourceRoot = snapshot.root
    cleanupSnapshot = snapshot.cleanup
  } else {
    const packagedRevision = readPackagedRevision()
    if (explicitRevision && packagedRevision && explicitRevision !== packagedRevision) {
      throw new Error(`Release build revision ${explicitRevision} does not match packaged source revision ${packagedRevision}.`)
    }
    const resolvedRevision = explicitRevision ?? packagedRevision
    if (!resolvedRevision) {
      throw new Error("Release build requires an exact 40-hex immutable revision. Pass --revision <commit> or build packaged source.")
    }
    gitRevision = resolvedRevision
  }

  const bundledSkillFiles = [
    ".agents/skills/linear-axi/COMMANDS.md",
    ".agents/skills/linear-axi/SKILL.md"
  ] as const
  const bundledSkillHasher = new Bun.CryptoHasher("sha256")
  for (const path of bundledSkillFiles) {
    bundledSkillHasher.update(`${path}\0`)
    bundledSkillHasher.update(new Uint8Array(await Bun.file(resolve(sourceRoot, path)).arrayBuffer()))
    bundledSkillHasher.update("\0")
  }
  const bundledSkillSha256 = bundledSkillHasher.digest("hex")

  const result = Bun.spawnSync({
    cmd: [
      "bun", "build", "--compile", "--no-compile-autoload-dotenv",
      "--define", `__LINEAR_AXI_BUILD_REVISION__=${JSON.stringify(gitRevision)}`,
      "--define", `__LINEAR_AXI_BUNDLED_SKILL_SHA256__=${JSON.stringify(bundledSkillSha256)}`,
      "--outfile", resolvedOutfile,
      "src/main.ts"
    ],
    cwd: sourceRoot,
    stdout: "inherit",
    stderr: "inherit"
  })
  if (result.exitCode !== 0) process.exitCode = result.exitCode
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  cleanupSnapshot?.()
}
