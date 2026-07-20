import { Effect, Predicate, Schema } from "effect"
import {
  commandSpecs,
  DEFAULT_ISSUE_FIELDS,
  DEFAULT_LABEL_FIELDS,
  findSpec,
  ISSUE_FIELDS,
  LABEL_FIELDS,
  type ParsedArgs,
  readBooleanFlag,
  readLimitFlag,
  readStringFlag,
  topLevelHelp
} from "./args"
import type { Env } from "./env"
import { LinearDomainError, UsageError, type CliError } from "./errors"
import type {
  IssueSummary,
  LabelSummary,
  LinearGateway,
  RelationDirection,
  RelationType
} from "./linear"
import { DESCRIPTION_CONCURRENCY_WARNING } from "./linear"
import { decodeLocalCursorOffset } from "./linear-pagination"
import { connectOAuth, setupOAuth } from "./oauth"
import { truncateText, type OutputValue } from "./output"
import { richTextEqual } from "./rich-text"
import { isCanonicalDate, isCanonicalTimestamp } from "./validation"
import { runOfficialCommand } from "./official-commands"
import { validateFrontierCursor } from "./wayfinder"

const ISSUE_FIELD_SET: ReadonlySet<string> = new Set(ISSUE_FIELDS)
const LABEL_FIELD_SET: ReadonlySet<string> = new Set(LABEL_FIELDS)
const RELATION_TYPES = new Set<RelationType>(["blocks", "related", "duplicate", "similar"])
const RELATION_DIRECTIONS = new Set(["outgoing", "incoming", "both"])
const MAX_OFFICIAL_PAGES = 1_000
const decodeStringArray = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.NonEmptyString)))
const decodeLinkArray = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^https?:\/\//)),
  title: Schema.NonEmptyString
}))))

export const runCommand = (
  parsed: ParsedArgs,
  gateway: LinearGateway,
  binPath: string,
  env: Env = process.env,
  credentialPathEnv: Env = process.env
): Effect.Effect<OutputValue, CliError> =>
  Effect.try({
    try: () => dispatchCommand(parsed, gateway, binPath, env, credentialPathEnv),
    catch: (cause): CliError => cause instanceof UsageError
      ? cause
      : new LinearDomainError({ message: "Command validation failed", help: helpFor(parsed.command) })
  }).pipe(Effect.flatten)

const dispatchCommand = (
  parsed: ParsedArgs,
  gateway: LinearGateway,
  binPath: string,
  env: Env = process.env,
  credentialPathEnv: Env = process.env
): Effect.Effect<OutputValue, CliError> => {
  const path = parsed.command.join(" ")

  if (parsed.flags.get("help") === true) {
    return Effect.succeed({ help: helpFor(parsed.command) })
  }

  switch (path) {
    case "home": return home(gateway, binPath)
    case "auth status":
      return gateway.authStatus().pipe(Effect.map((auth) => ({
        auth,
        help: auth.authenticated ? [] : ["Run `linear-axi auth login` to choose and connect a Linear workspace."]
      })))
    case "auth login":
      return authOAuthConnect(parsed, env, credentialPathEnv, { openBrowser: true, promptConsent: true, writeEnv: true })
    case "auth oauth setup": return authOAuthSetup(parsed, env)
    case "auth oauth connect": return authOAuthConnect(parsed, env, credentialPathEnv)
    case "teams list": return teamsList(parsed, gateway)
    case "workflow-states list": return workflowStatesList(parsed, gateway)
    case "issues list": return issuesList(parsed, gateway)
    case "issues view": return issuesView(parsed, gateway)
    case "issues create": return issuesCreate(parsed, gateway)
    case "issues assign": return issuesAssign(parsed, gateway)
    case "issues unassign": return issuesUnassign(parsed, gateway)
    case "issues close": return issuesClose(parsed, gateway)
    case "issues state": return issuesState(parsed, gateway)
    case "issues parent set": return issuesParent(parsed, gateway, false)
    case "issues parent clear": return issuesParent(parsed, gateway, true)
    case "issues update": return issuesUpdate(parsed, gateway)
    case "labels list": return labelsList(parsed, gateway)
    case "labels create": return labelsCreate(parsed, gateway)
    case "labels apply": return labelsApply(parsed, gateway)
    case "labels add": return labelsApply(parsed, gateway)
    case "labels remove": return labelsRemove(parsed, gateway)
    case "labels replace": return labelsReplace(parsed, gateway)
    case "relations list": return relationsList(parsed, gateway)
    case "relations create": return relationsCreate(parsed, gateway)
    case "relations remove": return relationsRemove(parsed, gateway)
    case "comments list": return commentsList(parsed, gateway)
    case "comments create": return commentsCreate(parsed, gateway)
    case "wayfinder frontier": return wayfinderFrontier(parsed, gateway)
    default: return runOfficialCommand(parsed, gateway) ?? Effect.fail(new UsageError({ message: `unknown command ${path}`, help: topLevelHelp }))
  }
}

const home = (gateway: LinearGateway, binPath: string) =>
  gateway.authStatus().pipe(
    Effect.flatMap((auth) => {
      if (!auth.authenticated) {
        return Effect.succeed({
          bin: collapseHome(binPath),
          description: "Operate Linear through a Bun, Effect, AXI-oriented CLI.",
          auth,
          help: ["Run `linear-axi auth login` to choose and connect a Linear workspace."]
        })
      }

      return gateway.listIssues({ assignee: "me", limit: 10, fields: DEFAULT_ISSUE_FIELDS }).pipe(
        Effect.map((result) => ({
          bin: collapseHome(binPath),
          description: "Operate Linear through a Bun, Effect, AXI-oriented CLI.",
          auth,
          count: `${result.items.length} assigned issues shown`,
          issues: result.items.map((issue) => projectIssue(issue, DEFAULT_ISSUE_FIELDS)),
          help: [
            "Run `linear-axi issues view --id <issue-id-or-key>` for details.",
            "Run `linear-axi teams list` to find team keys."
          ]
        }))
      )
    })
  )

const teamsList = (parsed: ParsedArgs, gateway: LinearGateway) =>
  gateway.listTeams(readLimitFlag(parsed.flags, 50)).pipe(
    Effect.map((teams) => ({
      count: `${teams.length} teams shown`,
      ...(teams.length === 0 ? { teams: "0 teams found for this Linear account" } : { teams }),
      help: teams.length === 0 ? [] : ["Run `linear-axi issues list --team <key-or-id>` to list issues for a team."]
    }))
  )

const workflowStatesList = (parsed: ParsedArgs, gateway: LinearGateway) =>
  gateway.listWorkflowStates({ team: readStringFlag(parsed.flags, "team")! }).pipe(
    Effect.map((states) => ({
      count: `${states.length} workflow states shown`,
      ...(states.length === 0
        ? { states: `0 workflow states found for ${readStringFlag(parsed.flags, "team")}` }
        : { states }),
      help: []
    }))
  )

const issuesList = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const assignee = readStringFlag(parsed.flags, "assignee")
  const state = readStringFlag(parsed.flags, "state")
  validateAssignee(assignee, "assignee", true, helpFor(parsed.command))
  if (state !== undefined && state !== "open" && state !== "closed") {
    return usage("--state must be `open` or `closed`", parsed.command)
  }
  const fields = readFields(parsed, "fields", ISSUE_FIELD_SET, DEFAULT_ISSUE_FIELDS)
  return gateway.listIssues({
    limit: readLimitFlag(parsed.flags, 20),
    after: readStringFlag(parsed.flags, "after"),
    assignee,
    team: readStringFlag(parsed.flags, "team"),
    label: readStringFlag(parsed.flags, "label"),
    parent: readStringFlag(parsed.flags, "parent"),
    state,
    fields
  }).pipe(
    Effect.map((result) => {
      const parent = readStringFlag(parsed.flags, "parent")
      const help = result.page.hasNext && result.page.endCursor
        ? [continuationCommand("issues list", parsed, result.page.endCursor)]
        : result.items.length > 0
          ? ["Run `linear-axi issues view --id <issue-id-or-key>` for details."]
          : []
      return {
        count: `${result.items.length} issues shown`,
        page: result.page,
        ...(result.items.length === 0
          ? { issues: parent ? `0 child issues found for ${parent}` : "0 issues matched this query" }
          : { issues: result.items.map((issue) => projectIssue(issue, fields)) }),
        help
      }
    })
  )
}

const issuesView = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const id = readStringFlag(parsed.flags, "id")!
  const full = readBooleanFlag(parsed.flags, "full")
  return gateway.viewIssue(id).pipe(
    Effect.map((issue) => {
      const description = truncateText(issue.description, 1200, full)
      return {
        issue: { ...issue, description: description.text },
        ...(description.truncated
          ? {
              body: { truncated: true, total: description.total },
              help: [`Run \`linear-axi issues view --id ${issue.identifier} --full\` to see the complete description.`]
            }
          : {})
      }
    })
  )
}

const issuesCreate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const description = readStringFlag(parsed.flags, "description")
  const descriptionFile = readStringFlag(parsed.flags, "description-file")
  if (description !== undefined && descriptionFile !== undefined) {
    return usage("--description and --description-file are mutually exclusive", parsed.command)
  }
  const id = readStringFlag(parsed.flags, "id")
  if (id && !isUuidV4(id)) {
    return usage("--id must be a UUID v4", parsed.command)
  }
  const labelsJson = readStringFlag(parsed.flags, "labels-json")
  if (labelsJson !== undefined && readStringFlag(parsed.flags, "label") !== undefined) {
    return usage("--label and --labels-json are mutually exclusive", parsed.command)
  }
  if (id && readBooleanFlag(parsed.flags, "if-absent")) {
    return usage("--id and --if-absent are mutually exclusive", parsed.command)
  }
  const advanced = ["labels-json", "assignee", "delegate", "state", "priority", "due-date", "estimate", "project", "cycle", "milestone", "links-json", "releases-json", "blocks-json", "blocked-by-json", "related-to-json", "duplicate-of"]
    .some((flag) => parsed.flags.has(flag)) || readBooleanFlag(parsed.flags, "if-absent")
  if (advanced && id) {
    return usage("--id is available only for native core creation; use --if-absent with advanced properties", parsed.command)
  }
  if (advanced && !readBooleanFlag(parsed.flags, "if-absent")) {
    return usage("advanced issue creation requires --if-absent so retries have a resumable boundary", parsed.command)
  }
  if (advanced) issuePropertyInput(parsed, undefined, labelsJson)
  return readOptionalText(description, descriptionFile, "description-file", parsed.command).pipe(
    Effect.flatMap((body) => {
      if (advanced) return createOfficialIssue(parsed, gateway, body, labelsJson)
      return gateway.createIssue({
        team: readStringFlag(parsed.flags, "team")!,
        title: readStringFlag(parsed.flags, "title")!,
        description: body,
        parent: readStringFlag(parsed.flags, "parent"),
        label: readStringFlag(parsed.flags, "label"),
        id
      }).pipe(Effect.map((result): OutputValue => ({
        issue: result.value,
        changed: result.changed,
        result: result.result,
        help: result.changed ? [`Run \`linear-axi issues view --id ${result.value.identifier}\` for details.`] : []
      })))
    })
  )
}

const createOfficialIssue = (
  parsed: ParsedArgs,
  gateway: LinearGateway,
  description: string | undefined,
  labelsJson: string | undefined
): Effect.Effect<OutputValue, CliError> => Effect.gen(function*() {
  const title = readStringFlag(parsed.flags, "title")!
  const teamInput = readStringFlag(parsed.flags, "team")!
  const team = yield* resolveOfficialTeamSelector(gateway, teamInput)
  const input = issuePropertyInput(parsed, description, labelsJson)
  input.title = title
  input.team = team
  if (typeof input.assignee === "string") input.assignee = yield* resolveOfficialAssignableUserSelector(gateway, input.assignee)
  if (typeof input.state === "string") input.state = yield* resolveOfficialStateSelector(gateway, team, input.state)
  yield* resolveOfficialIssueSelectors(gateway, input, team)
  const candidates = yield* fetchOfficialRows(gateway, "list_issues", {
    query: title,
    team,
    limit: 100,
    includeArchived: false
  }, "issues")
  const matches = candidates.filter((issue) =>
    issue.archivedAt == null && issue.title === title && officialReferenceMatches(issue.teamId ?? issue.team, team))
  if (matches.length > 1) {
    return yield* Effect.fail(new LinearDomainError({
      message: `Multiple issues exactly match title ${title} in team ${teamInput}`,
      help: `Candidate ids: ${matches.map((issue) => String(issue.id)).join(", ")}`
    }))
  }
  if (matches.length === 1) {
    const candidate = matches[0]!
    const candidateId = officialIssueIdentity(candidate)
    if (!candidateId) return yield* officialShapeError("list_issues identity")
    const detail = yield* gateway.callOfficialTool("get_issue", {
      id: candidateId,
      includeRelations: true,
      includeReleases: true
    })
    if (!Predicate.isObject(detail) || !officialEntityMatchesSelector(detail, candidateId, ["id", "identifier"])) {
      return yield* officialShapeError("get_issue identity")
    }
    if (officialIssueSatisfies(detail, input)) {
      return { issue: detail, changed: false, result: "exact issue already exists (no-op)" }
    }
    return yield* Effect.fail(new LinearDomainError({
      message: `Issue title ${title} already exists in team ${teamInput} with different requested properties`,
      help: `Inspect candidate id ${candidateId} and update it explicitly, or choose a different title.`
    }))
  }
  const created = yield* gateway.callOfficialTool("save_issue", input)
  if (!Predicate.isObject(created)) return yield* officialShapeError("save_issue identity")
  const createdId = officialIssueIdentity(created)
  if (!createdId) return yield* officialShapeError("save_issue identity")
  const issue = yield* gateway.callOfficialTool("get_issue", officialIssueReadArgs(createdId, input))
  if (!Predicate.isObject(issue) || !officialEntityMatchesSelector(issue, createdId, ["id", "identifier"])) {
    return yield* officialShapeError("get_issue identity")
  }
  if (!officialIssueSatisfies(issue, input)) {
    return yield* Effect.fail(new LinearDomainError({
      message: "save_issue create could not be verified",
      help: `Run \`linear-axi issues inspect --id ${shellQuote(createdId)} --full\` before retrying.`
    }))
  }
  return { issue, changed: true, result: "issue created through official save_issue" }
})

const issuesAssign = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const assignee = readStringFlag(parsed.flags, "assignee")!
  validateAssignee(assignee, "assignee", false, helpFor(parsed.command))
  return gateway.assignIssue({
    id: readStringFlag(parsed.flags, "id")!,
    assignee,
    replace: readBooleanFlag(parsed.flags, "replace")
  }).pipe(Effect.map(issueMutationOutput))
}

const issuesUnassign = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const expected = readStringFlag(parsed.flags, "if-assignee")
  validateAssignee(expected, "if-assignee", false, helpFor(parsed.command))
  return gateway.unassignIssue({
    id: readStringFlag(parsed.flags, "id")!,
    ifAssignee: expected
  }).pipe(Effect.map(issueMutationOutput))
}

const issuesClose = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const state = readStringFlag(parsed.flags, "state")
  if (state && !isUuidV4(state)) {
    return usage("--state must be a workflow-state UUID", parsed.command)
  }
  return gateway.closeIssue({ id: readStringFlag(parsed.flags, "id")!, state }).pipe(Effect.map(issueMutationOutput))
}

const issuesState = (parsed: ParsedArgs, gateway: LinearGateway) =>
  gateway.changeIssueState({
    id: readStringFlag(parsed.flags, "id")!,
    state: readStringFlag(parsed.flags, "state")!
  }).pipe(Effect.map(issueMutationOutput))

const issuesParent = (parsed: ParsedArgs, gateway: LinearGateway, clear: boolean) =>
  gateway.setIssueParent({
    id: readStringFlag(parsed.flags, "id")!,
    parent: clear ? null : readStringFlag(parsed.flags, "parent")!
  }).pipe(Effect.map(issueMutationOutput))

const issuesUpdate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const description = readStringFlag(parsed.flags, "description")
  const descriptionFile = readStringFlag(parsed.flags, "description-file")
  if (description !== undefined && descriptionFile !== undefined) {
    return usage("--description and --description-file are mutually exclusive", parsed.command)
  }
  const timestamp = readStringFlag(parsed.flags, "if-updated-at")
  if ((description !== undefined || descriptionFile !== undefined) && (timestamp === undefined || !isCanonicalTimestamp(timestamp))) {
    return usage("description changes require --if-updated-at with the exact canonical timestamp emitted by the CLI", parsed.command)
  }
  if (timestamp !== undefined && !isCanonicalTimestamp(timestamp)) {
    return usage("--if-updated-at must be the exact canonical timestamp emitted by the CLI (YYYY-MM-DDTHH:mm:ss.sssZ)", parsed.command)
  }
  const conflicts: ReadonlyArray<readonly [string, string]> = [
    ["assignee", "clear-assignee"], ["delegate", "clear-delegate"], ["due-date", "clear-due-date"], ["estimate", "clear-estimate"],
    ["project", "clear-project"], ["cycle", "clear-cycle"], ["milestone", "clear-milestone"],
    ["parent", "clear-parent"], ["labels-json", "clear-labels"], ["duplicate-of", "clear-duplicate"]
  ]
  for (const [setFlag, clearFlag] of conflicts) {
    if (parsed.flags.has(setFlag) && parsed.flags.has(clearFlag)) {
      return usage(`--${setFlag} and --${clearFlag} are mutually exclusive`, parsed.command)
    }
  }
  if (parsed.flags.has("set-releases-json") && (parsed.flags.has("add-releases-json") || parsed.flags.has("remove-releases-json"))) {
    return usage("--set-releases-json cannot be combined with --add-releases-json or --remove-releases-json", parsed.command)
  }
  const propertyFlags = [...parsed.flags.keys()].filter((flag) => !["id", "help", "if-updated-at", "description-file", "description"].includes(flag))
  if (description === undefined && descriptionFile === undefined && propertyFlags.length === 0) {
    return usage("at least one issue property or explicit clear flag is required", parsed.command)
  }
  const nativeClearDue = readBooleanFlag(parsed.flags, "clear-due-date")
  const nativeClearMilestone = readBooleanFlag(parsed.flags, "clear-milestone")
  if (nativeClearDue || nativeClearMilestone) {
    const other = [...parsed.flags.keys()].filter((flag) => !["id", "help", "clear-due-date", "clear-milestone"].includes(flag))
    if (other.length > 0) {
      return usage("--clear-due-date and --clear-milestone may be combined with each other, but not with other updates; they use one verified native mutation", parsed.command)
    }
    return gateway.clearIssueFields({
      id: readStringFlag(parsed.flags, "id")!,
      dueDate: nativeClearDue,
      milestone: nativeClearMilestone
    }).pipe(Effect.map(issueMutationOutput))
  }
  const nativeDescriptionOnly = descriptionFile !== undefined && propertyFlags.length === 0
  if (nativeDescriptionOnly) {
    return readRequiredText(descriptionFile, "description-file", parsed.command).pipe(
      Effect.flatMap((body) => gateway.updateIssueDescription({
      id: readStringFlag(parsed.flags, "id")!,
      description: body,
      ifUpdatedAt: timestamp!
    })),
    Effect.map((result) => ({
      issue: result.value,
      changed: result.changed,
      result: result.result,
      concurrency: DESCRIPTION_CONCURRENCY_WARNING
    }))
    )
  }
  issuePropertyInput(parsed, undefined, readStringFlag(parsed.flags, "labels-json"))
  return readOptionalText(description, descriptionFile, "description-file", parsed.command).pipe(
    Effect.flatMap((body) => updateOfficialIssue(parsed, gateway, body, timestamp))
  )
}

const updateOfficialIssue = (
  parsed: ParsedArgs,
  gateway: LinearGateway,
  description: string | undefined,
  timestamp: string | undefined
): Effect.Effect<OutputValue, CliError> => Effect.gen(function*() {
  const id = readStringFlag(parsed.flags, "id")!
  const input = issuePropertyInput(parsed, description, readStringFlag(parsed.flags, "labels-json"))
  input.id = id
  const before = yield* gateway.callOfficialTool("get_issue", officialIssueReadArgs(id, input))
  if (!Predicate.isObject(before) || !officialEntityMatchesSelector(before, id)) return yield* officialShapeError("get_issue identity")
  if (timestamp !== undefined && before.updatedAt !== timestamp) {
    return yield* Effect.fail(new LinearDomainError({
      message: `Issue changed since ${timestamp}; refusing a known-stale description update`,
      help: `Run \`linear-axi issues inspect --id ${id} --full\`, then retry with its updatedAt.`
    }))
  }
  if (typeof input.assignee === "string") input.assignee = yield* resolveOfficialAssignableUserSelector(gateway, input.assignee)
  if (typeof input.state === "string") {
    const team = officialTeamSelector(before)
    if (!team) return yield* officialShapeError("get_issue team")
    input.state = yield* resolveOfficialStateSelector(gateway, team, input.state)
  }
  const team = officialTeamSelector(before)
  if (!team) return yield* officialShapeError("get_issue team")
  yield* resolveOfficialIssueSelectors(gateway, input, team, before)
  if (officialIssueSatisfies(before, input)) {
    return { issue: before, changed: false, result: "requested issue properties already match (no-op)" }
  }
  yield* gateway.callOfficialTool("save_issue", input)
  const after = yield* gateway.callOfficialTool("get_issue", officialIssueReadArgs(id, input))
  if (!Predicate.isObject(after) || !officialEntityMatchesSelector(after, id)) return yield* officialShapeError("get_issue identity")
  if (!officialIssueSatisfies(after, input)) {
    return yield* Effect.fail(new LinearDomainError({
      message: "save_issue update could not be verified",
      help: `Run \`linear-axi issues inspect --id ${shellQuote(id)} --full\` before retrying.`
    }))
  }
  return { issue: after, changed: true, result: "requested issue properties saved and verified", concurrency: DESCRIPTION_CONCURRENCY_WARNING }
})

const issuePropertyInput = (
  parsed: ParsedArgs,
  description: string | undefined,
  labelsJson: string | undefined
): Record<string, unknown> => {
  const input: Record<string, unknown> = {}
  const strings: ReadonlyArray<readonly [string, string]> = [
    ["title", "title"], ["assignee", "assignee"], ["delegate", "delegate"], ["state", "state"], ["due-date", "dueDate"],
    ["project", "project"], ["cycle", "cycle"], ["milestone", "milestone"], ["parent", "parentId"]
  ]
  for (const [flag, arg] of strings) {
    const value = readStringFlag(parsed.flags, flag)
    if (value !== undefined) {
      if (flag === "due-date" && !isCanonicalDate(value)) {
        throw new UsageError({ message: "--due-date must be a valid YYYY-MM-DD date", help: helpFor(parsed.command) })
      }
      input[arg] = value
    }
  }
  if (description !== undefined) input.description = description
  for (const [flag, arg] of [["priority", "priority"], ["estimate", "estimate"]] as const) {
    const value = readStringFlag(parsed.flags, flag)
    if (value !== undefined) {
      const number = Number(value)
      if (!Number.isFinite(number) || (flag === "priority" && (!Number.isInteger(number) || number < 0 || number > 4))) {
        throw new UsageError({ message: `--${flag} must be ${flag === "priority" ? "an integer from 0 to 4" : "a number"}`, help: helpFor(parsed.command) })
      }
      input[arg] = number
    }
  }
  if (labelsJson !== undefined) {
    input.labels = readStringArrayJson(labelsJson, "labels-json", parsed.command)
  } else {
    const label = readStringFlag(parsed.flags, "label")
    if (label !== undefined) input.labels = [label]
  }
  const releases = readStringFlag(parsed.flags, "releases-json") ?? readStringFlag(parsed.flags, "set-releases-json")
  if (releases !== undefined) input.setReleases = readStringArrayJson(releases, parsed.flags.has("releases-json") ? "releases-json" : "set-releases-json", parsed.command)
  for (const [flag, arg] of [["add-releases-json", "addReleases"], ["remove-releases-json", "removeReleases"]] as const) {
    const value = readStringFlag(parsed.flags, flag)
    if (value !== undefined) input[arg] = readStringArrayJson(value, flag, parsed.command)
  }
  const links = readStringFlag(parsed.flags, "links-json")
  if (links !== undefined) input.links = readLinkArrayJson(links, parsed.command)
  for (const [flag, arg] of [
    ["blocks-json", "blocks"], ["blocked-by-json", "blockedBy"], ["related-to-json", "relatedTo"],
    ["remove-blocks-json", "removeBlocks"], ["remove-blocked-by-json", "removeBlockedBy"], ["remove-related-to-json", "removeRelatedTo"]
  ] as const) {
    const value = readStringFlag(parsed.flags, flag)
    if (value !== undefined) input[arg] = readStringArrayJson(value, flag, parsed.command)
  }
  const duplicate = readStringFlag(parsed.flags, "duplicate-of")
  if (duplicate !== undefined) input.duplicateOf = duplicate
  const clears: ReadonlyArray<readonly [string, string, unknown]> = [
    ["clear-assignee", "assignee", null], ["clear-delegate", "delegate", null], ["clear-estimate", "estimate", null],
    ["clear-project", "project", null], ["clear-cycle", "cycle", null],
    ["clear-parent", "parentId", null], ["clear-labels", "labels", []], ["clear-duplicate", "duplicateOf", null]
  ]
  for (const [flag, arg, value] of clears) if (readBooleanFlag(parsed.flags, flag)) input[arg] = value
  return input
}

const resolveOfficialAssignableUserSelector = (
  gateway: LinearGateway,
  selector: string
): Effect.Effect<string, CliError> => Effect.gen(function*() {
  let user: Record<string, unknown>
  if (looksLikeUuid(selector) || selector === "me") {
    const result = yield* gateway.callOfficialTool("get_user", { query: selector })
    if (!Predicate.isObject(result) || !nonEmptyString(result.id) ||
      (selector !== "me" && !officialEntityMatchesSelector(result, selector, ["id", "email", "name", "displayName"]))) {
      return yield* officialShapeError("get_user identity")
    }
    user = result
  } else {
    const rows = yield* fetchOfficialRows(gateway, "list_users", { query: selector, limit: 100 }, "users")
    const normalized = selector.toLowerCase()
    const matches = rows.filter((candidate) =>
      [candidate.id, candidate.email, candidate.name, candidate.displayName].some((value) => typeof value === "string" && value.toLowerCase() === normalized))
    if (matches.length !== 1 || !nonEmptyString(matches[0]!.id)) {
      const candidates = matches.length > 0 ? matches : rows
      return yield* Effect.fail(new LinearDomainError({
        message: matches.length === 0 ? `No Linear user exactly matched ${selector}` : `Ambiguous or invalid Linear user selector ${selector}`,
        help: `Candidate ids: ${candidates.map((candidate) => String(candidate.id)).join(", ") || "none"}`
      }))
    }
    user = matches[0]!
  }
  if (!("archivedAt" in user) || typeof user.active !== "boolean" || typeof user.isAssignable !== "boolean") {
    return yield* officialShapeError("user assignability")
  }
  if (user.archivedAt != null || user.active !== true || user.isAssignable !== true) {
    return yield* Effect.fail(new LinearDomainError({
      message: `Linear user ${user.id} cannot be assigned issues`,
      help: "Choose an active, unarchived, assignable user."
    }))
  }
  return user.id as string
})

const resolveOfficialTeamSelector = (
  gateway: LinearGateway,
  selector: string
): Effect.Effect<string, CliError> => Effect.gen(function*() {
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(selector)) return selector
  const team = yield* gateway.callOfficialTool("get_team", { query: selector })
  if (!Predicate.isObject(team) || !nonEmptyString(team.id) || !officialEntityMatchesSelector(team, selector, ["id", "key", "name"])) {
    return yield* officialShapeError("get_team identity")
  }
  return team.id
})

const resolveOfficialIssueSelectors = (
  gateway: LinearGateway,
  input: Record<string, unknown>,
  team: string,
  current?: Readonly<Record<string, unknown>>
): Effect.Effect<void, CliError> => Effect.gen(function*() {
  if (typeof input.delegate === "string" && !looksLikeUuid(input.delegate)) {
    const selector = input.delegate
    const user = yield* gateway.callOfficialTool("get_user", { query: selector })
    if (!Predicate.isObject(user) || !nonEmptyString(user.id) || !officialEntityMatchesSelector(user, selector, ["id", "name", "email", "displayName"])) {
      return yield* officialShapeError("get_user identity")
    }
    input.delegate = user.id
  }
  if (typeof input.project === "string") {
    const selector = input.project
    const project = yield* gateway.callOfficialTool("get_project", { query: selector })
    if (!Predicate.isObject(project) || !nonEmptyString(project.id) || !officialEntityMatchesSelector(project, selector, ["id", "name", "slugId"])) {
      return yield* officialShapeError("get_project identity")
    }
    input.project = project.id
  }
  if (typeof input.parentId === "string") input.parentId = yield* resolveOfficialParentId(gateway, input.parentId, team)
  if (typeof input.cycle === "string" && !looksLikeUuid(input.cycle)) {
    const cycles = yield* gateway.callOfficialTool("list_cycles", { teamId: team })
    if (!Array.isArray(cycles) || cycles.some((cycle) => !Predicate.isObject(cycle))) return yield* officialShapeError("list_cycles")
    input.cycle = yield* uniqueOfficialId("cycle", input.cycle, cycles as ReadonlyArray<Record<string, unknown>>, ["id", "name", "number"])
  }
  if (typeof input.milestone === "string" && !looksLikeUuid(input.milestone)) {
    const project = input.project ?? referenceId(current?.project)
    if (typeof project !== "string") {
      return yield* Effect.fail(new LinearDomainError({
        message: "Milestone name resolution requires the issue project",
        help: "Pass --project with --milestone, or use a stable milestone UUID."
      }))
    }
    const selector = input.milestone
    const milestone = yield* gateway.callOfficialTool("get_milestone", { project, query: selector })
    if (!Predicate.isObject(milestone) || !nonEmptyString(milestone.id) || !officialEntityMatchesSelector(milestone, selector, ["id", "name"])) {
      return yield* officialShapeError("get_milestone identity")
    }
    input.milestone = milestone.id
  }
  if (Array.isArray(input.labels)) input.labels = uniqueStrings(yield* resolveOfficialLabels(gateway, input.labels, team))
  for (const key of ["setReleases", "addReleases", "removeReleases"] as const) {
    if (Array.isArray(input[key])) input[key] = uniqueStrings(yield* resolveOfficialReleases(gateway, input[key]))
  }
  for (const key of ["blocks", "blockedBy", "relatedTo", "removeBlocks", "removeBlockedBy", "removeRelatedTo"] as const) {
    if (Array.isArray(input[key])) {
      input[key] = uniqueStrings(yield* Effect.forEach(input[key], (selector) => resolveOfficialIssueId(gateway, String(selector))))
    }
  }
  if (typeof input.duplicateOf === "string") input.duplicateOf = yield* resolveOfficialIssueId(gateway, input.duplicateOf)
})

const resolveOfficialIssueId = (gateway: LinearGateway, selector: string): Effect.Effect<string, CliError> =>
  gateway.callOfficialTool("get_issue", { id: selector }).pipe(Effect.flatMap((issue) =>
    Predicate.isObject(issue) && nonEmptyString(issue.id) && officialEntityMatchesSelector(issue, selector, ["id", "identifier"])
      ? Effect.succeed(issue.id)
      : officialShapeError("get_issue identity")))

const resolveOfficialParentId = (
  gateway: LinearGateway,
  selector: string,
  team: string
): Effect.Effect<string, CliError> => Effect.gen(function*() {
  const issue = yield* gateway.callOfficialTool("get_issue", { id: selector })
  if (!Predicate.isObject(issue) || !nonEmptyString(issue.id) || !officialEntityMatchesSelector(issue, selector, ["id", "identifier"])) {
    return yield* officialShapeError("get_issue identity")
  }
  const parentTeam = officialTeamSelector(issue)
  if (!parentTeam) return yield* officialShapeError("get_issue team")
  if (!officialTextEqual(parentTeam, team)) {
    return yield* Effect.fail(new LinearDomainError({
      message: `parent ${selector} belongs to another team`,
      help: "Choose a parent from the issue's team."
    }))
  }
  return issue.id
})

const resolveOfficialLabels = (
  gateway: LinearGateway,
  selectors: ReadonlyArray<unknown>,
  team: string
): Effect.Effect<ReadonlyArray<string>, CliError> => Effect.gen(function*() {
  if (selectors.length === 0) return []
  const rows = yield* fetchOfficialRows(gateway, "list_issue_labels", { team, limit: 250 }, "labels")
  return yield* Effect.forEach(selectors, (raw) => uniqueOfficialId("label", String(raw), rows, ["id", "name"]))
})

const resolveOfficialReleases = (
  gateway: LinearGateway,
  selectors: ReadonlyArray<unknown>
): Effect.Effect<ReadonlyArray<string>, CliError> => Effect.gen(function*() {
  const result: Array<string> = []
  for (const raw of selectors) {
    const selector = String(raw)
    const rows = yield* fetchOfficialRows(gateway, "list_releases", { query: selector, limit: 250 }, "releases")
    result.push(yield* uniqueOfficialId("release", selector, rows, ["id", "name", "version", "slugId"]))
  }
  return result
})

const uniqueOfficialId = (
  noun: string,
  selector: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  keys: ReadonlyArray<string>
): Effect.Effect<string, LinearDomainError> => {
  const normalized = selector.toLowerCase()
  const matches = rows.filter((row) => keys.some((key) => String(row[key] ?? "").toLowerCase() === normalized))
  return matches.length === 1 && nonEmptyString(matches[0]!.id)
    ? Effect.succeed(matches[0]!.id)
    : Effect.fail(new LinearDomainError({
        message: matches.length === 0 ? `No ${noun} exactly matched ${selector}` : `Ambiguous ${noun} selector ${selector}`,
        help: `Candidate ids: ${(matches.length > 0 ? matches : rows).map((row) => String(row.id)).join(", ") || "none"}`
      }))
}

const looksLikeUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)
const referenceId = (value: unknown): string | undefined => Predicate.isObject(value) && typeof value.id === "string"
  ? value.id
  : typeof value === "string" ? value : undefined

const resolveOfficialStateSelector = (
  gateway: LinearGateway,
  team: string,
  selector: string
): Effect.Effect<string, CliError> => Effect.gen(function*() {
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(selector)) return selector
  const result = yield* gateway.callOfficialTool("list_issue_statuses", { team })
  if (!Array.isArray(result)) return yield* officialShapeError("list_issue_statuses")
  const normalized = selector.toLowerCase()
  const matches = result.filter(Predicate.isObject).filter((state) =>
    typeof state.name === "string" && state.name.toLowerCase() === normalized)
  if (matches.length !== 1 || !nonEmptyString(matches[0]!.id)) {
    return yield* Effect.fail(new LinearDomainError({
      message: matches.length === 0 ? `No workflow state exactly matched ${selector}` : `Ambiguous or invalid workflow state selector ${selector}`,
      help: `Candidate ids: ${matches.map((state) => String(state.id)).join(", ") || "none"}`
    }))
  }
  return matches[0]!.id
})

const officialTeamSelector = (issue: Record<string, unknown>): string | undefined => {
  if (typeof issue.teamId === "string") return issue.teamId
  if (typeof issue.team === "string") return issue.team
  if (Predicate.isObject(issue.team)) {
    const value = issue.team.id ?? issue.team.key ?? issue.team.name
    return typeof value === "string" ? value : undefined
  }
  return undefined
}

const officialIssueReadArgs = (id: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  id,
  ...(["setReleases", "addReleases", "removeReleases"].some((key) => input[key] !== undefined) ? { includeReleases: true } : {}),
  ...(["blocks", "blockedBy", "relatedTo", "removeBlocks", "removeBlockedBy", "removeRelatedTo", "duplicateOf"].some((key) => input[key] !== undefined) ? { includeRelations: true } : {})
})

const officialIssueSatisfies = (issue: Record<string, unknown>, input: Record<string, unknown>): boolean =>
  Object.entries(input).every(([key, desired]) => {
    if (key === "id" || key === "team") return key === "id" || officialReferenceMatches(issue.team ?? issue.teamId, desired)
    if (key === "links") return officialLinksContain(issue.attachments ?? issue.links, desired)
    if (key === "state") return officialReferenceMatches(issue.status ?? issue.state, desired)
    if (key === "parentId") return officialReferenceMatches(issue.parentId ?? issue.parent, desired)
    if (["blocks", "blockedBy", "relatedTo"].includes(key)) {
      return Predicate.isObject(issue.relations) && officialCollectionContains(issue.relations[key], desired)
    }
    if (["removeBlocks", "removeBlockedBy", "removeRelatedTo"].includes(key)) {
      const relationKey = key.slice("remove".length)
      const normalizedKey = `${relationKey.slice(0, 1).toLowerCase()}${relationKey.slice(1)}`
      return Predicate.isObject(issue.relations) && officialCollectionAbsent(issue.relations[normalizedKey], desired)
    }
    if (key === "duplicateOf") return Predicate.isObject(issue.relations) && "duplicateOf" in issue.relations
      ? officialReferenceMatches(issue.relations.duplicateOf, desired)
      : false
    if (key === "setReleases") return officialCollectionEqual(issue.releases, desired)
    if (key === "addReleases") return officialCollectionContains(issue.releases, desired)
    if (key === "removeReleases") return officialCollectionAbsent(issue.releases, desired)
    if (key === "labels") return officialCollectionEqual(issue.labels, desired)
    if (key === "description" && typeof issue[key] === "string" && typeof desired === "string") {
      return richTextEqual(issue[key], desired)
    }
    return OFFICIAL_ISSUE_REFERENCE_KEYS.has(key)
      ? officialReferenceMatches(issue[key], desired)
      : officialLiteralMatches(issue[key], desired)
  })

const OFFICIAL_ISSUE_REFERENCE_KEYS = new Set([
  "assignee", "delegate", "state", "project", "cycle", "milestone", "parentId"
])

const officialCollectionContains = (current: unknown, desired: unknown): boolean => officialCollectionMatches(current, desired, false)
const officialCollectionEqual = (current: unknown, desired: unknown): boolean => officialCollectionMatches(current, desired, true)
const officialCollectionAbsent = (current: unknown, desired: unknown): boolean => {
  if (!Array.isArray(current) || !Array.isArray(desired)) return false
  const references = officialCollectionReferences(current)
  return references.every((values) => values.length > 0) &&
    desired.every((value) => !references.some((values) => values.some((reference) => officialTextEqual(reference, String(value)))))
}
const officialCollectionMatches = (current: unknown, desired: unknown, exact: boolean): boolean => {
  if (!Array.isArray(current) || !Array.isArray(desired)) return false
  const entries = officialCollectionReferences(current).map((references) => ({
    key: references[0]?.toLowerCase(),
    references
  }))
  if (entries.some(({ key }) => key === undefined)) return false
  const currentKeys = new Set(entries.map(({ key }) => key as string))
  const desiredKeys = new Set<string>()
  for (const value of desired) {
    const matches = new Set(entries
      .filter(({ references }) => references.some((reference) => officialTextEqual(reference, String(value))))
      .map(({ key }) => key as string))
    if (matches.size !== 1) return false
    desiredKeys.add([...matches][0]!)
  }
  return !exact || desiredKeys.size === currentKeys.size
}
const officialCollectionReferences = (value: unknown): ReadonlyArray<ReadonlyArray<string>> => Array.isArray(value)
  ? value.map((item) => Predicate.isObject(item)
      ? [item.id, item.identifier, item.name, item.version, item.slugId]
          .filter((reference): reference is string => nonEmptyString(reference))
      : nonEmptyString(item) || typeof item === "number" ? [String(item)] : [])
  : []
const officialLinksContain = (current: unknown, desired: unknown): boolean => Array.isArray(current) && Array.isArray(desired) &&
  desired.every((link) => Predicate.isObject(link) && typeof link.url === "string" && typeof link.title === "string" &&
    current.some((attachment) => Predicate.isObject(attachment) && attachment.url === link.url && attachment.title === link.title))

const officialReferenceMatches = (current: unknown, desired: unknown): boolean => {
  if (desired === null) return current === null || current === undefined
  if (Predicate.isObject(current)) return [current.id, current.identifier, current.key, current.name, current.email, current.displayName, current.slugId, current.version]
    .some((value) => typeof value === "string" && officialTextEqual(value, String(desired)))
  return typeof current === "string" && typeof desired === "string"
    ? officialTextEqual(current, desired)
    : current === desired
}
const officialLiteralMatches = (current: unknown, desired: unknown): boolean =>
  desired === null ? current === null || current === undefined : current === desired

const officialEntityMatchesSelector = (
  entity: Readonly<Record<string, unknown>>,
  selector: string,
  keys: ReadonlyArray<string> = ["id", "identifier"]
): boolean => keys.some((key) => typeof entity[key] === "string" && officialTextEqual(entity[key], selector))

const officialIssueIdentity = (issue: Readonly<Record<string, unknown>>): string | undefined =>
  nonEmptyString(issue.id) ? issue.id : nonEmptyString(issue.identifier) ? issue.identifier : undefined

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0

const officialTextEqual = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase()
const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)]

const labelsList = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const workspace = readBooleanFlag(parsed.flags, "workspace")
  const team = readStringFlag(parsed.flags, "team")
  const issue = readStringFlag(parsed.flags, "issue")
  if (workspace && team) {
    return usage("--workspace and --team are mutually exclusive", parsed.command)
  }
  if (issue && (workspace || team)) {
    return usage("--issue cannot be combined with --workspace or --team", parsed.command)
  }
  const after = readStringFlag(parsed.flags, "after")
  if (issue && readStringFlag(parsed.flags, "name") && after !== undefined && decodeLocalCursorOffset(after, "label") === undefined) {
    return usage("invalid label cursor", parsed.command)
  }
  const fields = readFields(parsed, "fields", LABEL_FIELD_SET, DEFAULT_LABEL_FIELDS)
  return gateway.listLabels({
    limit: readLimitFlag(parsed.flags, 100),
    after,
    workspace,
    team,
    name: readStringFlag(parsed.flags, "name"),
    issue,
    includeArchived: readBooleanFlag(parsed.flags, "include-archived"),
    fields
  }).pipe(Effect.map((result) => ({
    count: `${result.items.length} labels shown`,
    page: result.page,
    ...(result.items.length === 0
      ? { labels: "0 labels matched the requested scope and name" }
      : { labels: result.items.map((label) => projectLabel(label, fields)) }),
    help: result.page.hasNext && result.page.endCursor
      ? [continuationCommand("labels list", parsed, result.page.endCursor)]
      : []
  })))
}

const labelsCreate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const workspace = readBooleanFlag(parsed.flags, "workspace")
  const team = readStringFlag(parsed.flags, "team")
  if (workspace === (team !== undefined)) {
    return usage("exactly one of --workspace or --team is required", parsed.command)
  }
  const color = readStringFlag(parsed.flags, "color")!
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    return usage("--color must use #RRGGBB", parsed.command)
  }
  const id = readStringFlag(parsed.flags, "id")
  if (id && !isUuidV4(id)) {
    return usage("--id must be a UUID v4", parsed.command)
  }
  return gateway.createLabel({
    name: readStringFlag(parsed.flags, "name")!,
    color,
    workspace,
    team,
    description: readStringFlag(parsed.flags, "description"),
    id,
    ifAbsent: readBooleanFlag(parsed.flags, "if-absent"),
    ...(readBooleanFlag(parsed.flags, "group") ? { isGroup: true } : {}),
    ...(readStringFlag(parsed.flags, "parent") ? { parent: readStringFlag(parsed.flags, "parent") } : {})
  }).pipe(Effect.map((result) => ({ label: result.value, changed: result.changed, result: result.result })))
}

const labelsApply = (parsed: ParsedArgs, gateway: LinearGateway) =>
  gateway.applyLabel({
    issue: readStringFlag(parsed.flags, "issue")!,
    label: readStringFlag(parsed.flags, "label")!
  }).pipe(Effect.map(issueMutationOutput))

const labelsRemove = (parsed: ParsedArgs, gateway: LinearGateway) =>
  gateway.removeLabel({
    issue: readStringFlag(parsed.flags, "issue")!,
    label: readStringFlag(parsed.flags, "label")!
  }).pipe(Effect.map(issueMutationOutput))

const labelsReplace = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const labels = readStringArrayJson(readStringFlag(parsed.flags, "labels-json")!, "labels-json", parsed.command)
  return gateway.replaceLabels({ issue: readStringFlag(parsed.flags, "issue")!, labels }).pipe(Effect.map(issueMutationOutput))
}

const relationsList = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const blockedBy = readBooleanFlag(parsed.flags, "blocked-by")
  const blockedIssue = readStringFlag(parsed.flags, "issue")!
  if (blockedBy && (parsed.flags.has("type") || parsed.flags.has("direction"))) {
    return usage("--blocked-by must not combine with --type or --direction", parsed.command)
  }
  const type = (blockedBy ? "blocks" : readStringFlag(parsed.flags, "type")) as RelationType | undefined
  const direction = blockedBy ? "incoming" : (readStringFlag(parsed.flags, "direction") ?? "both")
  if (type && !RELATION_TYPES.has(type)) {
    return usage("--type must be blocks, related, duplicate, or similar", parsed.command)
  }
  if (!RELATION_DIRECTIONS.has(direction)) {
    return usage("--direction must be outgoing, incoming, or both", parsed.command)
  }
  const after = readStringFlag(parsed.flags, "after")
  if (after !== undefined && decodeLocalCursorOffset(after, "relation") === undefined) {
    return usage("invalid relation cursor", parsed.command)
  }
  return gateway.listRelations({
    issue: blockedIssue,
    type,
    direction: direction as RelationDirection | "both",
    after,
    limit: readLimitFlag(parsed.flags, 100)
  }).pipe(Effect.map((result) => ({
    count: `${result.items.length} relations shown`,
    page: result.page,
    ...(result.items.length === 0
      ? { relations: blockedBy ? `0 blockers found for ${blockedIssue}` : "0 relations matched this issue and direction" }
      : {
          relations: blockedBy
            ? result.items.map(({ identifier, ...relation }) => ({ ...relation, blockerIssue: identifier }))
            : result.items
        }),
    ...(blockedBy ? { blockedIssue } : {}),
    help: result.page.hasNext && result.page.endCursor
      ? [continuationCommand("relations list", parsed, result.page.endCursor)]
      : []
  })))
}

const relationsCreate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const blockedIssue = readStringFlag(parsed.flags, "issue")!
  const blockerIssue = readStringFlag(parsed.flags, "blocked-by")
  if (blockerIssue !== undefined && (parsed.flags.has("related-issue") || parsed.flags.has("type"))) {
    return usage("--blocked-by must not combine with --related-issue or --type", parsed.command)
  }
  if (blockerIssue === undefined && !parsed.flags.has("related-issue")) {
    return usage("--related-issue is required unless --blocked-by is used", parsed.command)
  }
  if (blockerIssue === undefined && !parsed.flags.has("type")) {
    return usage("--type is required unless --blocked-by is used", parsed.command)
  }
  const type = (blockerIssue === undefined ? readStringFlag(parsed.flags, "type") : "blocks") as RelationType
  if (!RELATION_TYPES.has(type)) {
    return usage("--type must be blocks, related, duplicate, or similar", parsed.command)
  }
  const relationSource = blockerIssue ?? blockedIssue
  const relationTarget = blockerIssue === undefined ? readStringFlag(parsed.flags, "related-issue")! : blockedIssue
  const id = readStringFlag(parsed.flags, "id")
  if (id && !isUuidV4(id)) {
    return usage("--id must be a UUID v4", parsed.command)
  }
  return gateway.createRelation({
    issue: relationSource,
    relatedIssue: relationTarget,
    type,
    id
  }).pipe(Effect.map((result) => ({
    relation: result.value,
    changed: result.changed,
    result: result.result,
    ...(blockerIssue === undefined ? {} : { blockedIssue, blockerIssue })
  })))
}

const relationsRemove = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const id = readStringFlag(parsed.flags, "id")
  const issue = readStringFlag(parsed.flags, "issue")
  const blockedBy = readStringFlag(parsed.flags, "blocked-by")
  const relatedIssue = readStringFlag(parsed.flags, "related-issue")
  const type = readStringFlag(parsed.flags, "type")
  if (id) {
    if (issue || blockedBy || relatedIssue || type) {
      return usage("--id must not be combined with relation tuple flags", parsed.command)
    }
    if (!isUuidV4(id)) {
      return usage("--id must be a UUID v4", parsed.command)
    }
    return gateway.removeRelation({ id }).pipe(Effect.map(relationRemovalOutput))
  }
  if (blockedBy) {
    if (!issue || relatedIssue || type) {
      return usage("--blocked-by requires --issue and must not combine with --related-issue or --type", parsed.command)
    }
    return gateway.removeRelation({ issue: blockedBy, relatedIssue: issue, type: "blocks" }).pipe(Effect.map(relationRemovalOutput))
  }
  if (!issue || !relatedIssue || !type || !RELATION_TYPES.has(type as RelationType)) {
    return usage("pass --id, or pass --issue, --related-issue, and a valid --type", parsed.command)
  }
  return gateway.removeRelation({ issue, relatedIssue, type: type as RelationType }).pipe(Effect.map(relationRemovalOutput))
}

const relationRemovalOutput = (result: { value: unknown; changed: boolean; result: string }): OutputValue => ({
  relation: result.value as OutputValue,
  changed: result.changed,
  result: result.result
})

const commentsList = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const full = readBooleanFlag(parsed.flags, "full")
  return gateway.listComments({
    issue: readStringFlag(parsed.flags, "issue")!,
    after: readStringFlag(parsed.flags, "after"),
    limit: readLimitFlag(parsed.flags, 50)
  }).pipe(Effect.map((result) => {
    let truncated = false
    const comments = result.items.map((comment) => {
      const body = truncateText(comment.body, 500, full)
      truncated ||= body.truncated
      return {
        id: comment.id,
        createdAt: comment.createdAt,
        author: comment.author,
        body: body.truncated ? `${body.text} (truncated, ${body.total} chars total)` : body.text
      }
    })
    const help = [
      ...(truncated ? [`Run \`${replayCommand("comments list", parsed, { full: true })}\` for complete bodies.`] : []),
      ...(result.page.hasNext && result.page.endCursor ? [continuationCommand("comments list", parsed, result.page.endCursor)] : [])
    ]
    return {
      count: `${comments.length} comments shown`,
      page: result.page,
      ...(comments.length === 0 ? { comments: "0 comments found for this issue" } : { comments }),
      help
    }
  }))
}

const commentsCreate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const body = readStringFlag(parsed.flags, "body")
  const bodyFile = readStringFlag(parsed.flags, "body-file")
  if ((body === undefined) === (bodyFile === undefined)) {
    return usage("exactly one of --body or --body-file is required", parsed.command)
  }
  const id = readStringFlag(parsed.flags, "id")
  if (id && !isUuidV4(id)) {
    return usage("--id must be a UUID v4", parsed.command)
  }
  return readOptionalText(body, bodyFile, "body-file", parsed.command).pipe(
    Effect.flatMap((text) => gateway.createComment({
      issue: readStringFlag(parsed.flags, "issue")!,
      body: text!,
      id
    })),
    Effect.map((result) => ({ comment: result.value, changed: result.changed, result: result.result }))
  )
}

const wayfinderFrontier = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const map = readStringFlag(parsed.flags, "map")!
  const firstFlag = readStringFlag(parsed.flags, "first")
  const limitFlag = readStringFlag(parsed.flags, "limit")
  if (firstFlag !== undefined && limitFlag !== undefined) {
    return usage("--first and --limit are mutually exclusive", parsed.command)
  }
  const after = readStringFlag(parsed.flags, "after")
  if (after !== undefined) {
    try {
      validateFrontierCursor(after)
    } catch {
      return usage("--after is not a valid frontier cursor", parsed.command)
    }
  }
  const first = firstFlag === undefined ? readLimitFlag(parsed.flags, 20) : Number(firstFlag)
  return gateway.frontier({ map, first, after }).pipe(Effect.map((result) => ({
    map: result.map,
    count: `${result.items.length} of ${result.total} current frontier issues shown`,
    pageInfo: result.pageInfo,
    ...(result.items.length === 0
      ? {
          frontier: after
            ? `0 frontier issues found after the supplied cursor for ${result.map.identifier}`
            : `0 open, unblocked, unassigned children found for ${result.map.identifier}`,
          help: []
        }
      : {
          frontier: result.items,
          help: [
            `Run \`linear-axi issues assign --id ${result.items[0]!.identifier} --assignee me\` to claim the first frontier issue.`,
            ...(result.pageInfo.hasNextPage && result.pageInfo.endCursor
              ? [continuationCommand("wayfinder frontier", parsed, result.pageInfo.endCursor)]
              : [])
          ]
        })
  })))
}

const authOAuthConnect = (
  parsed: ParsedArgs,
  env: Env,
  credentialPathEnv: Env,
  defaults: { openBrowser?: boolean; promptConsent?: boolean; writeEnv?: boolean } = {}
) => {
  const timeout = readStringFlag(parsed.flags, "timeout")
  if (timeout !== undefined && (!/^[0-9]+$/.test(timeout) || Number(timeout) < 30 || Number(timeout) > 3600)) {
    return usage("--timeout must be an integer between 30 and 3600 seconds", parsed.command)
  }
  return connectOAuth({
    env,
    credentialPathEnv,
    cwd: process.cwd(),
    clientId: readStringFlag(parsed.flags, "client-id"),
    redirectUri: readStringFlag(parsed.flags, "redirect-uri"),
    scope: readStringFlag(parsed.flags, "scope"),
    actor: readStringFlag(parsed.flags, "actor"),
    promptConsent: readBooleanFlag(parsed.flags, "prompt-consent") || defaults.promptConsent === true,
    notify: readBooleanFlag(parsed.flags, "notify"),
    openBrowser: defaults.openBrowser === true && !readBooleanFlag(parsed.flags, "no-open"),
    writeEnv: readBooleanFlag(parsed.flags, "write-env") || defaults.writeEnv === true,
    envFile: readStringFlag(parsed.flags, "env-file"),
    timeoutSeconds: timeout === undefined ? undefined : Number(timeout)
  })
}

const authOAuthSetup = (parsed: ParsedArgs, env: Env) => setupOAuth({
  env,
  redirectUri: readStringFlag(parsed.flags, "redirect-uri"),
  scope: readStringFlag(parsed.flags, "scope"),
  actor: readStringFlag(parsed.flags, "actor"),
  notify: readBooleanFlag(parsed.flags, "notify")
})

const readOptionalText = (
  inline: string | undefined,
  file: string | undefined,
  flag: string,
  command: ReadonlyArray<string>
): Effect.Effect<string | undefined, UsageError> =>
  file === undefined ? Effect.succeed(inline) : readRequiredText(file, flag, command)

const readRequiredText = (
  file: string,
  flag: string,
  command: ReadonlyArray<string>
): Effect.Effect<string, UsageError> =>
  Effect.tryPromise({
    try: () => file === "-" ? Bun.stdin.text() : Bun.file(file).text(),
    catch: () => new UsageError({ message: `could not read --${flag} ${file}`, help: helpFor(command) })
  })

const validateAssignee = (
  value: string | undefined,
  flag: "assignee" | "if-assignee",
  allowNone: boolean,
  help: string
): void => {
  if (value === undefined || value === "me" || (allowNone && value === "none") || value.trim().length > 0) {
    return
  }
  throw new UsageError({ message: `--${flag} requires a user id, email, display name, or ${allowNone ? "me|none" : "me"}`, help })
}

const readFields = (
  parsed: ParsedArgs,
  flag: string,
  allowed: ReadonlySet<string>,
  defaults: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const raw = readStringFlag(parsed.flags, flag)
  if (raw === undefined) {
    return defaults
  }
  const fields = raw.split(",")
  const invalid = fields.filter((field) => field.length === 0 || !allowed.has(field))
  if (invalid.length > 0) {
    throw new UsageError({
      message: `--${flag} contains unsupported fields: ${invalid.join(", ")}`,
      help: helpFor(parsed.command)
    })
  }
  return [...new Set(fields)]
}

const readStringArrayJson = (
  value: string,
  flag: string,
  command: ReadonlyArray<string>
): ReadonlyArray<string> => {
  let decoded: unknown
  try {
    decoded = decodeStringArray(value)
  } catch {
    throw new UsageError({ message: `--${flag} must be a JSON string array`, help: helpFor(command) })
  }
  return decoded as ReadonlyArray<string>
}

const readLinkArrayJson = (value: string, command: ReadonlyArray<string>): ReadonlyArray<{ readonly url: string; readonly title: string }> => {
  let decoded: unknown
  try {
    decoded = decodeLinkArray(value)
  } catch {
    throw new UsageError({ message: "--links-json must be a JSON array of {url,title} objects", help: helpFor(command) })
  }
  return decoded as ReadonlyArray<{ readonly url: string; readonly title: string }>
}

const projectIssue = (issue: IssueSummary, fields: ReadonlyArray<string>): Record<string, unknown> =>
  Object.fromEntries(fields.map((field) => [field, issueField(issue, field)]))

const issueField = (issue: IssueSummary, field: string): unknown => {
  switch (field) {
    case "labels": return issue.labels.map((label) => label.name)
    case "assignee": return issue.assignee
    case "parent": return issue.parent
    default: return issue[field as keyof IssueSummary]
  }
}

const projectLabel = (label: LabelSummary, fields: ReadonlyArray<string>): Record<string, unknown> =>
  Object.fromEntries(fields.map((field) => [field, label[field as keyof LabelSummary]]))

const issueMutationOutput = (result: { value: IssueSummary; changed: boolean; result: string }): OutputValue => ({
  issue: result.value,
  changed: result.changed,
  result: result.result
})

const continuationCommand = (command: string, parsed: ParsedArgs, cursor: string): string =>
  `Run \`${replayCommand(command, parsed, { after: cursor })}\` for the next page.`

const replayCommand = (
  command: string,
  parsed: ParsedArgs,
  overrides: Readonly<Record<string, string | boolean | undefined>> = {}
): string => {
  const replayed = new Map(parsed.flags)
  replayed.delete("help")
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      replayed.delete(name)
    } else {
      replayed.set(name, value)
    }
  }
  const flags = [...replayed.entries()]
    .map(([name, value]) => value === true ? `--${name}` : `--${name} ${shellQuote(String(value))}`)
  return `linear-axi ${command}${flags.length ? ` ${flags.join(" ")}` : ""}`
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`

const fetchOfficialRows = Effect.fn("fetchOfficialRows")(function*(
  gateway: LinearGateway,
  tool: string,
  args: Readonly<Record<string, unknown>>,
  key: string
): Effect.fn.Return<ReadonlyArray<Record<string, unknown>>, CliError> {
  const rows: Array<Record<string, unknown>> = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  do {
    const page = yield* gateway.callOfficialTool(tool, { ...args, ...(cursor === undefined ? {} : { cursor }) })
    rows.push(...officialRows(page, key))
    pages += 1
    if (!Predicate.isObject(page) || typeof page.hasNextPage !== "boolean") {
      return yield* officialShapeError(`${tool} pagination`)
    }
    if (page.hasNextPage !== true) return rows
    if (pages >= MAX_OFFICIAL_PAGES) {
      return yield* Effect.fail(new LinearDomainError({
        message: `Official Linear MCP ${tool} pagination exceeded the ${MAX_OFFICIAL_PAGES}-page safety limit`,
        help: "Narrow the selector and retry."
      }))
    }
    if (typeof page.cursor !== "string" || page.cursor.trim().length === 0) return yield* officialShapeError(`${tool} cursor`)
    if (seenCursors.has(page.cursor)) {
      return yield* Effect.fail(new LinearDomainError({
        message: `Official Linear MCP ${tool} pagination cursor did not advance`,
        help: "Retry after Linear pagination recovers."
      }))
    }
    seenCursors.add(page.cursor)
    cursor = page.cursor
  } while (cursor !== undefined)
  return rows
})

const officialRows = (value: unknown, key: string): ReadonlyArray<Record<string, unknown>> => {
  if (!Predicate.isObject(value) || !Array.isArray(value[key])) {
    throw new LinearDomainError({
      message: `Official Linear MCP output shape drifted: expected ${key} to be an array`,
      help: "Refresh the frozen parity inventory and update linear-axi before retrying."
    })
  }
  if (value[key].some((row) => !Predicate.isObject(row))) {
    throw new LinearDomainError({
      message: `Official Linear MCP output shape drifted: expected every ${key} row to be an object`,
      help: "Refresh the frozen parity inventory and update linear-axi before retrying."
    })
  }
  return value[key] as ReadonlyArray<Record<string, unknown>>
}

const officialShapeError = (tool: string): Effect.Effect<never, LinearDomainError> =>
  Effect.fail(new LinearDomainError({
    message: `Official Linear MCP output shape drifted for ${tool}: expected an object result`,
    help: "Refresh the frozen parity inventory and update linear-axi before retrying."
  }))

const usage = (message: string, command: ReadonlyArray<string>): Effect.Effect<never, UsageError> =>
  Effect.fail(new UsageError({ message, help: helpFor(command) }))

const helpFor = (path: ReadonlyArray<string>): string => findSpec(path, commandSpecs)?.help ?? topLevelHelp

const isUuidV4 = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const collapseHome = (path: string): string => {
  const home = process.env.HOME
  if (!home) return path
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
