import packageMetadata from "../package.json" with { type: "json" }
import parityManifest from "../docs/linear-mcp-parity.json" with { type: "json" }

declare const __LINEAR_AXI_BUILD_REVISION__: string

export const PACKAGE_VERSION = packageMetadata.version
export const API_LEVEL = 2
export const BUILD_REVISION =
  typeof __LINEAR_AXI_BUILD_REVISION__ === "undefined"
    ? "development"
    : __LINEAR_AXI_BUILD_REVISION__

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
      files: ["SKILL.md", "COMMANDS.md"]
    }
  }
})
