import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import packageMetadata from "../package.json" with { type: "json" }
import parityManifest from "../docs/linear-mcp-parity.json" with { type: "json" }

declare const __LINEAR_AXI_BUILD_REVISION__: string
declare const __LINEAR_AXI_BUNDLED_SKILL_SHA256__: string

const packageRoot = resolve(import.meta.dir, "..")
const packagedRevisionPath = resolve(packageRoot, "SOURCE_REVISION")
const bundledSkillFiles = [
  ".agents/skills/linear-axi/COMMANDS.md",
  ".agents/skills/linear-axi/SKILL.md"
] as const

const readSourceRevision = (): string | undefined => {
  if (!existsSync(packagedRevisionPath)) return undefined
  const metadata = lstatSync(packagedRevisionPath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Packaged source revision must be a regular file.")
  }
  const revision = readFileSync(packagedRevisionPath, "utf8").trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("Packaged source revision must be an exact 40-hex immutable revision.")
  }
  return revision
}

const hashBundledSkill = (): string => {
  const hash = createHash("sha256")
  for (const path of bundledSkillFiles) {
    hash.update(`${path}\0`)
    hash.update(readFileSync(resolve(packageRoot, path)))
    hash.update("\0")
  }
  return hash.digest("hex")
}

const packagedRevision =
  typeof __LINEAR_AXI_BUILD_REVISION__ === "undefined"
    ? readSourceRevision()
    : undefined

export const PACKAGE_VERSION = packageMetadata.version
export const API_LEVEL = 2
export const BUILD_REVISION =
  typeof __LINEAR_AXI_BUILD_REVISION__ === "undefined"
    ? packagedRevision ?? "development"
    : __LINEAR_AXI_BUILD_REVISION__
export const BUNDLED_SKILL_SHA256 =
  typeof __LINEAR_AXI_BUNDLED_SKILL_SHA256__ === "undefined"
    ? packagedRevision === undefined ? "development" : hashBundledSkill()
    : __LINEAR_AXI_BUNDLED_SKILL_SHA256__

export const CAPABILITIES = [
  "attachment-files-v1",
  "mutation-identity-v1"
] as const

export const buildCapabilities = () => ({
  build: {
    version: PACKAGE_VERSION,
    revision: BUILD_REVISION,
    apiLevel: API_LEVEL
  },
  officialInventory: {
    observedAt: parityManifest.observedAt,
    sha256: parityManifest.inventorySha256
  },
  capabilities: [...CAPABILITIES],
  convergence: {
    binaryRevision: BUILD_REVISION,
    bundledSkill: {
      repository: "https://github.com/henrikkvamme/linear-axi",
      sourceRevision: BUILD_REVISION,
      path: ".agents/skills/linear-axi",
      files: ["COMMANDS.md", "SKILL.md"],
      hashAlgorithm: "sha256-path-null-content-null-v1",
      contentSha256: BUNDLED_SKILL_SHA256
    }
  }
})
