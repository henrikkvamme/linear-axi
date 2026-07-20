import { Effect, Predicate, Schema } from "effect"
import type { CommandSpec, ParsedArgs } from "./args"
import { LinearDomainError, UsageError, type CliError } from "./errors"
import type { LinearGateway } from "./linear"
import { truncateText, type OutputValue } from "./output"
import { richTextEqual } from "./rich-text"
import { isCanonicalDate, isCanonicalTimestamp } from "./validation"

type FlagKind = "string" | "number" | "boolean" | "null" | "string-array"

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

const commonList = {
  limit: { kind: "number", arg: "limit" },
  after: { kind: "string", arg: "cursor" },
  "order-by": { kind: "string", arg: "orderBy", values: ["createdAt", "updatedAt"] },
  full: { kind: "boolean" }
} as const
const decodeStringArray = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.NonEmptyString)))

const commands: ReadonlyArray<OfficialCommand> = [
  command("comments search", "list_comments", { ...commonList, "issue-id": stringFlag("issueId"), "project-id": stringFlag("projectId"), "initiative-id": stringFlag("initiativeId"), "document-id": stringFlag("documentId"), "milestone-id": stringFlag("milestoneId"), "status-update-id": stringFlag("statusUpdateId"), "status-update-type": stringFlag("statusUpdateType", ["project", "initiative"]) }, "comments", "comments", ["id", "body", "createdAt", "updatedAt"], ["linear-axi comments search --project-id <project-id>"], undefined, commentSearchValidation),
  command("agent-skills list", "list_agent_skills", { ...commonList }, "agentSkills", "agentSkills", ["id", "name", "updatedAt"], ["linear-axi agent-skills list --limit 50"]),
  command("agent-skills view", "get_agent_skill", { id: requiredString(), full: bool() }, "agentSkill", undefined, undefined, ["linear-axi agent-skills view --id <skill-id> --full"]),
  command("cycles list", "list_cycles", { "team-id": requiredString("teamId"), type: stringFlag(undefined, ["current", "previous", "next"]), full: bool() }, "cycles", "$", ["id", "number", "name", "startsAt", "endsAt"], ["linear-axi cycles list --team-id <team-id> --type current"]),
  command("documents list", "list_documents", { ...commonList, query: stringFlag(), "project-id": stringFlag("projectId"), "initiative-id": stringFlag("initiativeId"), "team-id": stringFlag("teamId"), "creator-id": stringFlag("creatorId"), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived") }, "documents", "documents", ["id", "title", "slugId", "updatedAt"], ["linear-axi documents list --query roadmap --limit 20"]),
  command("documents view", "get_document", { id: requiredString(), full: bool() }, "document", undefined, undefined, ["linear-axi documents view --id <id-or-slug> --full"]),
  command("documents update", "save_document", { id: requiredString(), title: stringFlag(), content: stringFlag(), project: stringFlag(), issue: stringFlag(), initiative: stringFlag(), cycle: stringFlag(), team: stringFlag(), icon: stringFlag(), color: formattedStringFlag("color"), full: bool() }, "document", undefined, undefined, ["linear-axi documents update --id <document-id> --title \"New title\""], undefined, documentUpdateValidation),
  command("issues inspect", "get_issue", { id: requiredString(), relations: bool("includeRelations"), "customer-needs": bool("includeCustomerNeeds"), releases: bool("includeReleases"), full: bool() }, "issue", undefined, undefined, ["linear-axi issues inspect --id ENG-123 --relations --full"]),
  command("issues search", "list_issues", { ...commonList, query: stringFlag(), team: stringFlag(), state: stringFlag(), cycle: stringFlag(), label: stringFlag(), assignee: stringFlag(), delegate: stringFlag(), project: stringFlag(), release: stringFlag(), priority: constrainedNumber({ integer: true, minimum: 0, maximum: 4 }), "parent-id": stringFlag("parentId"), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived") }, "issues", "issues", ["id", "title", "status", "team"], ["linear-axi issues search --team ENG --query auth"]),
  command("projects list", "list_projects", { ...commonList, query: stringFlag(), state: stringFlag(), initiative: stringFlag(), team: stringFlag(), member: stringFlag(), label: stringFlag(), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), milestones: bool("includeMilestones"), members: bool("includeMembers"), "include-archived": bool("includeArchived") }, "projects", "projects", ["id", "name", "slugId", "state", "updatedAt"], ["linear-axi projects list --team ENG --limit 20"], undefined, maxLimit(50)),
  command("projects view", "get_project", { query: requiredString(), milestones: bool("includeMilestones"), members: bool("includeMembers"), resources: bool("includeResources"), full: bool() }, "project", undefined, undefined, ["linear-axi projects view --query <id-name-or-slug> --full"]),
  command("projects update", "save_project", { id: requiredString(), name: stringFlag(), icon: stringFlag(), color: formattedStringFlag("color"), summary: limitedStringFlag(255), description: stringFlag(), state: stringFlag(), "start-date": formattedStringFlag("date", "startDate"), "start-date-resolution": stringFlag("startDateResolution", ["halfYear", "month", "quarter", "year"]), "target-date": formattedStringFlag("date", "targetDate"), "target-date-resolution": stringFlag("targetDateResolution", ["halfYear", "month", "quarter", "year"]), priority: constrainedNumber({ integer: true, minimum: 0, maximum: 4 }), "add-teams-json": arrayFlag("addTeams"), "remove-teams-json": arrayFlag("removeTeams"), "teams-json": arrayFlag("setTeams"), "labels-json": arrayFlag("labels"), lead: stringFlag(), "clear-lead": nullFlag("lead"), "add-initiatives-json": arrayFlag("addInitiatives"), "remove-initiatives-json": arrayFlag("removeInitiatives"), "initiatives-json": arrayFlag("setInitiatives"), full: bool() }, "project", undefined, undefined, ["linear-axi projects update --id <project-id> --state started"], undefined, combineValidation(mutuallyExclusivePairs([["lead", "clear-lead"]]), replacementValidation("teams-json", ["add-teams-json", "remove-teams-json"]), replacementValidation("initiatives-json", ["add-initiatives-json", "remove-initiatives-json"]))),
  command("project-labels list", "list_project_labels", { ...commonList, name: stringFlag() }, "projectLabels", "labels", ["id", "name", "color"], ["linear-axi project-labels list --name Platform"]),
  command("release-pipelines list", "list_release_pipelines", { ...commonList, query: stringFlag(), team: stringFlag(), type: stringFlag(undefined, ["continuous", "scheduled"]), production: bool("isProduction"), stages: bool("includeStages"), teams: bool("includeTeams"), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived") }, "releasePipelines", "releasePipelines", ["id", "name", "slugId", "type", "isProduction"], ["linear-axi release-pipelines list --team ENG"]),
  command("releases list", "list_releases", { ...commonList, query: stringFlag(), pipeline: stringFlag(), stage: stringFlag(), "stage-type": stringFlag("stageType", ["planned", "started", "completed", "canceled"]), version: stringFlag(), "has-release-notes": bool("hasReleaseNotes"), "release-notes": bool("includeReleaseNotes"), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived") }, "releases", "releases", ["id", "name", "version", "stage", "updatedAt"], ["linear-axi releases list --pipeline <pipeline> --limit 20"]),
  command("releases view", "get_release", { id: requiredString(), "release-notes": bool("includeReleaseNotes"), full: bool() }, "release", undefined, undefined, ["linear-axi releases view --id <id-or-slug> --release-notes"]),
  command("releases update", "save_release", { id: requiredString(), name: stringFlag(), description: stringFlag(), version: stringFlag(), pipeline: stringFlag(), stage: stringFlag(), "start-date": formattedStringFlag("date", "startDate"), "clear-start-date": nullFlag("startDate"), "target-date": formattedStringFlag("date", "targetDate"), "clear-target-date": nullFlag("targetDate"), "created-at": formattedStringFlag("timestamp", "createdAt"), "started-at": formattedStringFlag("timestamp", "startedAt"), "clear-started-at": nullFlag("startedAt"), "completed-at": formattedStringFlag("timestamp", "completedAt"), "clear-completed-at": nullFlag("completedAt"), "commit-sha": stringFlag("commitSha"), full: bool() }, "release", undefined, undefined, ["linear-axi releases update --id <release-id> --stage shipped"], undefined, mutuallyExclusivePairs([["start-date", "clear-start-date"], ["target-date", "clear-target-date"], ["started-at", "clear-started-at"], ["completed-at", "clear-completed-at"]])),
  command("release-notes list", "list_release_notes", { ...commonList, query: stringFlag(), pipeline: stringFlag(), release: stringFlag(), content: bool("includeContent"), releases: bool("includeReleases"), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived") }, "releaseNotes", "releaseNotes", ["id", "title", "slugId", "updatedAt"], ["linear-axi release-notes list --pipeline <pipeline>"]),
  command("release-notes view", "get_release_note", { id: requiredString(), releases: bool("includeReleases"), full: bool() }, "releaseNote", undefined, undefined, ["linear-axi release-notes view --id <id-or-slug> --full"]),
  command("release-notes update", "save_release_note", { id: requiredString(), pipeline: stringFlag(), title: stringFlag(), content: stringFlag(), "releases-json": arrayFlag("releases"), "range-from": stringFlag("rangeFromRelease"), "range-to": stringFlag("rangeToRelease"), full: bool() }, "releaseNote", undefined, undefined, ["linear-axi release-notes update --id <note-id> --title \"v2 notes\""], undefined, releaseRangeValidation),
  command("diffs list", "list_diffs", { ...commonList, query: stringFlag(), owner: stringFlag(), repo: stringFlag(), status: stringFlag() }, "diffs", "diffs", ["id", "identifier", "title", "status", "updatedAt"], ["linear-axi diffs list --repo linear-axi --limit 20"]),
  command("diffs view", "get_diff", { id: requiredString("urlOrId"), full: bool() }, "diff", undefined, undefined, ["linear-axi diffs view --id <url-or-id> --full"]),
  command("diffs threads", "get_diff_threads", { id: requiredString("urlOrId"), "thread-id": stringFlag("threadId"), resolved: bool(), "order-by": stringFlag("orderBy", ["createdAt", "updatedAt"]), full: bool() }, "threads", "$", ["id", "resolved", "createdAt", "updatedAt"], ["linear-axi diffs threads --id <url-or-id>"]),
  command("milestones list", "list_milestones", { project: requiredString(), full: bool() }, "milestones", "$", ["id", "name", "targetDate"], ["linear-axi milestones list --project <project>"]),
  command("milestones view", "get_milestone", { project: requiredString(), query: requiredString(), full: bool() }, "milestone", undefined, undefined, ["linear-axi milestones view --project <project> --query <id-or-name>"]),
  command("milestones update", "save_milestone", { project: requiredString(), id: requiredString(), name: stringFlag(), description: stringFlag(), "target-date": formattedStringFlag("date", "targetDate"), "clear-target-date": nullFlag("targetDate"), full: bool() }, "milestone", undefined, undefined, ["linear-axi milestones update --project Roadmap --id <milestone-id> --target-date 2026-09-01"], undefined, mutuallyExclusivePairs([["target-date", "clear-target-date"]])),
  command("teams search", "list_teams", { ...commonList, query: stringFlag(), "include-archived": bool("includeArchived"), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt") }, "teams", "teams", ["id", "key", "name", "updatedAt"], ["linear-axi teams search --query Engineering"]),
  command("teams view", "get_team", { query: requiredString(), full: bool() }, "team", undefined, undefined, ["linear-axi teams view --query <id-key-or-name>"]),
  command("users list", "list_users", { ...commonList, query: stringFlag(), team: stringFlag() }, "users", "users", ["id", "name", "email", "active"], ["linear-axi users list --query Alice"]),
  command("users view", "get_user", { query: requiredString(), full: bool() }, "user", undefined, undefined, ["linear-axi users view --query <id-name-or-email>"]),
  command("docs search", "search_documentation", { query: requiredString(), page: numberFlag() }, "documentation", "$", ["title", "url", "snippet"], ["linear-axi docs search --query \"project updates\""]),
  command("status-updates list", "get_status_updates", { ...commonList, type: requiredStringEnum(["project", "initiative"]), project: stringFlag(), initiative: stringFlag(), user: stringFlag(), "created-at": stringFlag("createdAt"), "updated-at": stringFlag("updatedAt"), "include-archived": bool("includeArchived") }, "statusUpdates", "statusUpdates", ["id", "type", "health", "createdAt", "updatedAt"], ["linear-axi status-updates list --type project --project <project>"]),
  command("status-updates view", "get_status_updates", { id: requiredString(), type: requiredStringEnum(["project", "initiative"]), full: bool() }, "statusUpdates", "statusUpdates", ["id", "type", "health", "body"], ["linear-axi status-updates view --id <update-id> --type project"]),
  command("status-updates update", "save_status_update", { type: requiredStringEnum(["project", "initiative"]), id: requiredString(), project: stringFlag(), initiative: stringFlag(), body: stringFlag(), health: stringFlag(undefined, ["onTrack", "atRisk", "offTrack"]), full: bool() }, "statusUpdate", undefined, undefined, ["linear-axi status-updates update --type project --id <update-id> --health onTrack"], undefined, statusUpdateValidation)
]

export const officialCommandSpecs: ReadonlyArray<CommandSpec> = commands.map((entry) => {
  const flagNames = Object.entries(entry.flags).flatMap(([name, flag]) =>
    flag.kind === "boolean" && name !== "full" ? [name, `no-${name}`] : [name])
  const flags = new Set(["help", ...flagNames])
  const valueFlags = new Set(Object.entries(entry.flags).filter(([, flag]) => !["boolean", "null"].includes(flag.kind)).map(([name]) => name))
  const required = new Set(Object.entries(entry.flags).filter(([, flag]) => flag.required).map(([name]) => name))
  const usage = `Usage: linear-axi ${entry.path.join(" ")} ${[...required].map((flag) => `--${flag} <value>`).join(" ")}`.trimEnd()
  const options = [...flags].map((flag) => `  --${flag}${valueFlags.has(flag) ? " <value>" : ""}${required.has(flag) ? " (required)" : ""}`)
  return {
    path: entry.path,
    flags,
    valueFlags,
    required,
    help: [usage, "Options:", ...options, "Example:", ...entry.examples.map((example) => `  ${example}`)].join("\n")
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
      args[arg] = value
    }
  }
  if (entry.tool.startsWith("save_")) return runVerifiedMutation(entry, args, parsed, gateway)
  return gateway.callOfficialTool(entry.tool, args).pipe(
    Effect.flatMap((result) => renderResult(entry, result, parsed))
  )
}

const renderResult = (
  entry: OfficialCommand,
  value: unknown,
  parsed: ParsedArgs
): Effect.Effect<OutputValue, LinearDomainError> => {
  const full = parsed.flags.get("full") === true
  if (entry.listKey === "$") {
    if (!Array.isArray(value)) return shapeDrift(entry, "expected an array result")
    if (value.some((row) => !Predicate.isObject(row))) return shapeDrift(entry, "expected every row to be an object")
    const items = full ? value : value.map((row) => projectRow(row, entry.defaultFields ?? []))
    const documentationPage = entry.tool === "search_documentation"
      ? Number(parsed.flags.get("page") ?? 0)
      : undefined
    return Effect.succeed({
      count: `${items.length} ${entry.outputKey} shown`,
      page: documentationPage === undefined ? { hasNext: false, endCursor: null } : { current: documentationPage },
      ...(items.length === 0 ? { [entry.outputKey]: `0 ${entry.outputKey} matched this query` } : { [entry.outputKey]: items }),
      help: documentationPage === undefined
        ? []
        : [`Run \`linear-axi ${entry.path.join(" ")} ${replayFlags(parsed.flags, { page: String(documentationPage + 1) })}\` for the next page.`]
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
    if (result.hasNextPage === true && (typeof result.cursor !== "string" || result.cursor.trim().length === 0)) {
      return shapeDrift(entry, "expected a non-blank cursor when hasNextPage is true")
    }
    const rows: ReadonlyArray<unknown> = candidateRows
    if (rows.some((row) => !Predicate.isObject(row))) return shapeDrift(entry, `expected every ${entry.listKey} row to be an object`)
    const items = full ? rows : rows.map((row) => projectRow(row, entry.defaultFields ?? []))
    const cursor = typeof result.cursor === "string" ? result.cursor : null
    const hasNext = result.hasNextPage === true
    return Effect.succeed({
      count: `${items.length} ${entry.outputKey} shown`,
      page: { hasNext, endCursor: cursor },
      ...(items.length === 0 ? { [entry.outputKey]: `0 ${entry.outputKey} matched this query` } : { [entry.outputKey]: items }),
      help: hasNext && cursor ? [continuation(entry, parsed.flags, cursor)] : []
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
  const canonicalArgs = yield* canonicalizeMutationArgs(entry.tool, args, gateway)
  const beforeRaw = yield* gateway.callOfficialTool(mutationReadTool(entry.tool), mutationReadArgs(entry.tool, canonicalArgs))
  const before = yield* extractMutationObject(entry.tool, beforeRaw, canonicalArgs)
  if (mutationSatisfied(before, canonicalArgs, entry.tool)) {
    return detailOutput(entry, before, parsed, false, "requested properties already match (no-op)")
  }
  yield* gateway.callOfficialTool(entry.tool, canonicalArgs)
  const afterRaw = yield* gateway.callOfficialTool(mutationReadTool(entry.tool), mutationReadArgs(entry.tool, canonicalArgs))
  const after = yield* extractMutationObject(entry.tool, afterRaw, canonicalArgs)
  if (!mutationSatisfied(after, canonicalArgs, entry.tool)) {
    return yield* Effect.fail(new LinearDomainError({
      message: `${entry.tool} update could not be verified`,
      help: `Run \`${mutationRecoveryCommand(entry.tool, canonicalArgs)}\` before retrying.`
    }))
  }
  return detailOutput(entry, after, parsed, true, `official ${entry.tool} update verified`)
})

const canonicalizeMutationArgs = Effect.fn("canonicalizeMutationArgs")(function*(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  gateway: LinearGateway
) {
  if (tool === "save_project" && typeof args.lead === "string") {
    const user = yield* gateway.callOfficialTool("get_user", { query: args.lead })
    if (!Predicate.isObject(user) || !nonEmptyString(user.id) || (args.lead !== "me" && !userEntityMatches(user, args.lead))) {
      return yield* mutationShapeDrift(tool)
    }
    return { ...args, lead: user.id }
  }
  if (tool === "save_milestone" && typeof args.project === "string" && typeof args.id === "string") {
    const project = yield* gateway.callOfficialTool("get_project", { query: args.project })
    if (!Predicate.isObject(project) || !nonEmptyString(project.id) || !mutationEntityMatches(project, args.project, "save_project")) {
      return yield* mutationShapeDrift(tool)
    }
    const milestone = yield* gateway.callOfficialTool("get_milestone", { project: project.id, query: args.id })
    if (!Predicate.isObject(milestone) || !nonEmptyString(milestone.id) || !mutationEntityMatches(milestone, args.id, "save_milestone")) {
      return yield* mutationShapeDrift(tool)
    }
    return { ...args, project: project.id, id: milestone.id }
  }
  return args
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
  if (tool === "save_release_note") return { id: args.id, ...(args.releases === undefined ? {} : { includeReleases: true }) }
  return { id: args.id }
}

const mutationIdentityKeys = (tool: string): ReadonlyArray<string> =>
  tool === "save_milestone" ? ["id", "project"] : tool === "save_status_update" ? ["id", "type"] : ["id"]

const extractMutationObject = (
  tool: string,
  value: unknown,
  args: Readonly<Record<string, unknown>>
): Effect.Effect<Record<string, unknown>, LinearDomainError> => {
  if (tool === "save_status_update") {
    if (!Predicate.isObject(value) || !Array.isArray(value.statusUpdates)) return mutationShapeDrift(tool)
    const matches = value.statusUpdates.filter(Predicate.isObject).filter((item) =>
      mutationEntityMatches(item, args.id, tool) && referenceEqual(item.type, args.type))
    return matches.length === 1 ? Effect.succeed(matches[0]!) : mutationShapeDrift(tool)
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
  if (mutationIdentityKeys(tool).includes(key)) return true
  if (key.startsWith("add") && key.length > 3) return collectionContains(current[lowerFirst(key.slice(3))], desired)
  if (key.startsWith("remove") && key.length > 6) return collectionAbsent(current[lowerFirst(key.slice(6))], desired)
  if (key.startsWith("set") && key.length > 3) return collectionEqual(current[lowerFirst(key.slice(3))], desired)
  if (Array.isArray(desired)) return collectionEqual(current[key], desired)
  if (["body", "content", "description"].includes(key) && typeof current[key] === "string" && typeof desired === "string") {
    return richTextEqual(current[key], desired)
  }
  return referenceEqual(current[key], desired)
})

const collectionEqual = (current: unknown, desired: unknown): boolean => collectionMatches(current, desired, true)
const collectionContains = (current: unknown, desired: unknown): boolean => collectionMatches(current, desired, false)
const collectionAbsent = (current: unknown, desired: unknown): boolean => {
  if (!Array.isArray(current) || !Array.isArray(desired)) return false
  const references = collectionReferences(current)
  return references.every((values) => values.length > 0) &&
    desired.every((value) => !references.some((values) => values.some((reference) => referenceTextEqual(reference, String(value)))))
}
const collectionMatches = (current: unknown, desired: unknown, exact: boolean): boolean => {
  if (!Array.isArray(current) || !Array.isArray(desired)) return false
  const remaining = collectionReferences(current).map((references) => [...references])
  for (const value of desired) {
    const index = remaining.findIndex((references) => references.some((reference) => referenceTextEqual(reference, String(value))))
    if (index === -1) return false
    remaining.splice(index, 1)
  }
  return !exact || remaining.length === 0
}
const collectionReferences = (value: unknown): ReadonlyArray<ReadonlyArray<string>> => Array.isArray(value)
  ? value.map(referenceValues)
  : []
const referenceValues = (value: unknown): ReadonlyArray<string> => Predicate.isObject(value)
  ? [value.id, value.identifier, value.name, value.key, value.email, value.displayName, value.slugId, value.version, value.number, value.type]
      .filter((reference): reference is string | number => nonEmptyString(reference) || typeof reference === "number")
      .map(String)
  : nonEmptyString(value) || typeof value === "number" ? [String(value)] : []
const referenceEqual = (current: unknown, desired: unknown): boolean => {
  if (desired === null) return current == null
  if (Predicate.isObject(current)) return referenceValues(current).some((reference) => referenceTextEqual(reference, String(desired)))
  return typeof current === "string" && typeof desired === "string"
    ? referenceTextEqual(current, desired)
    : current === desired
}
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
const lowerFirst = (value: string): string => `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`

const mutationRecoveryCommand = (tool: string, args: Readonly<Record<string, unknown>>): string => {
  const id = shellQuote(String(args.id))
  if (tool === "save_project") return `linear-axi projects view --query ${id} --full`
  if (tool === "save_milestone") return `linear-axi milestones view --project ${shellQuote(String(args.project))} --query ${id} --full`
  if (tool === "save_status_update") return `linear-axi status-updates view --type ${shellQuote(String(args.type))} --id ${id} --full`
  const noun = tool === "save_document"
    ? "documents"
    : tool === "save_release_note"
      ? "release-notes"
      : "releases"
  return `linear-axi ${noun} view --id ${id} --full`
}

const detailOutput = (
  entry: OfficialCommand,
  detail: unknown,
  parsed: ParsedArgs,
  changed: boolean,
  result?: string
): OutputValue => {
  const full = parsed.flags.get("full") === true
  const truncated = full ? { value: detail, fields: [] } : truncateDetail(detail)
  return {
    [entry.outputKey]: truncated.value,
    ...(result === undefined ? {} : { changed, result }),
    ...(truncated.fields.length === 0 ? {} : {
      truncated: truncated.fields,
      help: [`Run \`linear-axi ${entry.path.join(" ")} ${replayFlags(parsed.flags, { full: true })}\` for complete text fields.`]
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

const projectRow = (value: unknown, fields: ReadonlyArray<string>): unknown => {
  if (!Predicate.isObject(value)) return value
  const selected = fields.filter((field) => value[field] !== undefined).slice(0, 4)
  return Object.fromEntries(selected.map((field) => [field, value[field]]))
}

const truncateDetail = (value: unknown): { readonly value: unknown; readonly fields: ReadonlyArray<{ readonly field: string; readonly total: number }> } => {
  if (!Predicate.isObject(value)) return { value, fields: [] }
  const fields: Array<{ readonly field: string; readonly total: number }> = []
  const rendered = Object.fromEntries(Object.entries(value).map(([key, field]) => {
    if (typeof field === "string" && ["body", "content", "description", "instructions", "text"].includes(key)) {
      const truncated = truncateText(field, 1200, false)
      if (truncated.truncated) fields.push({ field: key, total: truncated.total })
      return [key, truncated.text]
    }
    return [key, field]
  }))
  return { value: rendered, fields }
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

function stringFlag(arg?: string, values?: ReadonlyArray<string>): OfficialFlag {
  return { kind: "string", arg, values }
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
function numberFlag(arg?: string): OfficialFlag {
  return { kind: "number", arg }
}
function constrainedNumber(options: Pick<OfficialFlag, "integer" | "minimum" | "maximum">, arg?: string): OfficialFlag {
  return { kind: "number", arg, ...options }
}
function bool(arg?: string): OfficialFlag {
  return { kind: "boolean", arg }
}
function nullFlag(arg: string): OfficialFlag {
  return { kind: "null", arg }
}
function arrayFlag(arg?: string): OfficialFlag {
  return { kind: "string-array", arg }
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

function mutuallyExclusivePairs(pairs: ReadonlyArray<readonly [string, string]>): (flags: ReadonlyMap<string, string | boolean>) => string | undefined {
  return (flags) => {
    const conflict = pairs.find(([setFlag, clearFlag]) => flags.has(setFlag) && flags.has(clearFlag))
    return conflict ? `--${conflict[0]} and --${conflict[1]} are mutually exclusive` : undefined
  }
}

function combineValidation(...validators: ReadonlyArray<(flags: ReadonlyMap<string, string | boolean>) => string | undefined>) {
  return (flags: ReadonlyMap<string, string | boolean>): string | undefined => {
    for (const validate of validators) {
      const result = validate(flags)
      if (result) return result
    }
    return undefined
  }
}

function replacementValidation(replace: string, incremental: ReadonlyArray<string>) {
  return (flags: ReadonlyMap<string, string | boolean>): string | undefined =>
    flags.has(replace) && incremental.some((flag) => flags.has(flag))
      ? `--${replace} cannot be combined with ${incremental.map((flag) => `--${flag}`).join(" or ")}`
      : undefined
}

function releaseRangeValidation(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  if (flags.has("releases-json") && (flags.has("range-from") || flags.has("range-to"))) return "--releases-json cannot be combined with a release range"
  if (flags.has("range-from") !== flags.has("range-to")) return "--range-from and --range-to must be provided together"
  return undefined
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
