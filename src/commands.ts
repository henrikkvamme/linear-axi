import { Effect } from "effect"
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
import { validateFrontierCursor } from "./wayfinder"

const ISSUE_FIELD_SET: ReadonlySet<string> = new Set(ISSUE_FIELDS)
const LABEL_FIELD_SET: ReadonlySet<string> = new Set(LABEL_FIELDS)
const RELATION_TYPES = new Set<RelationType>(["blocks", "related", "duplicate", "similar"])
const RELATION_DIRECTIONS = new Set(["outgoing", "incoming", "both"])

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
    case "issues list": return issuesList(parsed, gateway)
    case "issues view": return issuesView(parsed, gateway)
    case "issues create": return issuesCreate(parsed, gateway)
    case "issues assign": return issuesAssign(parsed, gateway)
    case "issues unassign": return issuesUnassign(parsed, gateway)
    case "issues close": return issuesClose(parsed, gateway)
    case "issues update": return issuesUpdate(parsed, gateway)
    case "labels list": return labelsList(parsed, gateway)
    case "labels create": return labelsCreate(parsed, gateway)
    case "labels apply": return labelsApply(parsed, gateway)
    case "relations list": return relationsList(parsed, gateway)
    case "relations create": return relationsCreate(parsed, gateway)
    case "comments list": return commentsList(parsed, gateway)
    case "comments create": return commentsCreate(parsed, gateway)
    case "wayfinder frontier": return wayfinderFrontier(parsed, gateway)
    default: return Effect.fail(new UsageError({ message: `unknown command ${path}`, help: topLevelHelp }))
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

const issuesList = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const assignee = readStringFlag(parsed.flags, "assignee")
  const state = readStringFlag(parsed.flags, "state")
  validateAssignee(assignee, true, helpFor(parsed.command))
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
  return readOptionalText(description, descriptionFile, "description-file", parsed.command).pipe(
    Effect.flatMap((body) => gateway.createIssue({
      team: readStringFlag(parsed.flags, "team")!,
      title: readStringFlag(parsed.flags, "title")!,
      description: body,
      parent: readStringFlag(parsed.flags, "parent"),
      label: readStringFlag(parsed.flags, "label"),
      id
    })),
    Effect.map((result) => ({
      issue: result.value,
      changed: result.changed,
      result: result.result,
      help: result.changed ? [`Run \`linear-axi issues view --id ${result.value.identifier}\` for details.`] : []
    }))
  )
}

const issuesAssign = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const assignee = readStringFlag(parsed.flags, "assignee")!
  validateAssignee(assignee, false, helpFor(parsed.command))
  return gateway.assignIssue({
    id: readStringFlag(parsed.flags, "id")!,
    assignee,
    replace: readBooleanFlag(parsed.flags, "replace")
  }).pipe(Effect.map(issueMutationOutput))
}

const issuesUnassign = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const expected = readStringFlag(parsed.flags, "if-assignee")
  validateAssignee(expected, false, helpFor(parsed.command))
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

const issuesUpdate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const timestamp = readStringFlag(parsed.flags, "if-updated-at")!
  if (!isRfc3339(timestamp)) {
    return usage("--if-updated-at must be an RFC3339 timestamp", parsed.command)
  }
  return readRequiredText(readStringFlag(parsed.flags, "description-file")!, "description-file", parsed.command).pipe(
    Effect.flatMap((description) => gateway.updateIssueDescription({
      id: readStringFlag(parsed.flags, "id")!,
      description,
      ifUpdatedAt: timestamp
    })),
    Effect.map((result) => ({
      issue: result.value,
      changed: result.changed,
      result: result.result,
      concurrency: DESCRIPTION_CONCURRENCY_WARNING
    }))
  )
}

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
    includeArchived: readBooleanFlag(parsed.flags, "include-archived")
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
    ifAbsent: readBooleanFlag(parsed.flags, "if-absent")
  }).pipe(Effect.map((result) => ({ label: result.value, changed: result.changed, result: result.result })))
}

const labelsApply = (parsed: ParsedArgs, gateway: LinearGateway) =>
  gateway.applyLabel({
    issue: readStringFlag(parsed.flags, "issue")!,
    label: readStringFlag(parsed.flags, "label")!
  }).pipe(Effect.map(issueMutationOutput))

const relationsList = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const type = readStringFlag(parsed.flags, "type") as RelationType | undefined
  const direction = readStringFlag(parsed.flags, "direction") ?? "both"
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
    issue: readStringFlag(parsed.flags, "issue")!,
    type,
    direction: direction as RelationDirection | "both",
    after,
    limit: readLimitFlag(parsed.flags, 100)
  }).pipe(Effect.map((result) => ({
    count: `${result.items.length} relations shown`,
    page: result.page,
    ...(result.items.length === 0 ? { relations: "0 relations matched this issue and direction" } : { relations: result.items }),
    help: result.page.hasNext && result.page.endCursor
      ? [continuationCommand("relations list", parsed, result.page.endCursor)]
      : []
  })))
}

const relationsCreate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const type = readStringFlag(parsed.flags, "type") as RelationType
  if (!RELATION_TYPES.has(type)) {
    return usage("--type must be blocks, related, duplicate, or similar", parsed.command)
  }
  const id = readStringFlag(parsed.flags, "id")
  if (id && !isUuidV4(id)) {
    return usage("--id must be a UUID v4", parsed.command)
  }
  return gateway.createRelation({
    issue: readStringFlag(parsed.flags, "issue")!,
    relatedIssue: readStringFlag(parsed.flags, "related-issue")!,
    type,
    id
  }).pipe(Effect.map((result) => ({ relation: result.value, changed: result.changed, result: result.result })))
}

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

const validateAssignee = (value: string | undefined, allowNone: boolean, help: string): void => {
  if (value === undefined || value === "me" || (allowNone && value === "none") || isUuidV4(value)) {
    return
  }
  throw new UsageError({ message: `--assignee must be ${allowNone ? "me, none, or" : "me or"} a user UUID`, help })
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

const usage = (message: string, command: ReadonlyArray<string>): Effect.Effect<never, UsageError> =>
  Effect.fail(new UsageError({ message, help: helpFor(command) }))

const helpFor = (path: ReadonlyArray<string>): string => findSpec(path, commandSpecs)?.help ?? topLevelHelp

const isUuidV4 = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const isRfc3339 = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))

const collapseHome = (path: string): string => {
  const home = process.env.HOME
  if (!home) return path
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
