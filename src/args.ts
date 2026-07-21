import { UsageError } from "./errors"
import { buildOfficialToolCapabilities } from "./official-capabilities"
import { officialCommandSpecs, officialTopLevelHelp } from "./official-commands"

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
  officialTools?: ReadonlyArray<string>
  repeatableFlags?: ReadonlySet<string>
  help: string
}

export const ISSUE_FIELDS = [
  "id", "identifier", "title", "state", "assignee", "parent", "labels", "updatedAt", "url", "subIssueSortOrder"
] as const
export const DEFAULT_ISSUE_FIELDS: ReadonlyArray<string> = ["id", "identifier", "title", "state"]
export const LABEL_FIELDS = ["id", "name", "scope", "color", "description", "isGroup", "parentId", "archivedAt"] as const
export const DEFAULT_LABEL_FIELDS: ReadonlyArray<string> = ["id", "name", "scope"]

const isFlag = (value: string): boolean => value.startsWith("--")

export const parseArgs = (argv: ReadonlyArray<string>, specs: ReadonlyArray<CommandSpec>): ParsedArgs => {
  const command: Array<string> = []
  const flags = new Map<string, string | boolean>()
  const duplicates = new Set<string>()
  const setFlag = (flag: string, value: string | boolean): void => {
    if (flags.has(flag)) duplicates.add(flag)
    flags.set(flag, value)
  }

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
      setFlag(flag, inlineValue)
    } else if (next === undefined || isFlag(next)) {
      setFlag(flag, true)
    } else {
      setFlag(flag, next)
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
    if (expectsValue && value === "") {
      throw new UsageError({
        message: flag === "after" ? "invalid --after cursor: value cannot be empty" : `--${flag} cannot be empty`,
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

  for (const flag of duplicates) {
    if (!(spec.repeatableFlags?.has(flag) ?? false)) {
      throw new UsageError({
        message: `--${flag} may only be specified once`,
        help: spec.help
      })
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
  "  linear-axi workflow-states list --team <key-or-id>",
  "  linear-axi issues list [--team <key-or-id>] [--label <id-or-name>] [--parent <issue>] [--assignee me|none|<user-uuid>] [--state open|closed] [--after <cursor>] [--limit 20] [--fields <fields>]",
  "  linear-axi issues view --id <issue-id-or-key> [--full]",
  "  linear-axi issues create --team <key-or-id> --title \"...\" [issue properties] [--id <uuid-v4> | --if-absent]",
  "  linear-axi issues assign --id <issue> --assignee me|<id-email-or-name> [--replace]",
  "  linear-axi issues unassign --id <issue> [--if-assignee me|<id-email-or-name>]",
  "  linear-axi issues close --id <issue> [--state <state-uuid>]",
  "  linear-axi issues state --id <issue> --state <state-id-or-name>",
  "  linear-axi issues parent set --id <issue> --parent <parent-issue>",
  "  linear-axi issues parent clear --id <issue>",
  "  linear-axi issues update --id <issue> [issue properties and explicit --clear-* flags]",
  "  linear-axi labels list [--workspace | --team <team>] [--name <exact-name>] [--issue <issue>] [--include-archived] [--after <cursor>] [--limit 100] [--fields <fields>]",
  "  linear-axi labels create --name <name> --color <#RRGGBB> (--workspace | --team <team>) [--group] [--parent <group>] [--id <uuid-v4>] [--if-absent]",
  "  linear-axi labels apply --issue <issue> --label <id-or-name>",
  "  linear-axi labels add --issue <issue> --label <id-or-name>",
  "  linear-axi labels remove --issue <issue> --label <id-or-name>",
  "  linear-axi labels replace --issue <issue> --labels-json '[\"Bug\",\"Urgent\"]'",
  "  linear-axi relations list --issue <blocked-issue> --blocked-by [--after <cursor>] [--limit 100]",
  "  linear-axi relations list --issue <issue> [--type <type>] [--direction outgoing|incoming|both] [--after <cursor>] [--limit 100]",
  "  linear-axi relations create --issue <blocked-issue> --blocked-by <blocker-issue> [--id <uuid-v4>]",
  "  linear-axi relations create --issue <source> --related-issue <target> --type <type> [--id <uuid-v4>]",
  "  linear-axi relations remove --id <relation-id>",
  "  linear-axi relations remove --issue <blocked> --blocked-by <blocker>",
  "  linear-axi comments list --issue <issue> [--after <cursor>] [--limit 50] [--full]",
  "  linear-axi comments create --issue <issue> (--body \"...\" | --body-file <path|->) [--id <uuid-v4>]",
  "  linear-axi attachments list --issue <issue> [--after <cursor>] [--limit 100]",
  "  linear-axi attachments view --id <attachment-id>",
  "  linear-axi attachments download --id <attachment-id> --output <path> [--overwrite] [--max-bytes <n>]",
  "  linear-axi attachments read --id <attachment-id> [--max-bytes <n>] [--full]",
  "  linear-axi attachments upload --issue <issue> --file <path> [--title <title>] [--subtitle <text>] [--media-type <type>] [--allow-large]",
  "  linear-axi wayfinder frontier --map <issue> [--first 20] [--after <cursor>]",
  ...officialTopLevelHelp
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
    path: ["attachments", "list"],
    flags: new Set(["help", "issue", "after", "limit"]),
    valueFlags: new Set(["issue", "after", "limit"]),
    required: new Set(["issue"]),
    help: "Usage: linear-axi attachments list --issue <issue-id-or-key> [--after <cursor>] [--limit 100]"
  },
  {
    path: ["attachments", "view"],
    flags: new Set(["help", "id"]),
    valueFlags: new Set(["id"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi attachments view --id <attachment-id>"
  },
  {
    path: ["attachments", "download"],
    flags: new Set(["help", "id", "output", "overwrite", "max-bytes"]),
    valueFlags: new Set(["id", "output", "max-bytes"]),
    required: new Set(["id", "output"]),
    help: "Usage: linear-axi attachments download --id <attachment-id> --output <path> [--overwrite] [--max-bytes <n>]\nInstalls atomically without replacement. Existing destinations fail closed, including with --overwrite."
  },
  {
    path: ["attachments", "read"],
    flags: new Set(["help", "id", "max-bytes", "full"]),
    valueFlags: new Set(["id", "max-bytes"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi attachments read --id <attachment-id> [--max-bytes <n>] [--full]\nOnly conservative UTF-8 textual media types are rendered. Binary files must be downloaded for inspection."
  },
  {
    path: ["attachments", "upload"],
    flags: new Set(["help", "issue", "file", "title", "subtitle", "media-type", "allow-large"]),
    valueFlags: new Set(["issue", "file", "title", "subtitle", "media-type"]),
    required: new Set(["issue", "file"]),
    help: "Usage: linear-axi attachments upload --issue <issue-id-or-key> --file <path> [--title <title>] [--subtitle <text>] [--media-type <type>] [--allow-large]\nRequires explicit issue and regular-file intent. Uses resumable prepare, direct PUT, and finalize; deprecated base64 creation is excluded."
  },
  {
    path: ["teams", "list"],
    flags: new Set(["help", "limit"]),
    valueFlags: new Set(["limit"]),
    help: "Usage: linear-axi teams list [--limit 50]"
  },
  {
    path: ["workflow-states", "list"],
    flags: new Set(["help", "team"]),
    valueFlags: new Set(["team"]),
    required: new Set(["team"]),
    help: "Usage: linear-axi workflow-states list --team <key-or-id>"
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
    flags: new Set(["help", "team", "title", "description", "description-file", "parent", "label", "labels-json", "id", "if-absent", "assignee", "delegate", "state", "priority", "due-date", "estimate", "project", "cycle", "milestone", "links-json", "releases-json", "blocks-json", "blocked-by-json", "related-to-json", "duplicate-of"]),
    valueFlags: new Set(["team", "title", "description", "description-file", "parent", "label", "labels-json", "id", "assignee", "delegate", "state", "priority", "due-date", "estimate", "project", "cycle", "milestone", "links-json", "releases-json", "blocks-json", "blocked-by-json", "related-to-json", "duplicate-of"]),
    required: new Set(["team", "title"]),
    help: "Usage: linear-axi issues create --team <key-or-id> --title \"...\" [--description <text> | --description-file <path|->] [--parent <issue>] [--label <label> | --labels-json '<array>'] [--assignee <selector>] [--delegate <agent>] [--state <id-or-name>] [--priority 0-4] [--due-date YYYY-MM-DD] [--estimate <number>] [--project <selector>] [--cycle <selector>] [--milestone <selector>] [--links-json '<[{url,title}]>'] [--releases-json '<array>'] [--id <uuid-v4> | --if-absent]\nAdvanced creation uses one official save_issue mutation after an exact-title preflight. --if-absent makes retries resumable; --id is supported by the native core path."
  },
  {
    path: ["issues", "assign"],
    flags: new Set(["help", "id", "assignee", "replace"]),
    valueFlags: new Set(["id", "assignee"]),
    required: new Set(["id", "assignee"]),
    help: "Usage: linear-axi issues assign --id <issue-id-or-key> --assignee me|<user-id-email-name-or-display-name> [--replace]"
  },
  {
    path: ["issues", "unassign"],
    flags: new Set(["help", "id", "if-assignee"]),
    valueFlags: new Set(["id", "if-assignee"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi issues unassign --id <issue-id-or-key> [--if-assignee me|<user-id-email-name-or-display-name>]"
  },
  {
    path: ["issues", "close"],
    flags: new Set(["help", "id", "state"]),
    valueFlags: new Set(["id", "state"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi issues close --id <issue-id-or-key> [--state <completed-state-uuid>]"
  },
  {
    path: ["issues", "state"],
    flags: new Set(["help", "id", "state"]),
    valueFlags: new Set(["id", "state"]),
    required: new Set(["id", "state"]),
    help: "Usage: linear-axi issues state --id <issue-id-or-key> --state <state-id-or-name>"
  },
  {
    path: ["issues", "parent", "set"],
    flags: new Set(["help", "id", "parent"]),
    valueFlags: new Set(["id", "parent"]),
    required: new Set(["id", "parent"]),
    help: "Usage: linear-axi issues parent set --id <issue-id-or-key> --parent <parent-id-or-key>"
  },
  {
    path: ["issues", "parent", "clear"],
    flags: new Set(["help", "id"]),
    valueFlags: new Set(["id"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi issues parent clear --id <issue-id-or-key>"
  },
  {
    path: ["issues", "update"],
    flags: new Set(["help", "id", "title", "description", "description-file", "if-updated-at", "assignee", "clear-assignee", "delegate", "clear-delegate", "state", "priority", "due-date", "clear-due-date", "estimate", "clear-estimate", "project", "clear-project", "cycle", "clear-cycle", "milestone", "clear-milestone", "parent", "clear-parent", "labels-json", "clear-labels", "links-json", "set-releases-json", "add-releases-json", "remove-releases-json", "blocks-json", "blocked-by-json", "related-to-json", "duplicate-of", "clear-duplicate", "remove-blocks-json", "remove-blocked-by-json", "remove-related-to-json"]),
    valueFlags: new Set(["id", "title", "description", "description-file", "if-updated-at", "assignee", "delegate", "state", "priority", "due-date", "estimate", "project", "cycle", "milestone", "parent", "labels-json", "links-json", "set-releases-json", "add-releases-json", "remove-releases-json", "blocks-json", "blocked-by-json", "related-to-json", "duplicate-of", "remove-blocks-json", "remove-blocked-by-json", "remove-related-to-json"]),
    required: new Set(["id"]),
    help: "Usage: linear-axi issues update --id <issue> [--title <text>] [--description <text> | --description-file <path|-> --if-updated-at <timestamp>] [--assignee <selector> | --clear-assignee] [--delegate <agent> | --clear-delegate] [--state <id-or-name>] [--priority 0-4] [--due-date YYYY-MM-DD | --clear-due-date] [--estimate <number> | --clear-estimate] [--project <selector> | --clear-project] [--cycle <selector> | --clear-cycle] [--milestone <selector> | --clear-milestone] [--parent <issue> | --clear-parent] [--labels-json '<array>' | --clear-labels] [--links-json '<[{url,title}]>'] [--set-releases-json '<array>' | --add-releases-json '<array>' | --remove-releases-json '<array>']\nSelected official MCP fields are sent in one save_issue mutation. Due-date and milestone clears use one verified native mutation and may only be combined with each other. Other clear flags pass explicit null or an empty label set. Links are append-only. Description writes require the exact updatedAt emitted by the CLI. Linear has no atomic compare-and-swap; an edit can still race between the final read and write."
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
    flags: new Set(["help", "name", "color", "workspace", "team", "description", "id", "if-absent", "group", "parent"]),
    valueFlags: new Set(["name", "color", "team", "description", "id", "parent"]),
    required: new Set(["name", "color"]),
    help: "Usage: linear-axi labels create --name <name> --color <#RRGGBB> (--workspace | --team <key-or-id>) [--description \"...\"] [--group] [--parent <group-id-or-name>] [--id <uuid-v4>] [--if-absent]\n--parent creates a child under an existing group. --group creates a label group. Caller UUID and --if-absent provide idempotent retries."
  },
  {
    path: ["labels", "apply"],
    flags: new Set(["help", "issue", "label"]),
    valueFlags: new Set(["issue", "label"]),
    required: new Set(["issue", "label"]),
    help: "Usage: linear-axi labels apply --issue <issue-id-or-key> --label <id-or-name>"
  },
  {
    path: ["labels", "add"],
    flags: new Set(["help", "issue", "label"]),
    valueFlags: new Set(["issue", "label"]),
    required: new Set(["issue", "label"]),
    help: "Usage: linear-axi labels add --issue <issue-id-or-key> --label <id-or-name>"
  },
  {
    path: ["labels", "remove"],
    flags: new Set(["help", "issue", "label"]),
    valueFlags: new Set(["issue", "label"]),
    required: new Set(["issue", "label"]),
    help: "Usage: linear-axi labels remove --issue <issue-id-or-key> --label <id-or-name>"
  },
  {
    path: ["labels", "replace"],
    flags: new Set(["help", "issue", "labels-json"]),
    valueFlags: new Set(["issue", "labels-json"]),
    required: new Set(["issue", "labels-json"]),
    help: "Usage: linear-axi labels replace --issue <issue-id-or-key> --labels-json '<JSON string array>'\nReplacement is explicit: labels omitted from the JSON array are removed. Use [] to clear all labels."
  },
  {
    path: ["relations", "list"],
    flags: new Set(["help", "issue", "blocked-by", "type", "direction", "after", "limit"]),
    valueFlags: new Set(["issue", "type", "direction", "after", "limit"]),
    required: new Set(["issue"]),
    help: "Usage: linear-axi relations list --issue <blocked-issue> --blocked-by [--after <cursor>] [--limit 100]\n   or: linear-axi relations list --issue <issue-id-or-key> [--type blocks|related|duplicate|similar] [--direction outgoing|incoming|both] [--after <cursor>] [--limit 100]\n--blocked-by lists blockers of --issue by selecting incoming blocks relations. Output names the query as blockedIssue and each counterpart as blockerIssue. Do not combine --blocked-by with --type or --direction."
  },
  {
    path: ["relations", "create"],
    flags: new Set(["help", "issue", "blocked-by", "related-issue", "type", "id"]),
    valueFlags: new Set(["issue", "blocked-by", "related-issue", "type", "id"]),
    required: new Set(["issue"]),
    help: "Usage: linear-axi relations create --issue <blocked-issue> --blocked-by <blocker-issue> [--id <uuid-v4>]\n   or: linear-axi relations create --issue <source-issue> --related-issue <target-issue> --type blocks|related|duplicate|similar [--id <uuid-v4>]\n--blocked-by is the blocker (source); --issue is the blocked issue (target). Do not combine --blocked-by with --related-issue or --type.\nFor generic --type blocks, --issue is the blocker and --related-issue is the blocked issue. Blocks relations cannot use two references that resolve to the same issue."
  },
  {
    path: ["relations", "remove"],
    flags: new Set(["help", "id", "issue", "blocked-by", "related-issue", "type"]),
    valueFlags: new Set(["id", "issue", "blocked-by", "related-issue", "type"]),
    help: "Usage: linear-axi relations remove --id <relation-id>\n   or: linear-axi relations remove --issue <blocked-issue> --blocked-by <blocker-issue>\n   or: linear-axi relations remove --issue <source> --related-issue <target> --type blocks|related|duplicate|similar"
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
  "workflow-states list": ["linear-axi workflow-states list --team ENG"],
  "issues list": ["linear-axi issues list --team ENG --state open", "linear-axi issues list --assignee me --limit 10"],
  "issues view": ["linear-axi issues view --id ENG-123 --full"],
  "issues create": ["linear-axi issues create --team ENG --title \"Fix auth bug\""],
  "issues assign": ["linear-axi issues assign --id ENG-123 --assignee me"],
  "issues unassign": ["linear-axi issues unassign --id ENG-123 --if-assignee me"],
  "issues close": ["linear-axi issues close --id ENG-123"],
  "issues state": ["linear-axi issues state --id ENG-123 --state \"In Progress\""],
  "issues parent set": ["linear-axi issues parent set --id ENG-124 --parent ENG-123"],
  "issues parent clear": ["linear-axi issues parent clear --id ENG-124"],
  "issues update": ["linear-axi issues update --id ENG-123 --description-file issue.md --if-updated-at 2026-07-13T12:00:00.000Z"],
  "labels list": ["linear-axi labels list --team ENG --name wayfinder:task", "linear-axi labels list --workspace --include-archived --fields id,name,archivedAt"],
  "labels create": ["linear-axi labels create --team ENG --name wayfinder:task --color '#123456'"],
  "labels apply": ["linear-axi labels apply --issue ENG-123 --label wayfinder:task"],
  "labels add": ["linear-axi labels add --issue ENG-123 --label Bug"],
  "labels remove": ["linear-axi labels remove --issue ENG-123 --label Bug"],
  "labels replace": ["linear-axi labels replace --issue ENG-123 --labels-json '[\"Bug\",\"Urgent\"]'"],
  "relations list": ["linear-axi relations list --issue ENG-124 --blocked-by", "linear-axi relations list --issue ENG-123 --type blocks --direction outgoing"],
  "relations create": ["linear-axi relations create --issue ENG-124 --blocked-by ENG-123", "linear-axi relations create --issue ENG-123 --related-issue ENG-124 --type blocks"],
  "relations remove": ["linear-axi relations remove --issue ENG-124 --blocked-by ENG-123", "linear-axi relations remove --id <relation-id>"],
  "comments list": ["linear-axi comments list --issue ENG-123 --full"],
  "comments create": ["linear-axi comments create --issue ENG-123 --body \"Implemented in PR.\""],
  "attachments list": ["linear-axi attachments list --issue ENG-123"],
  "attachments view": ["linear-axi attachments view --id <attachment-id>"],
  "attachments download": ["linear-axi attachments download --id <attachment-id> --output ./attachment.bin"],
  "attachments read": ["linear-axi attachments read --id <attachment-id>"],
  "attachments upload": ["linear-axi attachments upload --issue ENG-123 --file ./trace.txt"],
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
  "if-updated-at": "<YYYY-MM-DDTHH:mm:ss.sssZ>",
  "description-file": "<path|->",
  "body-file": "<path|->",
  "related-issue": "<issue>",
  "blocked-by": "<issue>",
  type: "<type>",
  direction: "<direction>",
  color: "<#RRGGBB>",
  name: "<name>",
  label: "<label>",
  "labels-json": "<JSON string array>",
  parent: "<issue>",
  title: "<title>",
  description: "<text>",
  body: "<text>",
  output: "<path>",
  file: "<path>",
  "max-bytes": "<bytes>",
  "media-type": "<type>",
  subtitle: "<text>"
}

const completeHelp = (spec: CommandSpec): CommandSpec => {
  if (spec.path[0] === "home") {
    return spec
  }
  const options = [...spec.flags].map((flag) => {
    const optionValue = flag === "fields" && spec.fields
      ? `<${spec.fields.join(",")}>`
      : spec.path.join(" ") === "labels create" && flag === "parent"
        ? "<group-id-or-name>"
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

const nativeOfficialToolsByCommand: Readonly<Record<string, ReadonlyArray<string>>> = {
  "teams list": ["list_teams"],
  "workflow-states list": ["list_issue_statuses", "get_issue_status"],
  "issues list": ["list_issues"],
  "issues view": ["get_issue"],
  "issues create": ["save_issue"],
  "issues assign": ["save_issue"],
  "issues unassign": ["save_issue"],
  "issues state": ["save_issue", "get_issue_status"],
  "issues parent set": ["save_issue"],
  "issues parent clear": ["save_issue"],
  "issues update": ["save_issue"],
  "labels list": ["list_issue_labels"],
  "labels create": ["create_issue_label"],
  "labels add": ["save_issue"],
  "labels remove": ["save_issue"],
  "labels replace": ["save_issue"],
  "relations create": ["save_issue"],
  "relations remove": ["save_issue"],
  "comments list": ["list_comments"],
  "comments create": ["save_comment"],
  "attachments list": ["get_issue"],
  "attachments view": ["get_attachment"],
  "attachments download": ["get_attachment"],
  "attachments read": ["get_attachment"],
  "attachments upload": ["get_issue", "prepare_attachment_upload", "create_attachment_from_upload"]
}

export const commandSpecs: ReadonlyArray<CommandSpec> = [
  ...rawCommandSpecs.map((spec) => completeHelp({
    ...spec,
    officialTools: nativeOfficialToolsByCommand[spec.path.join(" ")]
  })),
  ...officialCommandSpecs
]

export const officialToolCapabilities = buildOfficialToolCapabilities(commandSpecs)
