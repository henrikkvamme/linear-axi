import { rmSync, writeFileSync } from "node:fs"
import {
  hasGitMetadata,
  packagedRevisionPath,
  readPackagedRevision,
  verifyCleanCheckout
} from "./release-provenance"

const fail = (error: unknown): never => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

try {
  const action = process.argv[2]
  if (action === "prepare") {
    if (hasGitMetadata()) {
      const revision = verifyCleanCheckout("Release packaging")
      rmSync(packagedRevisionPath, { force: true })
      writeFileSync(packagedRevisionPath, `${revision}\n`)
    } else if (!readPackagedRevision()) {
      throw new Error(`Release packaging requires ${packagedRevisionPath} outside a Git checkout.`)
    }
  } else if (action === "cleanup") {
    if (hasGitMetadata()) rmSync(packagedRevisionPath, { force: true })
  } else {
    throw new Error("Package revision action must be prepare or cleanup.")
  }
} catch (error) {
  fail(error)
}
