import { commandSpecs } from "../src/args"
import { renderSkillCommandReference } from "./render-skill-commands"

await Bun.write(
  ".agents/skills/linear-axi/COMMANDS.md",
  renderSkillCommandReference(commandSpecs)
)
