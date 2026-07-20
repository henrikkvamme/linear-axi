import { commandSpecs } from "../src/args"
import { renderSkillCommandReference } from "./render-skill-commands"

interface Inventory { readonly observedAt: string; readonly toolCount: number; readonly tools: ReadonlyArray<{ readonly name: string }> }
interface Manifest { readonly observedAt: string; readonly inventorySha256: string; readonly tools: ReadonlyArray<{ readonly tool: string; readonly status: string; readonly commands: ReadonlyArray<string>; readonly rationale?: string }> }

const inventoryFile = Bun.file("docs/official-linear-mcp-tools.json")
const inventoryText = await inventoryFile.text()
const inventory = JSON.parse(inventoryText) as Inventory
const manifest = await Bun.file("docs/linear-mcp-parity.json").json() as Manifest
const fail = (message: string): never => { throw new Error(`Parity drift: ${message}`) }

if (inventory.observedAt !== manifest.observedAt) fail("inventory and manifest observation dates differ")
if (new Bun.CryptoHasher("sha256").update(inventoryText).digest("hex") !== manifest.inventorySha256) fail("official names, descriptions, or input schemas changed without updating the manifest hash")
if (inventory.tools.length !== inventory.toolCount) fail("official toolCount does not match the frozen tool array")
const officialNames = inventory.tools.map((tool) => tool.name)
const mappedNames = manifest.tools.map((tool) => tool.tool)
if (new Set(officialNames).size !== officialNames.length) fail("official inventory contains duplicate names")
if (new Set(mappedNames).size !== mappedNames.length) fail("manifest maps a tool more than once")
const missing = officialNames.filter((name) => !mappedNames.includes(name))
const stale = mappedNames.filter((name) => !officialNames.includes(name))
if (missing.length || stale.length) fail(`missing [${missing.join(", ")}], stale [${stale.join(", ")}]`)

const commandPaths = new Set(commandSpecs.map((spec) => spec.path.join(" ")))
for (const entry of manifest.tools) {
  if (entry.status.includes("needs-decision") && !entry.rationale) fail(`${entry.tool} needs a rationale`)
  if (!entry.status.includes("needs-decision") && entry.commands.length === 0) fail(`${entry.tool} has no command mapping`)
  for (const command of entry.commands) {
    if (!commandPaths.has(command)) fail(`${entry.tool} maps unknown command ${command}`)
  }
}

const skill = await Bun.file(".agents/skills/linear-axi/SKILL.md").text()
if (!skill.includes("`COMMANDS.md`")) fail("bundled skill does not link its generated command reference")
const commandReference = await Bun.file(".agents/skills/linear-axi/COMMANDS.md").text()
if (commandReference !== renderSkillCommandReference(commandSpecs)) {
  fail("bundled command reference differs from commandSpecs; run bun run skill:generate")
}

process.stderr.write(`Parity manifest covers ${officialNames.length} official Linear MCP tools observed ${inventory.observedAt}.\n`)
