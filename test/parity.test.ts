import { describe, expect, test } from "bun:test"
import { parityEntryError } from "../scripts/parity-contract"
import { renderSkillCommandReference } from "../scripts/render-skill-commands"
import { commandSpecs } from "../src/args"

interface Inventory { readonly observedAt: string; readonly toolCount: number; readonly tools: ReadonlyArray<{ readonly name: string }> }
interface Manifest { readonly observedAt: string; readonly inventorySha256: string; readonly tools: ReadonlyArray<{ readonly tool: string; readonly status: string; readonly commands: ReadonlyArray<string>; readonly rationale?: string }> }

describe("official Linear MCP parity drift", () => {
  test("maps every frozen official tool exactly once to commands or a decision", async () => {
    const inventoryText = await Bun.file("docs/official-linear-mcp-tools.json").text()
    const inventory = JSON.parse(inventoryText) as Inventory
    const manifest = await Bun.file("docs/linear-mcp-parity.json").json() as Manifest
    const commandReference = await Bun.file(".agents/skills/linear-axi/COMMANDS.md").text()
    const official = inventory.tools.map((tool) => tool.name)
    const mapped = manifest.tools.map((tool) => tool.tool)
    expect(inventory.toolCount).toBe(47)
    expect(inventory.observedAt).toBe("2026-07-20")
    expect(manifest.observedAt).toBe(inventory.observedAt)
    expect(manifest.inventorySha256).toBe(new Bun.CryptoHasher("sha256").update(inventoryText).digest("hex"))
    expect(new Set(mapped).size).toBe(mapped.length)
    expect([...mapped].sort()).toEqual([...official].sort())

    const commandPaths = new Set(commandSpecs.map((spec) => spec.path.join(" ")))
    for (const entry of manifest.tools) {
      expect(parityEntryError(entry), entry.tool).toBeUndefined()
      if (entry.status === "needs-decision" || entry.status === "partial-needs-decision") {
        expect(entry.rationale?.length).toBeGreaterThan(20)
      }
      for (const command of entry.commands) {
        expect(commandPaths.has(command), `${entry.tool}: ${command}`).toBe(true)
        expect(commandReference, `${entry.tool}: ${command}`).toContain(`linear-axi ${command}`)
      }
    }
    expect(commandReference).toBe(renderSkillCommandReference(commandSpecs))
  })

  test("rejects unknown statuses and unmapped partial entries", () => {
    expect(parityEntryError({ tool: "save_issue", status: "future-needs-decision", commands: [], rationale: "Pending" }))
      .toContain("unknown status")
    expect(parityEntryError({ tool: "save_issue", status: "partial-needs-decision", commands: [], rationale: "Pending" }))
      .toContain("no command mapping")
  })

  test("README and bundled skill cover the mandatory practical intents", async () => {
    const readme = await Bun.file("README.md").text()
    const skill = await Bun.file(".agents/skills/linear-axi/SKILL.md").text()
    const required = [
      "workflow-states list", "issues state", "issues parent set", "issues parent clear",
      "labels add", "labels remove", "labels replace", "relations remove", "issues update"
    ]
    for (const command of required) {
      expect(readme).toContain(`linear-axi ${command}`)
      expect(skill).toContain(`linear-axi ${command}`)
    }
    for (const noun of ["projects", "documents", "milestones", "releases", "release-notes", "status-updates", "users", "agent-skills", "diffs"]) {
      expect(skill).toContain(`\`${noun}`)
    }
    expect(readme).toContain("47 official tools")
    expect(skill).toContain("all 47 observed official tools")
  })
})
