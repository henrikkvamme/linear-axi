import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  exportImmutableRevision,
  hasGitMetadata,
  packagedRevisionPath,
  verifyCleanCheckout
} from "./release-provenance"

const invocationRoot = process.cwd()
const destinationFlag = Bun.argv.indexOf("--pack-destination")
const destinationValue = destinationFlag >= 0 ? Bun.argv[destinationFlag + 1] : "dist"
if (!destinationValue) {
  console.error("--pack-destination requires a path")
  process.exit(1)
}
const packDestination = resolve(invocationRoot, destinationValue)

let sourceRoot = invocationRoot
let cleanupSnapshot: (() => void) | undefined
try {
  if (!hasGitMetadata()) {
    throw new Error("Release packaging requires a verified Git checkout.")
  }
  const revision = verifyCleanCheckout("Release packaging")
  const snapshot = exportImmutableRevision("Release packaging", revision)
  sourceRoot = snapshot.root
  cleanupSnapshot = snapshot.cleanup
  writeFileSync(resolve(sourceRoot, packagedRevisionPath), `${revision}\n`)
  mkdirSync(packDestination, { recursive: true })

  const result = Bun.spawnSync({
    cmd: ["npm", "pack", "--pack-destination", packDestination],
    cwd: sourceRoot,
    env: { ...process.env, LINEAR_AXI_RELEASE_SNAPSHOT: revision },
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
