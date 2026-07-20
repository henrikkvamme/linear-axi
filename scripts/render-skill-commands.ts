import type { CommandSpec } from "../src/args"

export const renderSkillCommandReference = (specs: ReadonlyArray<CommandSpec>): string => [
  "# linear-axi Command Reference",
  "",
  "This file is generated from `commandSpecs`. Run `bun run skill:generate` after changing commands, flags, usage, examples, or command safety guidance.",
  "",
  ...specs.filter((spec) => spec.path[0] !== "home").flatMap((spec) => [
    `## ${spec.path.join(" ")}`,
    "",
    "```text",
    spec.help,
    "```",
    ""
  ])
].join("\n")
