import { UsageError } from "./errors"

export interface ParsedArgs {
  command: ReadonlyArray<string>
  flags: ReadonlyMap<string, string | boolean>
}

export interface CommandSpec {
  path: ReadonlyArray<string>
  flags: ReadonlySet<string>
  valueFlags?: ReadonlySet<string>
  required?: ReadonlySet<string>
  help: string
}

const isFlag = (value: string): boolean => value.startsWith("--")

export const parseArgs = (argv: ReadonlyArray<string>, specs: ReadonlyArray<CommandSpec>): ParsedArgs => {
  const command: Array<string> = []
  const flags = new Map<string, string | boolean>()

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === undefined) {
      continue
    }

    if (!isFlag(arg)) {
      if (flags.size > 0) {
        throw new UsageError({
          message: `unexpected argument ${arg}`,
          help: "Put subcommands before flags, for example `linear-axi issues list --limit 20`."
        })
      }
      command.push(arg)
      continue
    }

    const flagText = arg.slice(2)
    const equalsIndex = flagText.indexOf("=")
    const flag = equalsIndex === -1 ? flagText : flagText.slice(0, equalsIndex)
    const inlineValue = equalsIndex === -1 ? undefined : flagText.slice(equalsIndex + 1)
    if (flag.length === 0) {
      throw new UsageError({ message: "empty flag", help: "Use flags like `--limit 20`." })
    }

    const next = argv[index + 1]
    if (inlineValue !== undefined) {
      flags.set(flag, inlineValue)
    } else if (next === undefined || isFlag(next)) {
      flags.set(flag, true)
    } else {
      flags.set(flag, next)
      index += 1
    }
  }

  const path = command.length === 0 ? ["home"] : command
  const spec = findSpec(path, specs)

  if (!spec) {
    throw new UsageError({
      message: `unknown command ${path.join(" ")}`,
      help: topLevelHelp
    })
  }

  for (const flag of flags.keys()) {
    if (!spec.flags.has(flag)) {
      throw new UsageError({
        message: `unknown flag --${flag} for \`${spec.path.join(" ")}\``,
        help: spec.help
      })
    }

    const expectsValue = spec.valueFlags?.has(flag) ?? false
    const value = flags.get(flag)
    if (expectsValue && value === true) {
      throw new UsageError({
        message: `--${flag} requires a value`,
        help: spec.help
      })
    }
    if (!expectsValue && value !== true) {
      throw new UsageError({
        message: `--${flag} does not take a value`,
        help: spec.help
      })
    }
    if (flag === "limit") {
      validateLimit(value, spec.help)
    }
  }

  if (flags.get("help") !== true) {
    for (const required of spec.required ?? []) {
      if (!flags.has(required)) {
        throw new UsageError({
          message: `--${required} is required`,
          help: spec.help
        })
      }
    }
  }

  return { command: path, flags }
}

export const findSpec = (
  path: ReadonlyArray<string>,
  specs: ReadonlyArray<CommandSpec>
): CommandSpec | undefined => specs.find((spec) => spec.path.join("\u0000") === path.join("\u0000"))

export const readStringFlag = (
  flags: ReadonlyMap<string, string | boolean>,
  name: string
): string | undefined => {
  const value = flags.get(name)
  if (value === undefined || value === false) {
    return undefined
  }
  if (value === true) {
    return undefined
  }
  return value
}

export const readBooleanFlag = (flags: ReadonlyMap<string, string | boolean>, name: string): boolean =>
  flags.get(name) === true

export const readLimitFlag = (flags: ReadonlyMap<string, string | boolean>, fallback: number): number => {
  const raw = readStringFlag(flags, "limit")
  if (raw === undefined) {
    return fallback
  }

  return Number(raw)
}

const validateLimit = (value: string | boolean | undefined, help: string): void => {
  const limit = typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new UsageError({
      message: "--limit must be an integer between 1 and 100",
      help
    })
  }
}

export const topLevelHelp = [
  "linear-axi",
  "Commands:",
  "  linear-axi",
  "  linear-axi auth status",
  "  linear-axi auth login [--notify] [--no-open]",
  "  linear-axi auth oauth setup [--notify]",
  "  linear-axi auth oauth connect [--client-id <id>] [--write-env] [--notify]",
  "  linear-axi teams list [--limit 50]",
  "  linear-axi issues list [--assignee me] [--team <key-or-id>] [--limit 20]",
  "  linear-axi issues view --id <issue-id-or-key> [--full]",
  "  linear-axi issues create --team <key-or-id> --title \"...\" [--description \"...\"]",
  "  linear-axi comments create --issue <issue-id-or-key> --body \"...\""
].join("\n")

export const commandSpecs: ReadonlyArray<CommandSpec> = [
  {
    path: ["home"],
    flags: new Set(["help"]),
    help: topLevelHelp
  },
  {
    path: ["auth", "status"],
    flags: new Set(["help"]),
    help: "Usage: linear-axi auth status"
  },
  {
    path: ["auth", "login"],
    flags: new Set([
      "help",
      "client-id",
      "redirect-uri",
      "scope",
      "actor",
      "prompt-consent",
      "notify",
      "no-open",
      "env-file",
      "timeout"
    ]),
    valueFlags: new Set(["client-id", "redirect-uri", "scope", "actor", "env-file", "timeout"]),
    help: "Usage: linear-axi auth login [--notify] [--no-open]"
  },
  {
    path: ["auth", "oauth", "setup"],
    flags: new Set(["help", "notify", "redirect-uri", "scope", "actor"]),
    valueFlags: new Set(["redirect-uri", "scope", "actor"]),
    help: "Usage: linear-axi auth oauth setup [--notify]"
  },
  {
    path: ["auth", "oauth", "connect"],
    flags: new Set([
      "help",
      "client-id",
      "redirect-uri",
      "scope",
      "actor",
      "prompt-consent",
      "notify",
      "write-env",
      "env-file",
      "timeout"
    ]),
    valueFlags: new Set(["client-id", "redirect-uri", "scope", "actor", "env-file", "timeout"]),
    help: "Usage: linear-axi auth oauth connect [--client-id <id>] [--redirect-uri <url>] [--write-env] [--notify]"
  },
  {
    path: ["teams", "list"],
    flags: new Set(["help", "limit"]),
    valueFlags: new Set(["limit"]),
    help: "Usage: linear-axi teams list [--limit 50]"
  },
  {
    path: ["issues", "list"],
    flags: new Set(["help", "assignee", "team", "limit"]),
    valueFlags: new Set(["assignee", "team", "limit"]),
    help: "Usage: linear-axi issues list [--assignee me] [--team <key-or-id>] [--limit 20]"
  },
  {
    path: ["issues", "view"],
    flags: new Set(["help", "id", "full"]),
    valueFlags: new Set(["id"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi issues view --id <issue-id-or-key> [--full]"
  },
  {
    path: ["issues", "create"],
    flags: new Set(["help", "team", "title", "description"]),
    valueFlags: new Set(["team", "title", "description"]),
    required: new Set(["team", "title"]),
    help: "Usage: linear-axi issues create --team <key-or-id> --title \"...\" [--description \"...\"]"
  },
  {
    path: ["comments", "create"],
    flags: new Set(["help", "issue", "body"]),
    valueFlags: new Set(["issue", "body"]),
    required: new Set(["issue", "body"]),
    help: "Usage: linear-axi comments create --issue <issue-id-or-key> --body \"...\""
  }
]
