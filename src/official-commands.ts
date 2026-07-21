import { Effect, Predicate, Schema } from "effect"
import type { CommandSpec, ParsedArgs } from "./args"
import { LinearDomainError, UsageError, type CliError } from "./errors"
import { DESCRIPTION_CONCURRENCY_WARNING, type LinearGateway } from "./linear"
import {
  findCanonicalIntersection,
  officialCollectionAbsent as collectionAbsent,
  officialCollectionContains as collectionContains,
  officialCollectionEqual as collectionEqual,
  officialReferenceEqual
} from "./official-collection"
import {
  officialEntityIdentity,
  officialOwnerReference,
  officialReferenceMatchesIdentity,
  officialReferenceSelector,
  officialReferenceValues,
  type OfficialEntityIdentity
} from "./official-identity"
import {
  requireOfficialEntityActive,
  requireOfficialUserActive,
  resolveOfficialViewerUser
} from "./official-active"
import { indeterminateOfficialMutation, officialMutationInspectionCommand, officialReleaseNoteNeedsReleases } from "./official-inspection"
import { fetchOfficialRows } from "./official-pagination"
import { resolveExactOfficialEntity, resolveExactOfficialId } from "./official-selector"
import { truncateDetail, truncateText, type OutputValue } from "./output"
import { richTextEqual } from "./rich-text"
import { isCanonicalDate, isCanonicalTimestamp } from "./validation"

type FlagKind = "string" | "number" | "boolean" | "null" | "empty-string" | "string-array"

interface OfficialFlag {
  readonly arg?: string
  readonly kind: FlagKind
  readonly required?: boolean
  readonly values?: ReadonlyArray<string>
  readonly integer?: boolean
  readonly minimum?: number
  readonly maximum?: number
  readonly format?: "color" | "date" | "timestamp"
  readonly maxLength?: number
  readonly internal?: boolean
  readonly defaultValue?: string | number | boolean
  readonly description?: string
  readonly conflictsWith?: ReadonlyArray<string>
  readonly repeatable?: boolean
}

interface OfficialCommand {
  readonly path: ReadonlyArray<string>
  readonly tool: string
  readonly flags: Readonly<Record<string, OfficialFlag>>
  readonly outputKey: string
  readonly listKey?: string
  readonly defaultFields?: ReadonlyArray<string>
  readonly examples: ReadonlyArray<string>
  readonly fixedArgs?: Readonly<Record<string, unknown>>
  readonly validate?: (flags: ReadonlyMap<string, string | boolean>) => string | undefined
}

const FULL_FLAG_DESCRIPTION = "Disable local projection and text truncation; associations still require explicit inclusion flags."

const OFFICIAL_FLAG_DESCRIPTIONS: Readonly<Record<string, string>> = {
  id: "Entity ID or documented stable selector.",
  query: "Search text or documented entity selector.",
  limit: "Maximum results to return.",
  after: "Continue after this pagination cursor.",
  "order-by": "Sort results by this timestamp.",
  full: FULL_FLAG_DESCRIPTION,
  team: "Team name, key, or ID.",
  "team-id": "Team ID.",
  project: "Project name, slug, or ID.",
  "project-id": "Project ID.",
  initiative: "Initiative name or ID.",
  "initiative-id": "Initiative ID.",
  issue: "Issue identifier or ID.",
  "issue-id": "Issue identifier or ID.",
  cycle: "Cycle name, number, or ID.",
  state: "State type, name, or ID.",
  label: "Label name or ID.",
  assignee: "User ID, name, email, me, or null where supported.",
  delegate: "Agent name or ID.",
  release: "Release ID or slug.",
  pipeline: "Release pipeline name, slug, or ID.",
  stage: "Release stage name, type, or ID.",
  lead: "User ID, name, email, or me.",
  member: "User ID, name, email, or me.",
  user: "User ID, name, email, or me.",
  "parent-id": "Parent issue identifier or ID.",
  "created-at": "Filter after this ISO-8601 timestamp or duration.",
  "updated-at": "Filter after this ISO-8601 timestamp or duration.",
  priority: "Priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.",
  title: "Literal title.",
  name: "Literal name.",
  summary: "Literal short summary.",
  description: "Markdown description.",
  content: "Markdown content.",
  body: "Markdown body.",
  icon: "Icon name or emoji code, not raw Unicode.",
  color: "Six-digit hexadecimal color.",
  page: "Zero-based documentation result page.",
  "range-from": "First release in the note range.",
  "range-to": "Last release in the note range."
}

const commonList = {
  limit: { kind: "number", arg: "limit", integer: true, minimum: 1, maximum: 100, defaultValue: 50, description: "Maximum results to return." },
  after: { kind: "string", arg: "cursor", description: "Continue after this pagination cursor." },
  "order-by": { kind: "string", arg: "orderBy", values: ["createdAt", "updatedAt"], defaultValue: "updatedAt", description: "Sort results by this timestamp." },
  full: { kind: "boolean", defaultValue: false, description: FULL_FLAG_DESCRIPTION }
} as const
const decodeStringArray = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.NonEmptyString)))

const commands: ReadonlyArray<OfficialCommand> = [
  command("comments search", "list_comments", { ...commonList, "issue-id": stringFlag("issueId"), "project-id": stringFlag("projectId"), "initiative-id": stringFlag("initiativeId"), "document-id": stringFlag("documentId"), "milestone-id": stringFlag("milestoneId"), "status-update-id": stringFlag("statusUpdateId"), "status-update-type": stringFlag("statusUpdateType", ["project", "initiative"]) }, "comments", "comments", ["id", "body", "createdAt", "updatedAt"], ["linear-axi comments search --project-id <project-id>"], undefined, commentSearchValidation),
  command("agent-skills list", "list_agent_skills", { ...commonList }, "agentSkills", "agentSkills", ["id", "name", "updatedAt"], ["linear-axi agent-skills list --limit 50"]),
  command("agent-skills view", "get_agent_skill", { id: requiredString(), full: fullFlag() }, "agentSkill", undefined, undefined, ["linear-axi agent-skills view --id <skill-id> --full"]),
  command("cycles list", "list_cycles", { "team-id": requiredString("teamId"), type: stringFlag(undefined, ["current", "previous", "next"]), full: fullFlag() }, "cycles", "$", ["id", "number", "name", "startsAt", "endsAt"], ["linear-axi cycles list --team-id <team-id> --type current"]),
  command("documents list", "list_documents", { ...commonList, query: stringFlag(), "project-id": stringFlag("projectId"), "initiative-id": stringFlag("initiativeId"), "team-id": stringFlag("teamId"), "creator-id": stringFlag("creatorId"), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived", false) }, "documents", "documents", ["id", "title", "slugId", "updatedAt"], ["linear-axi documents list --query roadmap --limit 20"]),
  command("documents view", "get_document", { id: requiredString(), full: fullFlag() }, "document", undefined, undefined, ["linear-axi documents view --id <id-or-slug> --full"]),
  command("documents update", "save_document", { id: requiredString(), title: stringFlag(), content: stringFlag(), "clear-content": emptyStringFlag("content", ["content"]), "if-updated-at": preconditionFlag(), project: stringFlag(), issue: stringFlag(), initiative: stringFlag(), cycle: stringFlag(), team: stringFlag(), icon: stringFlag(), color: formattedStringFlag("color"), full: fullFlag() }, "document", undefined, undefined, ["linear-axi documents update --id <document-id> --title \"New title\""], undefined, documentUpdateValidation),
  command("issues inspect", "get_issue", { id: requiredString(), relations: bool("includeRelations", false), "customer-needs": bool("includeCustomerNeeds", false), releases: bool("includeReleases", false), full: fullFlag() }, "issue", undefined, undefined, ["linear-axi issues inspect --id ENG-123 --relations --full"]),
  command("issues search", "list_issues", { ...commonList, query: stringFlag(), team: stringFlag(), state: stringFlag(), cycle: stringFlag(), label: stringFlag(), assignee: stringFlag(), delegate: stringFlag(), project: stringFlag(), release: stringFlag(), priority: constrainedNumber({ integer: true, minimum: 0, maximum: 4 }), "parent-id": stringFlag("parentId"), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived", true) }, "issues", "issues", ["id", "title", "status", "team"], ["linear-axi issues search --team ENG --query auth"]),
  command("projects list", "list_projects", { ...commonList, limit: { ...commonList.limit, maximum: 50 }, query: stringFlag(), state: stringFlag(), initiative: stringFlag(), team: stringFlag(), member: stringFlag(), label: stringFlag(), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), milestones: bool("includeMilestones", false), members: bool("includeMembers", false), "include-archived": bool("includeArchived", false) }, "projects", "projects", ["id", "name", "slugId", "state", "updatedAt"], ["linear-axi projects list --team ENG --limit 20"], undefined, maxLimit(50)),
  command("projects view", "get_project", { query: requiredString(), milestones: bool("includeMilestones", false), members: bool("includeMembers", false), resources: bool("includeResources", false), full: fullFlag() }, "project", undefined, undefined, ["linear-axi projects view --query <id-name-or-slug> --full"]),
  command("projects update", "save_project", { id: requiredString(), name: stringFlag(), icon: stringFlag(), color: formattedStringFlag("color"), summary: limitedStringFlag(255), "clear-summary": emptyStringFlag("summary", ["summary"]), description: stringFlag(), "clear-description": emptyStringFlag("description", ["description"]), "if-updated-at": preconditionFlag(), state: stringFlag(), "start-date": formattedStringFlag("date", "startDate"), "start-date-resolution": stringFlag("startDateResolution", ["halfYear", "month", "quarter", "year"]), "target-date": formattedStringFlag("date", "targetDate"), "target-date-resolution": stringFlag("targetDateResolution", ["halfYear", "month", "quarter", "year"]), priority: constrainedNumber({ integer: true, minimum: 0, maximum: 4 }), "add-teams-json": arrayFlag("addTeams", ["teams-json"]), "remove-teams-json": arrayFlag("removeTeams", ["teams-json"]), "teams-json": arrayFlag("setTeams", ["add-teams-json", "remove-teams-json"]), "labels-json": arrayFlag("labels"), lead: stringFlag(), "clear-lead": nullFlag("lead", ["lead"]), "add-initiatives-json": arrayFlag("addInitiatives", ["initiatives-json"]), "remove-initiatives-json": arrayFlag("removeInitiatives", ["initiatives-json"]), "initiatives-json": arrayFlag("setInitiatives", ["add-initiatives-json", "remove-initiatives-json"]), full: fullFlag() }, "project", undefined, undefined, ["linear-axi projects update --id <project-id> --state started"]),
  command("project-labels list", "list_project_labels", { ...commonList, name: stringFlag() }, "projectLabels", "labels", ["id", "name", "color"], ["linear-axi project-labels list --name Platform"]),
  command("release-pipelines list", "list_release_pipelines", { ...commonList, query: stringFlag(), team: stringFlag(), type: stringFlag(undefined, ["continuous", "scheduled"]), production: bool("isProduction"), stages: bool("includeStages", false), teams: bool("includeTeams", false), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived", false) }, "releasePipelines", "releasePipelines", ["id", "name", "slugId", "type", "isProduction"], ["linear-axi release-pipelines list --team ENG"]),
  command("releases list", "list_releases", { ...commonList, query: stringFlag(), pipeline: stringFlag(), stage: stringFlag(), "stage-type": stringFlag("stageType", ["planned", "started", "completed", "canceled"]), version: stringFlag(), "has-release-notes": bool("hasReleaseNotes"), "release-notes": bool("includeReleaseNotes", false), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived", false) }, "releases", "releases", ["id", "name", "version", "stage", "updatedAt"], ["linear-axi releases list --pipeline <pipeline> --limit 20"]),
  command("releases view", "get_release", { id: requiredString(), "release-notes": bool("includeReleaseNotes", false), full: fullFlag() }, "release", undefined, undefined, ["linear-axi releases view --id <id-or-slug> --release-notes"]),
  command("releases update", "save_release", { id: requiredString(), name: stringFlag(), description: stringFlag(), "clear-description": emptyStringFlag("description", ["description"]), "if-updated-at": preconditionFlag(), version: stringFlag(), pipeline: stringFlag(), stage: stringFlag(), "start-date": formattedStringFlag("date", "startDate"), "clear-start-date": nullFlag("startDate", ["start-date"]), "target-date": formattedStringFlag("date", "targetDate"), "clear-target-date": nullFlag("targetDate", ["target-date"]), "created-at": formattedStringFlag("timestamp", "createdAt"), "started-at": formattedStringFlag("timestamp", "startedAt"), "clear-started-at": nullFlag("startedAt", ["started-at"]), "completed-at": formattedStringFlag("timestamp", "completedAt"), "clear-completed-at": nullFlag("completedAt", ["completed-at"]), "commit-sha": stringFlag("commitSha"), full: fullFlag() }, "release", undefined, undefined, ["linear-axi releases update --id <release-id> --stage shipped"]),
  command("release-notes list", "list_release_notes", { ...commonList, query: stringFlag(), pipeline: stringFlag(), release: stringFlag(), content: bool("includeContent", false), releases: bool("includeReleases", false), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived", false) }, "releaseNotes", "releaseNotes", ["id", "title", "slugId", "updatedAt"], ["linear-axi release-notes list --pipeline <pipeline>"]),
  command("release-notes view", "get_release_note", { id: requiredString(), releases: bool("includeReleases", false), full: fullFlag() }, "releaseNote", undefined, undefined, ["linear-axi release-notes view --id <id-or-slug> --full"]),
  command("release-notes update", "save_release_note", { id: requiredString(), pipeline: stringFlag(), title: stringFlag(), content: stringFlag(), "clear-content": emptyStringFlag("content", ["content"]), "if-updated-at": preconditionFlag(), "releases-json": arrayFlag("releases", ["range-from", "range-to"]), "range-from": stringFlag("rangeFromRelease", undefined, ["releases-json"]), "range-to": stringFlag("rangeToRelease", undefined, ["releases-json"]), full: fullFlag() }, "releaseNote", undefined, undefined, ["linear-axi release-notes update --id <note-id> --title \"v2 notes\""], undefined, releaseRangeValidation),
  command("diffs list", "list_diffs", { ...commonList, query: stringFlag(), owner: stringFlag(), repo: stringFlag(), status: stringFlag() }, "diffs", "diffs", ["id", "identifier", "title", "status", "updatedAt"], ["linear-axi diffs list --repo linear-axi --limit 20"]),
  command("diffs view", "get_diff", { id: requiredString("urlOrId"), full: fullFlag() }, "diff", undefined, undefined, ["linear-axi diffs view --id <url-or-id> --full"]),
  command("diffs threads", "get_diff_threads", { id: requiredString("urlOrId"), "thread-id": stringFlag("threadId"), resolved: bool(), "order-by": { kind: "string", arg: "orderBy", values: ["createdAt", "updatedAt"], defaultValue: "updatedAt", description: "Sort threads by this timestamp." }, full: fullFlag() }, "threads", "$", ["id", "resolved", "createdAt", "updatedAt"], ["linear-axi diffs threads --id <url-or-id>"]),
  command("milestones list", "list_milestones", { project: requiredString(), full: fullFlag() }, "milestones", "$", ["id", "name", "targetDate"], ["linear-axi milestones list --project <project>"]),
  command("milestones view", "get_milestone", { project: requiredString(), query: requiredString(), full: fullFlag() }, "milestone", undefined, undefined, ["linear-axi milestones view --project <project> --query <id-or-name>"]),
  command("milestones update", "save_milestone", { project: requiredString(), id: requiredString(), name: stringFlag(), description: stringFlag(), "clear-description": emptyStringFlag("description", ["description"]), "if-updated-at": preconditionFlag(), "target-date": formattedStringFlag("date", "targetDate"), "clear-target-date": nullFlag("targetDate", ["target-date"]), full: fullFlag() }, "milestone", undefined, undefined, ["linear-axi milestones update --project Roadmap --id <milestone-id> --target-date 2026-09-01"]),
  command("teams search", "list_teams", { ...commonList, query: stringFlag(), "include-archived": bool("includeArchived", false), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt") }, "teams", "teams", ["id", "key", "name", "updatedAt"], ["linear-axi teams search --query Engineering"]),
  command("teams view", "get_team", { query: requiredString(), full: fullFlag() }, "team", undefined, undefined, ["linear-axi teams view --query <id-key-or-name>"]),
  command("users list", "list_users", { ...commonList, query: stringFlag(), team: stringFlag() }, "users", "users", ["id", "name", "email", "active"], ["linear-axi users list --query Alice"]),
  command("users view", "get_user", { query: requiredString(), full: fullFlag() }, "user", undefined, undefined, ["linear-axi users view --query <id-name-or-email>"]),
  command("docs search", "search_documentation", { query: requiredString(), page: constrainedNumber({ integer: true, minimum: 0, defaultValue: 0 }) }, "documentation", "$", ["title", "url", "snippet"], ["linear-axi docs search --query \"project updates\""]),
  command("status-updates list", "get_status_updates", { ...commonList, type: requiredStringEnum(["project", "initiative"]), project: stringFlag(), initiative: stringFlag(), user: stringFlag(), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived", false) }, "statusUpdates", "statusUpdates", ["id", "type", "health", "createdAt", "updatedAt"], ["linear-axi status-updates list --type project --project <project>"]),
  command("status-updates view", "get_status_updates", { id: requiredString(), type: requiredStringEnum(["project", "initiative"]), full: fullFlag() }, "statusUpdates", "statusUpdates", ["id", "type", "health", "body"], ["linear-axi status-updates view --id <update-id> --type project"]),
  command("status-updates update", "save_status_update", { type: requiredStringEnum(["project", "initiative"]), id: requiredString(), project: stringFlag(), initiative: stringFlag(), body: stringFlag(), "clear-body": emptyStringFlag("body", ["body"]), "if-updated-at": preconditionFlag(), health: stringFlag(undefined, ["onTrack", "atRisk", "offTrack"]), full: fullFlag() }, "statusUpdate", undefined, undefined, ["linear-axi status-updates update --type project --id <update-id> --health onTrack"], undefined, statusUpdateValidation)
]

export const officialCommandSpecs: ReadonlyArray<CommandSpec> = commands.map((entry) => {
  const flagNames = Object.entries(entry.flags).flatMap(([name, flag]) =>
    flag.kind === "boolean" && name !== "full" ? [name, `no-${name}`] : [name])
  const flags = new Set(["help", ...flagNames])
  const valueFlags = new Set(Object.entries(entry.flags).filter(([, flag]) => !["boolean", "null", "empty-string"].includes(flag.kind)).map(([name]) => name))
  const required = new Set(Object.entries(entry.flags).filter(([, flag]) => flag.required).map(([name]) => name))
  const repeatableFlags = new Set(Object.entries(entry.flags).filter(([, flag]) => flag.repeatable).map(([name]) => name))
  const usage = `Usage: linear-axi ${entry.path.join(" ")} ${Object.entries(entry.flags)
    .filter(([, flag]) => flag.required)
    .map(([name, flag]) => `--${name} ${officialFlagValue(name, flag)}`)
    .join(" ")}`.trimEnd()
  const options = [
    "  --help - Show command help.",
    ...Object.entries(entry.flags).map(([name, flag]) => renderOfficialFlag(name, flag))
  ]
  const safety = mutationRichTextKeys(entry.tool).length === 0
    ? []
    : ["Safety:", "  Rich-text replacements and clears require --if-updated-at from the latest full view. Linear has no atomic compare-and-swap, so a final read/write race remains."]
  return {
    path: entry.path,
    flags,
    valueFlags,
    required,
    repeatableFlags,
    officialTools: [entry.tool],
    help: [usage, "Options (single-use unless marked repeatable):", ...options, ...safety, "Example:", ...entry.examples.map((example) => `  ${example}`)].join("\n")
  }
})

export const officialTopLevelHelp: ReadonlyArray<string> = commands.map((entry) =>
  `  linear-axi ${entry.path.join(" ")}`)

export const runOfficialCommand = (
  parsed: ParsedArgs,
  gateway: LinearGateway
): Effect.Effect<OutputValue, CliError> | undefined => {
  const entry = commands.find((candidate) => candidate.path.join("\0") === parsed.command.join("\0"))
  if (!entry) {
    return undefined
  }
  const booleanConflict = Object.entries(entry.flags).find(([name, flag]) =>
    flag.kind === "boolean" && parsed.flags.has(name) && parsed.flags.has(`no-${name}`))
  if (booleanConflict) return usage(`--${booleanConflict[0]} and --no-${booleanConflict[0]} are mutually exclusive`, entry)
  const declaredConflict = Object.entries(entry.flags).flatMap(([name, flag]) =>
    flag.conflictsWith?.map((conflict) => [name, conflict] as const) ?? []).find(([name, conflict]) =>
      parsed.flags.has(name) && parsed.flags.has(conflict))
  if (declaredConflict) {
    const order = Object.keys(entry.flags)
    const [first, second] = declaredConflict
    const [left, right] = order.indexOf(first) <= order.indexOf(second)
      ? [first, second]
      : [second, first]
    return usage(`--${left} and --${right} are mutually exclusive`, entry)
  }
  const validation = entry.validate?.(parsed.flags)
  if (validation) return usage(validation, entry)
  const args: Record<string, unknown> = { ...entry.fixedArgs }
  for (const [name, flag] of Object.entries(entry.flags)) {
    if (name === "full") continue
    const value = parsed.flags.get(name)
    const negative = parsed.flags.get(`no-${name}`)
    if (value === undefined && negative === undefined) continue
    const arg = flag.arg ?? name
    if (flag.kind === "boolean") {
      args[arg] = value === true
    } else if (flag.kind === "null") {
      args[arg] = null
    } else if (flag.kind === "empty-string") {
      args[arg] = ""
    } else if (flag.kind === "number") {
      const number = Number(value)
      if (!Number.isFinite(number) || (flag.integer && !Number.isInteger(number)) || (flag.minimum !== undefined && number < flag.minimum) || (flag.maximum !== undefined && number > flag.maximum)) {
        const range = flag.minimum !== undefined || flag.maximum !== undefined
          ? ` from ${flag.minimum ?? "-infinity"} to ${flag.maximum ?? "infinity"}`
          : ""
        return usage(`--${name} must be ${flag.integer ? "an integer" : "a number"}${range}`, entry)
      }
      args[arg] = number
    } else if (flag.kind === "string-array") {
      try {
        const decoded = decodeStringArray(String(value))
        args[arg] = decoded
      } catch {
        return usage(`--${name} must be a JSON string array`, entry)
      }
    } else {
      if (flag.values && !flag.values.includes(String(value))) {
        return usage(`--${name} must be one of ${flag.values.join(", ")}`, entry)
      }
      if (flag.maxLength !== undefined && String(value).length > flag.maxLength) {
        return usage(`--${name} must be at most ${flag.maxLength} characters`, entry)
      }
      if (flag.format && !validFormat(String(value), flag.format)) {
        const expected = flag.format === "color" ? "a hex color such as #5E6AD2" : flag.format === "date" ? "a valid YYYY-MM-DD date" : "a canonical UTC timestamp"
        return usage(`--${name} must be ${expected}`, entry)
      }
      if (flag.internal !== true) args[arg] = value
    }
  }
  if (entry.tool.startsWith("save_")) return runVerifiedMutation(entry, args, parsed, gateway)
  return runOfficialRead(entry, args, parsed, gateway)
}

interface DetailIdentityRule {
  readonly noun: string
  readonly selectorArg: string
  readonly keys: ReadonlyArray<string>
}

const DETAIL_IDENTITY_RULES: Readonly<Record<string, DetailIdentityRule>> = {
  get_agent_skill: { noun: "agent skill", selectorArg: "id", keys: ["id"] },
  get_document: { noun: "document", selectorArg: "id", keys: ["id", "slugId"] },
  get_issue: { noun: "issue", selectorArg: "id", keys: ["id", "identifier"] },
  get_project: { noun: "project", selectorArg: "query", keys: ["id", "name", "slugId"] },
  get_release: { noun: "release", selectorArg: "id", keys: ["id", "slugId"] },
  get_release_note: { noun: "release note", selectorArg: "id", keys: ["id", "slugId"] },
  get_diff: {
    noun: "diff",
    selectorArg: "urlOrId",
    keys: ["id", "identifier", "slugId", "url", "reviewUrl", "pullRequestId", "pullRequestNumber", "pullRequestUrl", "githubUrl"]
  },
  get_milestone: { noun: "milestone", selectorArg: "query", keys: ["id", "name"] },
  get_team: { noun: "team", selectorArg: "query", keys: ["id", "key", "name"] },
  get_user: { noun: "user", selectorArg: "query", keys: ["id", "name", "email", "displayName"] }
}

const runOfficialRead = Effect.fn("runOfficialRead")(function*(
  entry: OfficialCommand,
  args: Readonly<Record<string, unknown>>,
  parsed: ParsedArgs,
  gateway: LinearGateway
) {
  let readArgs = args
  let milestoneProject: OfficialEntityIdentity | undefined
  if (entry.tool === "get_milestone") {
    const selector = args.project
    if (typeof selector !== "string") return yield* shapeDrift(entry, "expected a project selector")
    const project = yield* validateDetailIdentity(
      entry,
      DETAIL_IDENTITY_RULES.get_project!,
      yield* gateway.callOfficialTool("get_project", { query: selector }),
      selector,
      gateway
    )
    milestoneProject = officialEntityIdentity(project, ["name", "slugId"])
    if (!milestoneProject) return yield* shapeDrift(entry, "expected the project to have an immutable identity")
    readArgs = { ...args, project: milestoneProject.id }
  }

  const value = yield* gateway.callOfficialTool(entry.tool, readArgs)
  const rule = DETAIL_IDENTITY_RULES[entry.tool]
  if (entry.listKey === undefined && !rule) {
    return yield* shapeDrift(entry, "detail command has no identity validation contract")
  }
  if (rule) {
    const selector = args[rule.selectorArg]
    if (typeof selector !== "string") return yield* shapeDrift(entry, `expected ${rule.selectorArg} to be a selector`)
    const detail = yield* validateDetailIdentity(entry, rule, value, selector, gateway)
    if (entry.tool === "get_milestone") {
      const owner = officialOwnerReference(detail, "project")
      if (!milestoneProject || officialReferenceValues(owner).length === 0 || !officialReferenceMatchesIdentity(owner, milestoneProject)) {
        return yield* shapeDrift(entry, "returned milestone did not belong to the requested project")
      }
    }
  }
  return yield* renderResult(entry, value, parsed)
})

const validateDetailIdentity = Effect.fn("validateDetailIdentity")(function*(
  entry: OfficialCommand,
  rule: DetailIdentityRule,
  value: unknown,
  selector: string,
  gateway: LinearGateway
) {
  if (!Predicate.isObject(value) || !nonEmptyString(value.id)) {
    return yield* shapeDrift(entry, `expected ${rule.noun} detail with an immutable id`)
  }
  if (entry.tool === "get_user" && referenceTextEqual(selector, "me")) {
    const status = yield* gateway.authStatus()
    if (!status.authenticated || !status.viewer || !referenceTextEqual(status.viewer.id, value.id)) {
      return yield* shapeDrift(entry, "returned user did not match the authenticated viewer")
    }
    return value
  }
  const matches = rule.keys.some((key) => {
    const reference = value[key]
    return (typeof reference === "string" || typeof reference === "number") && referenceTextEqual(String(reference), selector)
  })
  return matches
    ? value
    : yield* shapeDrift(entry, `returned ${rule.noun} did not match the requested selector`)
})

const renderResult = (
  entry: OfficialCommand,
  value: unknown,
  parsed: ParsedArgs
): Effect.Effect<OutputValue, LinearDomainError> => {
  const full = parsed.flags.get("full") === true
  if (entry.listKey === "$") {
    if (!Array.isArray(value)) return shapeDrift(entry, "expected an array result")
    if (value.some((row) => !Predicate.isObject(row))) return shapeDrift(entry, "expected every row to be an object")
    const projection = full ? { items: value, truncatedBodies: false } : projectRows(value, entry.defaultFields ?? [])
    if (!full && projection.items.some((row) => Predicate.isObject(row) && Object.keys(row).length === 0)) {
      return shapeDrift(entry, "expected every row to contain at least one default field")
    }
    const documentationPage = entry.tool === "search_documentation"
      ? Number(parsed.flags.get("page") ?? 0)
      : undefined
    return Effect.succeed({
      count: `${projection.items.length} ${entry.outputKey} shown`,
      page: documentationPage === undefined ? { hasNext: false, endCursor: null } : { current: documentationPage },
      ...(projection.items.length === 0 ? { [entry.outputKey]: `0 ${entry.outputKey} matched this query` } : { [entry.outputKey]: projection.items }),
      help: [
        ...(projection.truncatedBodies ? [completeBodiesCommand(entry, parsed.flags)] : []),
        ...(documentationPage === undefined
          ? []
          : [`Run \`linear-axi ${entry.path.join(" ")} ${replayFlags(parsed.flags, { page: String(documentationPage + 1) })}\` for the next page.`])
      ]
    })
  }
  if (!Predicate.isObject(value)) return shapeDrift(entry, "expected an object result")
  const result = value
  if (entry.listKey) {
    const candidateRows = result[entry.listKey]
    if (!Array.isArray(candidateRows)) return shapeDrift(entry, `expected ${entry.listKey} to be an array`)
    if (typeof result.hasNextPage !== "boolean") {
      return shapeDrift(entry, "expected hasNextPage to be a boolean")
    }
    const rows: ReadonlyArray<unknown> = candidateRows
    if (rows.some((row) => !Predicate.isObject(row))) return shapeDrift(entry, `expected every ${entry.listKey} row to be an object`)
    if (entry.path.join(" ") === "status-updates view") {
      if (result.hasNextPage || rows.length > 1) return exactStatusUpdateError("returned multiple updates")
      if (rows.length === 0) return exactStatusUpdateError("returned no matching update")
      const row = rows[0]
      const id = parsed.flags.get("id")
      const type = parsed.flags.get("type")
      if (!Predicate.isObject(row) || typeof row.id !== "string" || typeof row.type !== "string" ||
        typeof id !== "string" || typeof type !== "string" ||
        !referenceTextEqual(row.id, id) || !referenceTextEqual(row.type, type)) {
        return exactStatusUpdateError("did not match --id and --type")
      }
      return Effect.succeed(detailOutput(entry, row, parsed, false))
    }
    if (result.hasNextPage === true && (typeof result.cursor !== "string" || result.cursor.trim().length === 0)) {
      return shapeDrift(entry, "expected a non-blank cursor when hasNextPage is true")
    }
    const currentCursor = parsed.flags.get("after")
    if (result.hasNextPage === true && typeof currentCursor === "string" && result.cursor === currentCursor) {
      return shapeDrift(entry, "expected the next cursor to advance beyond --after")
    }
    const projection = full ? { items: rows, truncatedBodies: false } : projectRows(rows, entry.defaultFields ?? [])
    if (!full && projection.items.some((row) => Predicate.isObject(row) && Object.keys(row).length === 0)) {
      return shapeDrift(entry, `expected every ${entry.listKey} row to contain at least one default field`)
    }
    const cursor = typeof result.cursor === "string" ? result.cursor : null
    const hasNext = result.hasNextPage === true
    return Effect.succeed({
      count: `${projection.items.length} ${entry.outputKey} shown`,
      page: { hasNext, endCursor: cursor },
      ...(projection.items.length === 0 ? { [entry.outputKey]: `0 ${entry.outputKey} matched this query` } : { [entry.outputKey]: projection.items }),
      help: [
        ...(projection.truncatedBodies ? [completeBodiesCommand(entry, parsed.flags)] : []),
        ...(hasNext && cursor ? [continuation(entry, parsed.flags, cursor)] : [])
      ]
    })
  }
  if (Object.keys(result).length === 0) return shapeDrift(entry, "expected a non-empty object result")
  const detail = result
  return Effect.succeed(detailOutput(entry, detail, parsed, false))
}

const runVerifiedMutation = (
  entry: OfficialCommand,
  args: Readonly<Record<string, unknown>>,
  parsed: ParsedArgs,
  gateway: LinearGateway
): Effect.Effect<OutputValue, CliError> => Effect.gen(function*() {
  const desiredKeys = Object.keys(args).filter((key) => !mutationIdentityKeys(entry.tool).includes(key))
  if (desiredKeys.length === 0) return yield* usage("at least one property to update is required", entry)
  const richTextReplacement = mutationRichTextKeys(entry.tool).some((key) => key in args)
  const expectedUpdatedAt = parsed.flags.get("if-updated-at")
  const preconditioned = typeof expectedUpdatedAt === "string"
  if (richTextReplacement && !preconditioned) {
    return yield* usage("rich-text replacements and clears require --if-updated-at with the exact canonical timestamp emitted by the CLI", entry)
  }
  const mutationTarget = isMutableSelectorMutation(entry.tool)
    ? yield* resolveMutationTarget(gateway, entry.tool, args.id)
    : undefined
  const canonicalArgs = yield* canonicalizeMutationArgs(entry.tool, args, gateway, mutationTarget)
  const inspection = officialMutationInspectionCommand(entry.tool, canonicalArgs)
  const beforeArgs = mutationReadArgs(entry.tool, canonicalArgs)
  const before = mutationTarget && Object.keys(beforeArgs).length === 1 && beforeArgs.id === mutationTarget.id
    ? mutationTarget
    : (yield* extractMutationObject(
        entry.tool,
        yield* gateway.callOfficialTool(mutationReadTool(entry.tool), beforeArgs),
        canonicalArgs
      ))
  if (preconditioned) {
    if (typeof before.updatedAt !== "string" || !isCanonicalTimestamp(before.updatedAt)) {
      return yield* mutationShapeDrift(entry.tool)
    }
    if (before.updatedAt !== expectedUpdatedAt) {
      return yield* Effect.fail(new LinearDomainError({
        message: `${entry.outputKey} changed since ${expectedUpdatedAt}; refusing a known-stale update`,
        help: `Run \`${inspection}\`, merge the latest state, then retry with its updatedAt.`
      }))
    }
  }
  if (mutationSatisfied(before, canonicalArgs, entry.tool)) {
    return detailOutput(
      entry,
      before,
      parsed,
      false,
      "requested properties already match (no-op)",
      inspection
    )
  }
  yield* gateway.callOfficialTool(entry.tool, canonicalArgs)
  return yield* Effect.gen(function*() {
    const afterRaw = yield* gateway.callOfficialTool(mutationReadTool(entry.tool), mutationReadArgs(entry.tool, canonicalArgs))
    const after = yield* extractMutationObject(entry.tool, afterRaw, canonicalArgs)
    if (!mutationSatisfied(after, canonicalArgs, entry.tool)) {
      return yield* Effect.fail(new LinearDomainError({ message: `${entry.tool} update could not be verified` }))
    }
    const output = detailOutput(
      entry,
      after,
      parsed,
      true,
      `official ${entry.tool} update verified`,
      inspection
    )
    return preconditioned ? { ...output, concurrency: DESCRIPTION_CONCURRENCY_WARNING } : output
  }).pipe(
    Effect.mapError(() => indeterminateOfficialMutation(entry.tool, canonicalArgs))
  )
})

const canonicalizeMutationArgs = Effect.fn("canonicalizeMutationArgs")(function*(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  gateway: LinearGateway,
  mutationTarget?: Record<string, unknown>
) {
  const canonical: Record<string, unknown> = { ...args }
  if (tool === "save_document") {
    const document = mutationTarget ?? (yield* mutationShapeDrift(tool))
    canonical.id = document.id
    if (typeof args.project === "string") {
      canonical.project = (yield* resolveGetAssociation(gateway, "project", args.project, "get_project", { query: args.project }, ["id", "name", "slugId"])).id
    }
    if (typeof args.issue === "string") {
      canonical.issue = (yield* resolveGetAssociation(gateway, "issue", args.issue, "get_issue", { id: args.issue }, ["id", "identifier"])).id
    }
    if (typeof args.initiative === "string") canonical.initiative = yield* resolveInitiativeAssociation(gateway, args.initiative)

    let team: Record<string, unknown> | undefined
    if (typeof args.team === "string") {
      team = yield* resolveGetAssociation(gateway, "team", args.team, "get_team", { query: args.team }, ["id", "key", "name"])
      canonical.team = team.id
    }
    if (typeof args.cycle === "string") {
      if (!team) {
        const cycleOwner = Predicate.isObject(document.cycle) ? officialOwnerReference(document.cycle, "team") : undefined
        const currentTeam = officialReferenceSelector(document.team) ?? officialReferenceSelector(cycleOwner)
        if (!currentTeam) {
          return yield* Effect.fail(new LinearDomainError({
            message: `cycle selector ${args.cycle} requires a team whose identity can be verified`,
            help: "Pass --team with the cycle's team name, key, or ID."
          }))
        }
        team = yield* resolveGetAssociation(gateway, "team", currentTeam, "get_team", { query: currentTeam }, ["id", "key", "name"])
        canonical.team = team.id
      }
      const cycles = yield* gateway.callOfficialTool("list_cycles", { teamId: team.id })
      if (!Array.isArray(cycles) || cycles.some((cycle) => !Predicate.isObject(cycle))) return yield* mutationShapeDrift(tool)
      const teamIdentity = officialEntityIdentity(team, ["key", "name"])
      if (!teamIdentity) return yield* mutationShapeDrift(tool)
      const cycle = yield* resolveExactOfficialEntity("cycle", args.cycle, cycles as ReadonlyArray<Record<string, unknown>>, ["id", "name", "number"])
      yield* requireOfficialEntityActive("cycle", args.cycle, cycle, tool)
      yield* requireAssociationOwnership("cycle", args.cycle, cycle, "team", teamIdentity, tool)
      canonical.cycle = cycle.id
    }
    return canonical
  }

  if (tool === "save_project") {
    const project = yield* gateway.callOfficialTool("get_project", { query: args.id })
    if (!Predicate.isObject(project) || !nonEmptyString(project.id) || !mutationEntityMatches(project, args.id, tool)) {
      return yield* mutationShapeDrift(tool)
    }
    canonical.id = project.id
    if (typeof args.lead === "string") {
      const user = args.lead === "me"
        ? yield* resolveOfficialViewerUser(gateway)
        : yield* gateway.callOfficialTool("get_user", { query: args.lead })
      if (!Predicate.isObject(user) || !nonEmptyString(user.id) || (args.lead !== "me" && !userEntityMatches(user, args.lead))) {
        return yield* mutationShapeDrift(tool)
      }
      yield* requireOfficialUserActive(args.lead, user, "get_user")
      canonical.lead = user.id
    }
    if (Array.isArray(args.labels)) {
      if (args.labels.length === 0) {
        canonical.labels = []
      } else {
        const labels = yield* fetchOfficialRows(gateway, "list_project_labels", { limit: 250 }, "labels")
        canonical.labels = uniqueStrings(yield* Effect.forEach(args.labels, (selector) =>
          resolveExactOfficialId("project label", String(selector), labels, ["id", "name"])))
      }
    }

    const activeTeamKeys = ["setTeams", "addTeams"] as const
    const activeInitiativeKeys = ["setInitiatives", "addInitiatives"] as const
    const activeTeamSelectors = activeTeamKeys.flatMap((key) => Array.isArray(args[key]) ? args[key].map(String) : [])
    const activeInitiativeSelectors = activeInitiativeKeys.flatMap((key) => Array.isArray(args[key]) ? args[key].map(String) : [])
    if (activeTeamSelectors.length > 0 || activeInitiativeSelectors.length > 0) {
      const resolved = yield* gateway.resolveProjectUpdateAssociations({
        teams: activeTeamSelectors,
        initiatives: activeInitiativeSelectors,
        includeArchived: false
      })
      let teamOffset = 0
      for (const key of activeTeamKeys) {
        if (!Array.isArray(args[key])) continue
        canonical[key] = uniqueStrings(resolved.teams.slice(teamOffset, teamOffset + args[key].length))
        teamOffset += args[key].length
      }
      let initiativeOffset = 0
      for (const key of activeInitiativeKeys) {
        if (!Array.isArray(args[key])) continue
        canonical[key] = uniqueStrings(resolved.initiatives.slice(initiativeOffset, initiativeOffset + args[key].length))
        initiativeOffset += args[key].length
      }
    }

    const removeTeams = Array.isArray(args.removeTeams) ? args.removeTeams.map(String) : []
    const removeInitiatives = Array.isArray(args.removeInitiatives) ? args.removeInitiatives.map(String) : []
    if (removeTeams.length > 0 || removeInitiatives.length > 0) {
      const resolved = yield* gateway.resolveProjectUpdateAssociations({
        teams: removeTeams,
        initiatives: removeInitiatives,
        includeArchived: true
      })
      if (Array.isArray(args.removeTeams)) canonical.removeTeams = uniqueStrings(resolved.teams)
      if (Array.isArray(args.removeInitiatives)) canonical.removeInitiatives = uniqueStrings(resolved.initiatives)
    }

    for (const [addKey, removeKey, noun] of [
      ["addTeams", "removeTeams", "team"],
      ["addInitiatives", "removeInitiatives", "initiative"]
    ] as const) {
      const conflict = findCanonicalIntersection(canonical[addKey], canonical[removeKey])
      if (conflict) {
        return yield* Effect.fail(new LinearDomainError({
          message: `${noun} ${conflict} cannot be both add and remove in one project update`,
          help: "Choose one final state for each association."
        }))
      }
    }
    return canonical
  }

  if (tool === "save_release") {
    const release = mutationTarget ?? (yield* mutationShapeDrift(tool))
    canonical.id = release.id
    if (typeof args.pipeline === "string" || typeof args.stage === "string") {
      let pipelineSelector = typeof args.pipeline === "string" ? args.pipeline : undefined
      if (!pipelineSelector) {
        pipelineSelector = officialReferenceSelector(release.pipeline)
        if (!pipelineSelector) return yield* mutationShapeDrift(tool)
      }
      const pipeline = yield* resolveReleasePipeline(gateway, pipelineSelector, typeof args.stage === "string")
      if (typeof args.pipeline === "string") canonical.pipeline = pipeline.id
      if (typeof args.stage === "string") {
        if (!Array.isArray(pipeline.stages) || pipeline.stages.some((stage) => !Predicate.isObject(stage))) return yield* mutationShapeDrift(tool)
        canonical.stage = yield* resolveExactOfficialId("release stage", args.stage, pipeline.stages as ReadonlyArray<Record<string, unknown>>, ["id", "name", "type"])
      }
    }
    return canonical
  }

  if (tool === "save_release_note") {
    const releaseNote = mutationTarget ?? (yield* mutationShapeDrift(tool))
    canonical.id = releaseNote.id
    const releaseSelectors = Array.isArray(args.releases) ? args.releases.map(String) : []
    const rangeSelectors = [args.rangeFromRelease, args.rangeToRelease].filter((value): value is string => typeof value === "string")
    if (typeof args.pipeline === "string" || releaseSelectors.length > 0 || rangeSelectors.length > 0) {
      let pipelineSelector = typeof args.pipeline === "string" ? args.pipeline : undefined
      if (!pipelineSelector) {
        pipelineSelector = officialReferenceSelector(releaseNote.pipeline)
        if (!pipelineSelector) return yield* mutationShapeDrift(tool)
      }
      const pipeline = yield* resolveReleasePipeline(gateway, pipelineSelector, false)
      if (typeof args.pipeline === "string") canonical.pipeline = pipeline.id
      if (releaseSelectors.length > 0 || rangeSelectors.length > 0) {
        const pipelineIdentity = officialEntityIdentity(pipeline, ["name", "slugId"])
        if (!pipelineIdentity) return yield* mutationShapeDrift(tool)
        const resolvedReleases = new Map<string, string>()
        const resolveRelease = Effect.fn("resolveReleaseNoteRelease")(function*(selector: string) {
          const cacheKey = selector.toLowerCase()
          const cached = resolvedReleases.get(cacheKey)
          if (cached) return cached
          const releases = isUuid(selector)
            ? [yield* gateway.callOfficialTool("get_release", { id: selector })].filter(Predicate.isObject)
            : yield* fetchOfficialRows(gateway, "list_releases", {
                query: selector,
                limit: 250,
                pipeline: pipeline.id,
                includeArchived: true
              }, "releases", (rows) => rows.some((row) => nonEmptyString(row.id) && referenceTextEqual(row.id, selector)))
          const release = yield* resolveExactOfficialEntity("release", selector, releases, ["id", "slugId"])
          yield* requireAssociationOwnership("release", selector, release, "pipeline", pipelineIdentity, tool)
          const releaseId = release.id as string
          resolvedReleases.set(cacheKey, releaseId)
          return releaseId
        })
        if (Array.isArray(args.releases)) {
          canonical.releases = uniqueStrings(yield* Effect.forEach(releaseSelectors, resolveRelease))
        }
        if (typeof args.rangeFromRelease === "string") canonical.rangeFromRelease = yield* resolveRelease(args.rangeFromRelease)
        if (typeof args.rangeToRelease === "string") canonical.rangeToRelease = yield* resolveRelease(args.rangeToRelease)
      }
    }
    return canonical
  }

  if (tool === "save_status_update") {
    if (typeof args.project === "string") {
      canonical.project = (yield* resolveGetAssociation(gateway, "project", args.project, "get_project", { query: args.project }, ["id", "name", "slugId"])).id
    }
    if (typeof args.initiative === "string") canonical.initiative = yield* resolveInitiativeAssociation(gateway, args.initiative)
    return canonical
  }

  if (tool === "save_milestone" && typeof args.project === "string" && typeof args.id === "string") {
    const project = yield* gateway.callOfficialTool("get_project", { query: args.project })
    if (!Predicate.isObject(project) || !nonEmptyString(project.id) || !mutationEntityMatches(project, args.project, "save_project")) {
      return yield* mutationShapeDrift(tool)
    }
    yield* requireOfficialEntityActive("project", args.project, project, "get_project")
    const projectIdentity = officialEntityIdentity(project, ["name", "slugId"])
    if (!projectIdentity) return yield* mutationShapeDrift(tool)
    const milestone = yield* gateway.callOfficialTool("get_milestone", { project: project.id, query: args.id })
    if (!Predicate.isObject(milestone) || !nonEmptyString(milestone.id) || !mutationEntityMatches(milestone, args.id, "save_milestone")) {
      return yield* mutationShapeDrift(tool)
    }
    yield* requireOfficialEntityActive("milestone", args.id, milestone, "get_milestone")
    const milestoneProject = officialOwnerReference(milestone, "project")
    if (officialReferenceValues(milestoneProject).length === 0) return yield* mutationShapeDrift(tool)
    if (!officialReferenceMatchesIdentity(milestoneProject, projectIdentity)) {
      return yield* Effect.fail(new LinearDomainError({
        message: `milestone ${args.id} belongs to another project`,
        help: "Choose a milestone from the requested project."
      }))
    }
    return { ...args, project: project.id, id: milestone.id }
  }
  return canonical
})

const isMutableSelectorMutation = (
  tool: string
): tool is "save_document" | "save_release" | "save_release_note" =>
  tool === "save_document" || tool === "save_release" || tool === "save_release_note"

const resolveMutationTarget = Effect.fn("resolveMutationTarget")(function*(
  gateway: LinearGateway,
  tool: "save_document" | "save_release" | "save_release_note",
  selector: unknown
) {
  if (typeof selector !== "string") return yield* mutationShapeDrift(tool)
  const result = yield* gateway.callOfficialTool(mutationReadTool(tool), { id: selector })
  if (!Predicate.isObject(result) || !nonEmptyString(result.id) || !mutationEntityMatches(result, selector, tool)) {
    return yield* mutationShapeDrift(tool)
  }
  return result
})

const resolveGetAssociation = Effect.fn("resolveGetAssociation")(function*(
  gateway: LinearGateway,
  noun: string,
  selector: string,
  tool: string,
  args: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>
) {
  const result = yield* gateway.callOfficialTool(tool, args)
  if (!Predicate.isObject(result)) return yield* mutationShapeDrift(tool)
  const entity = yield* resolveExactOfficialEntity(noun, selector, [result], keys)
  yield* requireOfficialEntityActive(noun, selector, entity, tool)
  return entity
})

const resolveInitiativeAssociation = Effect.fn("resolveInitiativeAssociation")(function*(
  gateway: LinearGateway,
  selector: string
) {
  const resolved = yield* gateway.resolveProjectUpdateAssociations({
    teams: [],
    initiatives: [selector],
    includeArchived: false
  })
  if (resolved.initiatives.length !== 1 || !nonEmptyString(resolved.initiatives[0])) return yield* mutationShapeDrift("initiative")
  return resolved.initiatives[0]
})

const requireAssociationOwnership = (
  noun: string,
  selector: string,
  entity: Readonly<Record<string, unknown>>,
  owner: "project" | "team" | "pipeline",
  ownerIdentity: OfficialEntityIdentity,
  tool: string
): Effect.Effect<void, LinearDomainError> => {
  const reference = owner === "pipeline"
    ? ("pipelineId" in entity ? entity.pipelineId : entity.pipeline)
    : officialOwnerReference(entity, owner)
  if (officialReferenceValues(reference).length === 0) return mutationShapeDrift(tool)
  return officialReferenceMatchesIdentity(reference, ownerIdentity)
    ? Effect.void
    : Effect.fail(new LinearDomainError({
        message: `${noun} ${selector} belongs to another ${owner}`,
        help: `Choose a ${noun} from the resolved ${owner}.`
      }))
}

const resolveReleasePipeline = Effect.fn("resolveReleasePipeline")(function*(
  gateway: LinearGateway,
  selector: string,
  includeStages: boolean
) {
  const rows = yield* fetchOfficialRows(gateway, "list_release_pipelines", {
    limit: 250,
    includeArchived: false,
    ...(includeStages ? { includeStages: true } : {})
  }, "releasePipelines")
  const pipeline = yield* resolveExactOfficialEntity("release pipeline", selector, rows, ["id", "name", "slugId"])
  yield* requireOfficialEntityActive("release pipeline", selector, pipeline, "list_release_pipelines")
  return pipeline
})

const mutationReadTool = (tool: string): string => ({
  save_document: "get_document",
  save_project: "get_project",
  save_release: "get_release",
  save_release_note: "get_release_note",
  save_milestone: "get_milestone",
  save_status_update: "get_status_updates"
} as Record<string, string>)[tool]!

const mutationReadArgs = (tool: string, args: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
  if (tool === "save_project") return { query: args.id }
  if (tool === "save_milestone") return { project: args.project, query: args.id }
  if (tool === "save_status_update") return { type: args.type, id: args.id }
  if (tool === "save_release_note") return { id: args.id, ...(officialReleaseNoteNeedsReleases(args) ? { includeReleases: true } : {}) }
  return { id: args.id }
}

const mutationIdentityKeys = (tool: string): ReadonlyArray<string> =>
  tool === "save_milestone" ? ["id", "project"] : tool === "save_status_update" ? ["id", "type"] : ["id"]

function mutationRichTextKeys(tool: string): ReadonlyArray<string> {
  return ({
    save_document: ["content"],
    save_project: ["description"],
    save_release: ["description"],
    save_release_note: ["content"],
    save_milestone: ["description"],
    save_status_update: ["body"]
  } as Record<string, ReadonlyArray<string>>)[tool] ?? []
}

const extractMutationObject = (
  tool: string,
  value: unknown,
  args: Readonly<Record<string, unknown>>
): Effect.Effect<Record<string, unknown>, LinearDomainError> => {
  if (tool === "save_status_update") {
    if (!Predicate.isObject(value) || value.hasNextPage !== false || !Array.isArray(value.statusUpdates) || value.statusUpdates.length !== 1) {
      return mutationShapeDrift(tool)
    }
    const statusUpdate = value.statusUpdates[0]
    if (!Predicate.isObject(statusUpdate) || !mutationEntityMatches(statusUpdate, args.id, tool) || !literalEqual(statusUpdate.type, args.type)) {
      return mutationShapeDrift(tool)
    }
    return Effect.succeed(statusUpdate)
  }
  return Predicate.isObject(value) && Object.keys(value).length > 0 && mutationEntityMatches(value, args.id, tool)
    ? Effect.succeed(value)
    : mutationShapeDrift(tool)
}

const mutationShapeDrift = (tool: string): Effect.Effect<never, LinearDomainError> => Effect.fail(new LinearDomainError({
  message: `Official Linear MCP output shape drifted while verifying ${tool}`,
  help: "Refresh the frozen parity inventory and update linear-axi before retrying."
}))

const mutationSatisfied = (
  current: Readonly<Record<string, unknown>>,
  args: Readonly<Record<string, unknown>>,
  tool: string
): boolean => Object.entries(args).every(([key, desired]) => {
  if (mutationIdentityKeys(tool).includes(key) || mutationTransportKeys(tool, args).includes(key)) return true
  if (desired === null && !(key in current)) return false
  if (key.startsWith("add") && key.length > 3) return mutationCollectionContains(current[lowerFirst(key.slice(3))], desired)
  if (key.startsWith("remove") && key.length > 6) return mutationCollectionAbsent(current[lowerFirst(key.slice(6))], desired)
  if (key.startsWith("set") && key.length > 3) return mutationCollectionEqual(current[lowerFirst(key.slice(3))], desired)
  if (Array.isArray(desired)) return mutationCollectionEqual(current[key], desired)
  if (["body", "content", "description"].includes(key) && typeof current[key] === "string" && typeof desired === "string") {
    return richTextEqual(current[key], desired)
  }
  return mutationReferenceKeys(tool).includes(key)
    ? mutationReferenceEqual(tool, key, current[key], desired)
    : literalEqual(current[key], desired)
})

const mutationTransportKeys = (
  tool: string,
  args: Readonly<Record<string, unknown>>
): ReadonlyArray<string> => tool === "save_document" && typeof args.cycle === "string" ? ["team"] : []

const mutationReferenceKeys = (tool: string): ReadonlyArray<string> => ({
  save_document: ["project", "issue", "initiative", "cycle", "team"],
  save_project: ["state", "lead"],
  save_release: ["pipeline", "stage"],
  save_release_note: ["pipeline", "rangeFromRelease", "rangeToRelease"],
  save_milestone: [],
  save_status_update: ["project", "initiative"]
} as Record<string, ReadonlyArray<string>>)[tool] ?? []

const MUTATION_REFERENCE_KEYS = ["id", "identifier", "name", "key", "email", "displayName", "slugId", "version", "number", "type"] as const
const MUTATION_COLLECTION_OPTIONS = {
  referenceKeys: MUTATION_REFERENCE_KEYS,
  canonicalIdentityKey: "id"
} as const
const MUTATION_ALIAS_REFERENCE_OPTIONS = { referenceKeys: MUTATION_REFERENCE_KEYS } as const
const mutationCollectionEqual = (current: unknown, desired: unknown): boolean => collectionEqual(current, desired, MUTATION_COLLECTION_OPTIONS)
const mutationCollectionContains = (current: unknown, desired: unknown): boolean => collectionContains(current, desired, MUTATION_COLLECTION_OPTIONS)
const mutationCollectionAbsent = (current: unknown, desired: unknown): boolean => collectionAbsent(current, desired, MUTATION_COLLECTION_OPTIONS)
const mutationReferenceEqual = (tool: string, key: string, current: unknown, desired: unknown): boolean => {
  if (desired === null) return current == null
  const options = tool === "save_project" && key === "state"
    ? MUTATION_ALIAS_REFERENCE_OPTIONS
    : MUTATION_COLLECTION_OPTIONS
  return officialReferenceEqual(current, desired, options)
}
const literalEqual = (current: unknown, desired: unknown): boolean =>
  desired === null ? current == null : current === desired
const mutationEntityMatches = (
  entity: Readonly<Record<string, unknown>>,
  selector: unknown,
  tool: string
): boolean => {
  if (typeof selector !== "string") return false
  const references = tool === "save_project"
    ? [entity.id, entity.name, entity.slugId]
    : tool === "save_milestone"
      ? [entity.id, entity.name]
      : [entity.id, entity.slugId]
  return references.some((reference) => typeof reference === "string" && referenceTextEqual(reference, selector))
}
const userEntityMatches = (entity: Readonly<Record<string, unknown>>, selector: string): boolean =>
  [entity.id, entity.name, entity.email, entity.displayName]
    .some((reference) => typeof reference === "string" && referenceTextEqual(reference, selector))
const referenceTextEqual = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase()
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)
const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)]
const lowerFirst = (value: string): string => `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`

const detailOutput = (
  entry: OfficialCommand,
  detail: unknown,
  parsed: ParsedArgs,
  changed: boolean,
  result?: string,
  fullCommand?: string
): OutputValue => {
  const full = parsed.flags.get("full") === true
  const truncated = full ? { value: detail, fields: [] } : truncateDetail(detail)
  return {
    [entry.outputKey]: truncated.value,
    ...(result === undefined ? {} : { changed, result }),
    ...(truncated.fields.length === 0 ? {} : {
      truncated: truncated.fields,
      help: [`Run \`${fullCommand ?? `linear-axi ${entry.path.join(" ")} ${replayFlags(parsed.flags, { full: true })}`}\` for complete text fields.`]
    })
  }
}

const replayFlags = (
  flags: ReadonlyMap<string, string | boolean>,
  additions: Readonly<Record<string, string | boolean>> = {}
): string => {
  const replayed = new Map(flags)
  replayed.delete("help")
  for (const [key, value] of Object.entries(additions)) replayed.set(key, value)
  return [...replayed.entries()].map(([name, value]) => value === true ? `--${name}` : `--${name} ${shellQuote(String(value))}`).join(" ")
}

const shapeDrift = (entry: OfficialCommand, detail: string): Effect.Effect<never, LinearDomainError> =>
  Effect.fail(new LinearDomainError({
    message: `Official Linear MCP output shape drifted for ${entry.tool}: ${detail}`,
    help: "Refresh the frozen parity inventory and update linear-axi before retrying."
  }))

const exactStatusUpdateError = (detail: string): Effect.Effect<never, LinearDomainError> =>
  Effect.fail(new LinearDomainError({
    message: `status-updates view ${detail}`,
    help: "Run `linear-axi status-updates list --type <project|initiative>` to inspect available updates."
  }))

const projectRows = (
  values: ReadonlyArray<unknown>,
  fields: ReadonlyArray<string>
): { readonly items: ReadonlyArray<Record<string, unknown>>; readonly truncatedBodies: boolean } => {
  let truncatedBodies = false
  const items = values.map((value) => {
    if (!Predicate.isObject(value)) return {}
    const selected = fields.filter((field) => value[field] !== undefined).slice(0, 4)
    return Object.fromEntries(selected.map((field) => {
      if (field !== "body" || typeof value[field] !== "string") return [field, value[field]]
      const body = truncateText(value[field], 500, false)
      truncatedBodies ||= body.truncated
      return [field, body.truncated ? `${body.text} (truncated, ${body.total} chars total)` : body.text]
    }))
  })
  return { items, truncatedBodies }
}

const completeBodiesCommand = (
  entry: OfficialCommand,
  flags: ReadonlyMap<string, string | boolean>
): string => {
  const replayed = replayFlags(flags, { full: true })
  return `Run \`linear-axi ${entry.path.join(" ")}${replayed.length > 0 ? ` ${replayed}` : ""}\` for complete bodies.`
}

const continuation = (entry: OfficialCommand, flags: ReadonlyMap<string, string | boolean>, cursor: string): string => {
  const replayed = new Map(flags)
  replayed.delete("help")
  replayed.set("after", cursor)
  const rendered = [...replayed.entries()].map(([name, value]) => value === true ? `--${name}` : `--${name} ${shellQuote(String(value))}`)
  return `Run \`linear-axi ${entry.path.join(" ")} ${rendered.join(" ")}\` for the next page.`
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`

const usage = (message: string, entry: OfficialCommand): Effect.Effect<never, UsageError> =>
  Effect.fail(new UsageError({ message, help: officialCommandSpecs.find((spec) => spec.path.join("\0") === entry.path.join("\0"))?.help ?? "" }))

function command(
  path: string,
  tool: string,
  flags: Readonly<Record<string, OfficialFlag>>,
  outputKey: string,
  listKey: string | undefined,
  defaultFields: ReadonlyArray<string> | undefined,
  examples: ReadonlyArray<string>,
  fixedArgs?: Readonly<Record<string, unknown>>,
  validate?: (flags: ReadonlyMap<string, string | boolean>) => string | undefined
): OfficialCommand {
  return { path: path.split(" "), tool, flags, outputKey, listKey, defaultFields, examples, fixedArgs, validate }
}

function stringFlag(arg?: string, values?: ReadonlyArray<string>, conflictsWith?: ReadonlyArray<string>): OfficialFlag {
  return { kind: "string", arg, values, conflictsWith }
}
function formattedStringFlag(format: "color" | "date" | "timestamp", arg?: string): OfficialFlag {
  return { kind: "string", arg, format }
}
function limitedStringFlag(maxLength: number, arg?: string): OfficialFlag {
  return { kind: "string", arg, maxLength }
}
function requiredString(arg?: string): OfficialFlag {
  return { kind: "string", arg, required: true }
}
function requiredStringEnum(values: ReadonlyArray<string>, arg?: string): OfficialFlag {
  return { kind: "string", arg, required: true, values }
}
function constrainedNumber(
  options: Pick<OfficialFlag, "integer" | "minimum" | "maximum" | "defaultValue">,
  arg?: string
): OfficialFlag {
  return { kind: "number", arg, ...options }
}
function bool(arg?: string, defaultValue?: boolean): OfficialFlag {
  return { kind: "boolean", arg, defaultValue }
}
function fullFlag(): OfficialFlag {
  return { kind: "boolean", defaultValue: false, description: FULL_FLAG_DESCRIPTION }
}
function nullFlag(arg: string, conflictsWith: ReadonlyArray<string>): OfficialFlag {
  return { kind: "null", arg, conflictsWith }
}
function emptyStringFlag(arg: string, conflictsWith: ReadonlyArray<string>): OfficialFlag {
  return { kind: "empty-string", arg, conflictsWith }
}
function preconditionFlag(): OfficialFlag {
  return {
    kind: "string",
    format: "timestamp",
    internal: true,
    description: "Require the exact updatedAt from the latest full view before replacing rich text."
  }
}
function arrayFlag(arg?: string, conflictsWith?: ReadonlyArray<string>): OfficialFlag {
  return { kind: "string-array", arg, conflictsWith }
}

function renderOfficialFlag(name: string, flag: OfficialFlag): string {
  const aliases = flag.kind === "boolean" && name !== "full"
    ? `--${name} | --no-${name}`
    : `--${name}`
  const value = ["boolean", "null", "empty-string"].includes(flag.kind) ? "" : ` ${officialFlagValue(name, flag)}`
  const details = [
    flag.required ? "required" : undefined,
    flag.defaultValue !== undefined ? `default: ${String(flag.defaultValue)}` : undefined,
    flag.repeatable ? "repeatable" : undefined,
    flag.conflictsWith && flag.conflictsWith.length > 0
      ? `conflicts: ${flag.conflictsWith.map((conflict) => `--${conflict}`).join(", ")}`
      : undefined
  ].filter((detail): detail is string => detail !== undefined)
  const qualifiers = details.length > 0 ? ` (${details.join("; ")})` : ""
  return `  ${aliases}${value}${qualifiers} - ${flag.description ?? officialFlagDescription(name, flag)}`
}

function officialFlagValue(name: string, flag: OfficialFlag): string {
  if (flag.values && flag.values.length > 0) return `<${flag.values.join("|")}>`
  if (flag.format === "color") return "<#RRGGBB>"
  if (flag.format === "date") return "<YYYY-MM-DD>"
  if (flag.format === "timestamp") return "<YYYY-MM-DDTHH:mm:ss.sssZ>"
  if (flag.kind === "string-array") return "<JSON-string-array>"
  if (flag.kind === "number") {
    const type = flag.integer ? "integer" : "number"
    if (flag.minimum !== undefined && flag.maximum !== undefined) return `<${type}:${flag.minimum}..${flag.maximum}>`
    if (flag.minimum !== undefined) return `<${type}:>=${flag.minimum}>`
    if (flag.maximum !== undefined) return `<${type}:<=${flag.maximum}>`
    return `<${type}>`
  }
  if (flag.maxLength !== undefined) return `<text:max-${flag.maxLength}>`
  if (name === "query") return "<query>"
  if (name === "after") return "<cursor>"
  if (name === "created-at" || name === "updated-at") return "<ISO-8601>"
  if (name === "commit-sha") return "<SHA>"
  if (name === "id" || name.endsWith("-id") || name === "thread-id") return "<id>"
  if (["team", "project", "initiative", "issue", "cycle", "state", "label", "assignee", "delegate", "release", "pipeline", "stage", "lead", "member", "user", "owner", "parent-id", "range-from", "range-to"].includes(name)) return "<selector>"
  return "<text>"
}

function officialFlagDescription(name: string, flag: OfficialFlag): string {
  const field = humanizeOfficialFlag(flag.arg ?? name)
  if (flag.kind === "boolean") {
    if (name.startsWith("include-")) return `Include ${humanizeOfficialFlag(name.slice("include-".length))}.`
    if (name.startsWith("has-")) return `Filter by whether results have ${humanizeOfficialFlag(name.slice("has-".length))}.`
    if (["content", "customer-needs", "members", "milestones", "relations", "release-notes", "releases", "resources", "stages", "teams"].includes(name)) {
      return `Include ${humanizeOfficialFlag(name)}.`
    }
    return `Filter by ${field}.`
  }
  const explicit = OFFICIAL_FLAG_DESCRIPTIONS[name]
  if (explicit) return explicit
  if (flag.kind === "null") return `Clear ${field} to null.`
  if (flag.kind === "empty-string") return `Clear ${field} to an empty string.`
  if (flag.kind === "string-array") {
    const noun = humanizeOfficialFlag(name.replace(/^(add|remove)-/, "").replace(/-json$/, ""))
    if (name.startsWith("add-")) return `Add the listed ${noun}.`
    if (name.startsWith("remove-")) return `Remove the listed ${noun}.`
    return `Replace the complete ${noun} set.`
  }
  return `Set or filter by ${field}.`
}

function humanizeOfficialFlag(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("-", " ")
    .replace(/json$/i, "")
    .trim()
    .toLowerCase()
}
function selected(flags: ReadonlyMap<string, string | boolean>, names: ReadonlyArray<string>): ReadonlyArray<string> {
  return names.filter((name) => flags.has(name))
}

function atMostOne(names: ReadonlyArray<string>): (flags: ReadonlyMap<string, string | boolean>) => string | undefined {
  return (flags) => selected(flags, names).length > 1 ? `at most one of ${names.map((name) => `--${name}`).join(", ")} may be used` : undefined
}

function documentUpdateValidation(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  if (flags.has("cycle")) return atMostOne(["project", "issue", "initiative", "cycle"])(flags)
  return atMostOne(["project", "issue", "initiative", "team"])(flags)
}

function commentSearchValidation(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  const parents = ["issue-id", "project-id", "initiative-id", "document-id", "milestone-id", "status-update-id"]
  if (selected(flags, parents).length === 0) return `exactly one of ${parents.map((name) => `--${name}`).join(", ")} is required`
  const parentError = atMostOne(parents)(flags)
  if (parentError) return parentError
  if (flags.has("status-update-type") && !flags.has("status-update-id")) return "--status-update-type requires --status-update-id"
  return undefined
}

function maxLimit(maximum: number): (flags: ReadonlyMap<string, string | boolean>) => string | undefined {
  return (flags) => {
    const limit = flags.get("limit")
    return typeof limit === "string" && Number(limit) > maximum ? `--limit must be at most ${maximum}` : undefined
  }
}

function releaseRangeValidation(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  return flags.has("range-from") !== flags.has("range-to")
    ? "--range-from and --range-to must be provided together"
    : undefined
}

function statusUpdateValidation(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  if (flags.has("project") && flags.get("type") !== "project") return "--project requires --type project"
  if (flags.has("initiative") && flags.get("type") !== "initiative") return "--initiative requires --type initiative"
  return atMostOne(["project", "initiative"])(flags)
}

function validFormat(value: string, format: "color" | "date" | "timestamp"): boolean {
  if (format === "color") return /^#[0-9a-f]{6}$/i.test(value)
  return format === "date" ? isCanonicalDate(value) : isCanonicalTimestamp(value)
}
