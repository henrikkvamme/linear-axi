import { hasGitMetadata, packagedRevisionPath, readPackagedRevision } from "./release-provenance"

const fail = (error: unknown): never => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

try {
  const action = process.argv[2]
  if (action === "prepare") {
    if (hasGitMetadata()) {
      throw new Error("Release packaging from a Git checkout must use `bun run package:release` so npm consumes an immutable source snapshot.")
    }
    const revision = readPackagedRevision()
    if (!revision) {
      throw new Error(`Release packaging requires ${packagedRevisionPath} outside a Git checkout.`)
    }
    if (process.env.LINEAR_AXI_RELEASE_SNAPSHOT !== revision) {
      throw new Error("Release packaging requires the verified immutable snapshot workflow.")
    }
  } else if (action !== "cleanup") {
    throw new Error("Package revision action must be prepare or cleanup.")
  }
} catch (error) {
  fail(error)
}
