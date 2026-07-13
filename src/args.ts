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
  fields?: ReadonlyArray<string>
  help: string
}

export const ISSUE_FIELDS = [
  "id", "identifier", "title", "state", "assignee", "parent", "labels", "updatedAt", "url", "subIssueSortOrder"
] as const
export const DEFAULT_ISSUE_FIELDS: ReadonlyArray<string> = ["id", "identifier", "title", "state"]
export const LABEL_FIELDS = ["id", "name", "scope", "color", "description", "isGroup", "archivedAt"] as const
export const DEFAULT_LABEL_FIELDS: ReadonlyArray<string> = ["id", "name", "scope"]

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
    if (flag === "after" && value === "") {
      throw new UsageError({
        message: "invalid --after cursor: value cannot be empty",
        help: spec.help
      })
    }
    if (!expectsValue && value !== true) {
      throw new UsageError({
        message: `--${flag} does not take a value`,
        help: spec.help
      })
    }
    if (flag === "limit" || flag === "first") {
      validatePageSize(flag, value, spec.help)
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

const validatePageSize = (flag: string, value: string | boolean | undefined, help: string): void => {
  const size = typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw new UsageError({
      message: `--${flag} must be an integer between 1 and 100`,
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
  "  linear-axi issues list [--team <key-or-id>] [--label <id-or-name>] [--parent <issue>] [--assignee me|none|<user-uuid>] [--state open|closed] [--after <cursor>] [--limit 20] [--fields <fields>]",
  "  linear-axi issues view --id <issue-id-or-key> [--full]",
  "  linear-axi issues create --team <key-or-id> --title \"...\" [--description \"...\" | --description-file <path|->] [--parent <issue>] [--label <label>] [--id <uuid-v4>]",
  "  linear-axi issues assign --id <issue> --assignee me|<user-uuid> [--replace]",
  "  linear-axi issues unassign --id <issue> [--if-assignee me|<user-uuid>]",
  "  linear-axi issues close --id <issue> [--state <state-uuid>]",
  "  linear-axi issues update --id <issue> --description-file <path|-> --if-updated-at <RFC3339>",
  "  linear-axi labels list [--workspace | --team <team>] [--name <exact-name>] [--issue <issue>] [--include-archived] [--after <cursor>] [--limit 100] [--fields <fields>]",
  "  linear-axi labels create --name <name> --color <#RRGGBB> (--workspace | --team <team>) [--description \"...\"] [--id <uuid-v4>] [--if-absent]",
  "  linear-axi labels apply --issue <issue> --label <id-or-name>",
  "  linear-axi relations list --issue <issue> [--type <type>] [--direction outgoing|incoming|both] [--after <cursor>] [--limit 100]",
  "  linear-axi relations create --issue <source> --related-issue <target> --type <type> [--id <uuid-v4>]",
  "  linear-axi comments list --issue <issue> [--after <cursor>] [--limit 50] [--full]",
  "  linear-axi comments create --issue <issue> (--body \"...\" | --body-file <path|->) [--id <uuid-v4>]",
  "  linear-axi wayfinder frontier --map <issue> [--first 20] [--after <cursor>]"
].join("\n")

const rawCommandSpecs: ReadonlyArray<CommandSpec> = [
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
    help: "Usage: linear-axi auth login [--client-id <id>] [--redirect-uri <url>] [--scope <scopes>] [--actor user|app] [--prompt-consent] [--notify] [--no-open] [--env-file <path>] [--timeout 300]"
  },
  {
    path: ["auth", "oauth", "setup"],
    flags: new Set(["help", "notify", "redirect-uri", "scope", "actor"]),
    valueFlags: new Set(["redirect-uri", "scope", "actor"]),
    help: "Usage: linear-axi auth oauth setup [--redirect-uri <url>] [--scope <scopes>] [--actor user|app] [--notify]"
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
    help: "Usage: linear-axi auth oauth connect [--client-id <id>] [--redirect-uri <url>] [--scope <scopes>] [--actor user|app] [--prompt-consent] [--write-env] [--env-file <path>] [--timeout 300] [--notify]"
  },
  {
    path: ["teams", "list"],
    flags: new Set(["help", "limit"]),
    valueFlags: new Set(["limit"]),
    help: "Usage: linear-axi teams list [--limit 50]"
  },
  {
    path: ["issues", "list"],
    flags: new Set(["help", "assignee", "team", "label", "parent", "state", "after", "limit", "fields"]),
    valueFlags: new Set(["assignee", "team", "label", "parent", "state", "after", "limit", "fields"]),
    fields: ISSUE_FIELDS,
    help: "Usage: linear-axi issues list [--team <key-or-id>] [--label <id-or-name>] [--parent <issue-id-or-key>] [--assignee me|none|<user-uuid>] [--state open|closed] [--after <cursor>] [--limit 20] [--fields <fields>]"
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
    flags: new Set(["help", "team", "title", "description", "description-file", "parent", "label", "id"]),
    valueFlags: new Set(["team", "title", "description", "description-file", "parent", "label", "id"]),
    required: new Set(["team", "title"]),
    help: "Usage: linear-axi issues create --team <key-or-id> --title \"...\" [--description \"...\" | --description-file <path|->] [--parent <issue-id-or-key>] [--label <id-or-name>] [--id <uuid-v4>]"
  },
  {
    path: ["issues", "assign"],
    flags: new Set(["help", "id", "assignee", "replace"]),
    valueFlags: new Set(["id", "assignee"]),
    required: new Set(["id", "assignee"]),
    help: "Usage: linear-axi issues assign --id <issue-id-or-key> --assignee me|<user-uuid> [--replace]"
  },
  {
    path: ["issues", "unassign"],
    flags: new Set(["help", "id", "if-assignee"]),
    valueFlags: new Set(["id", "if-assignee"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi issues unassign --id <issue-id-or-key> [--if-assignee me|<user-uuid>]"
  },
  {
    path: ["issues", "close"],
    flags: new Set(["help", "id", "state"]),
    valueFlags: new Set(["id", "state"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi issues close --id <issue-id-or-key> [--state <completed-state-uuid>]"
  },
  {
    path: ["issues", "update"],
    flags: new Set(["help", "id", "description-file", "if-updated-at"]),
    valueFlags: new Set(["id", "description-file", "if-updated-at"]),
    required: new Set(["id", "description-file", "if-updated-at"]),
    help: "Usage: linear-axi issues update --id <issue-id-or-key> --description-file <path|-> --if-updated-at <RFC3339>\nKnown-stale updates are rejected and writes are verified, but Linear has no atomic compare-and-swap; an edit can still race between the final read and write."
  },
  {
    path: ["labels", "list"],
    flags: new Set(["help", "workspace", "team", "name", "issue", "include-archived", "after", "limit", "fields"]),
    valueFlags: new Set(["team", "name", "issue", "after", "limit", "fields"]),
    fields: LABEL_FIELDS,
    help: "Usage: linear-axi labels list [--workspace | --team <key-or-id>] [--name <exact-name>] [--issue <issue-id-or-key>] [--include-archived] [--after <cursor>] [--limit 100] [--fields <fields>]"
  },
  {
    path: ["labels", "create"],
    flags: new Set(["help", "name", "color", "workspace", "team", "description", "id", "if-absent"]),
    valueFlags: new Set(["name", "color", "team", "description", "id"]),
    required: new Set(["name", "color"]),
    help: "Usage: linear-axi labels create --name <name> --color <#RRGGBB> (--workspace | --team <key-or-id>) [--description \"...\"] [--id <uuid-v4>] [--if-absent]"
  },
  {
    path: ["labels", "apply"],
    flags: new Set(["help", "issue", "label"]),
    valueFlags: new Set(["issue", "label"]),
    required: new Set(["issue", "label"]),
    help: "Usage: linear-axi labels apply --issue <issue-id-or-key> --label <id-or-name>"
  },
  {
    path: ["relations", "list"],
    flags: new Set(["help", "issue", "type", "direction", "after", "limit"]),
    valueFlags: new Set(["issue", "type", "direction", "after", "limit"]),
    required: new Set(["issue"]),
    help: "Usage: linear-axi relations list --issue <issue-id-or-key> [--type blocks|related|duplicate|similar] [--direction outgoing|incoming|both] [--after <cursor>] [--limit 100]"
  },
  {
    path: ["relations", "create"],
    flags: new Set(["help", "issue", "related-issue", "type", "id"]),
    valueFlags: new Set(["issue", "related-issue", "type", "id"]),
    required: new Set(["issue", "related-issue", "type"]),
    help: "Usage: linear-axi relations create --issue <source-issue> --related-issue <target-issue> --type blocks|related|duplicate|similar [--id <uuid-v4>]\nFor --type blocks, --issue is the blocker and --related-issue is the blocked issue."
  },
  {
    path: ["comments", "list"],
    flags: new Set(["help", "issue", "after", "limit", "full"]),
    valueFlags: new Set(["issue", "after", "limit"]),
    required: new Set(["issue"]),
    help: "Usage: linear-axi comments list --issue <issue-id-or-key> [--after <cursor>] [--limit 50] [--full]"
  },
  {
    path: ["comments", "create"],
    flags: new Set(["help", "issue", "body", "body-file", "id"]),
    valueFlags: new Set(["issue", "body", "body-file", "id"]),
    required: new Set(["issue"]),
    help: "Usage: linear-axi comments create --issue <issue-id-or-key> (--body \"...\" | --body-file <path|->) [--id <uuid-v4>]"
  },
  {
    path: ["wayfinder", "frontier"],
    flags: new Set(["help", "map", "first", "after", "limit"]),
    valueFlags: new Set(["map", "first", "after", "limit"]),
    required: new Set(["map"]),
    help: "Usage: linear-axi wayfinder frontier --map <issue-id-or-key> [--first 20] [--after <cursor>] [--limit 20]\nEach page recomputes current Linear state and does not provide snapshot isolation, so membership or ordering changes can move issues across the cursor. Restart without --after for a fresh frontier. --limit remains an alias for --first."
  }
]

const commandExamples: Readonly<Record<string, ReadonlyArray<string>>> = {
  "auth status": ["linear-axi auth status"],
  "auth login": ["linear-axi auth login", "linear-axi auth login --notify --timeout 300"],
  "auth oauth setup": ["linear-axi auth oauth setup --notify"],
  "auth oauth connect": ["linear-axi auth oauth connect --client-id lin_oauth_app_123 --write-env"],
  "teams list": ["linear-axi teams list --limit 25"],
  "issues list": ["linear-axi issues list --team ENG --state open", "linear-axi issues list --assignee me --limit 10"],
  "issues view": ["linear-axi issues view --id ENG-123 --full"],
  "issues create": ["linear-axi issues create --team ENG --title \"Fix auth bug\""],
  "issues assign": ["linear-axi issues assign --id ENG-123 --assignee me"],
  "issues unassign": ["linear-axi issues unassign --id ENG-123 --if-assignee me"],
  "issues close": ["linear-axi issues close --id ENG-123"],
  "issues update": ["linear-axi issues update --id ENG-123 --description-file issue.md --if-updated-at 2026-07-13T12:00:00Z"],
  "labels list": ["linear-axi labels list --team ENG --name wayfinder:task", "linear-axi labels list --workspace --include-archived --fields id,name,archivedAt"],
  "labels create": ["linear-axi labels create --team ENG --name wayfinder:task --color '#123456'"],
  "labels apply": ["linear-axi labels apply --issue ENG-123 --label wayfinder:task"],
  "relations list": ["linear-axi relations list --issue ENG-123 --type blocks --direction outgoing"],
  "relations create": ["linear-axi relations create --issue ENG-123 --related-issue ENG-124 --type blocks"],
  "comments list": ["linear-axi comments list --issue ENG-123 --full"],
  "comments create": ["linear-axi comments create --issue ENG-123 --body \"Implemented in PR.\""],
  "wayfinder frontier": ["linear-axi wayfinder frontier --map ENG-100 --first 20"]
}

const optionValues: Readonly<Record<string, string>> = {
  "client-id": "<id>",
  "redirect-uri": "<url>",
  scope: "<scopes>",
  actor: "user|app",
  "env-file": "<path>",
  timeout: "<seconds>",
  limit: "<1-100>",
  first: "<1-100>",
  fields: "<fields>",
  after: "<cursor>",
  id: "<id>",
  team: "<team>",
  issue: "<issue>",
  map: "<issue>",
  state: "<state>",
  assignee: "<assignee>",
  "if-assignee": "<assignee>",
  "if-updated-at": "<RFC3339>",
  "description-file": "<path|->",
  "body-file": "<path|->",
  "related-issue": "<issue>",
  type: "<type>",
  direction: "<direction>",
  color: "<#RRGGBB>",
  name: "<name>",
  label: "<label>",
  parent: "<issue>",
  title: "<title>",
  description: "<text>",
  body: "<text>"
}

const completeHelp = (spec: CommandSpec): CommandSpec => {
  if (spec.path[0] === "home") {
    return spec
  }
  const options = [...spec.flags].map((flag) => {
    const optionValue = flag === "fields" && spec.fields
      ? `<${spec.fields.join(",")}>`
      : (optionValues[flag] ?? "<value>")
    const value = spec.valueFlags?.has(flag) ? ` ${optionValue}` : ""
    const required = spec.required?.has(flag) ? " (required)" : ""
    return `  --${flag}${value}${required}`
  })
  const examples = commandExamples[spec.path.join(" ")] ?? []
  return {
    ...spec,
    help: [spec.help, "Options:", ...options, "Example:", ...examples.map((example) => `  ${example}`)].join("\n")
  }
}

export const commandSpecs: ReadonlyArray<CommandSpec> = rawCommandSpecs.map(completeHelp)
