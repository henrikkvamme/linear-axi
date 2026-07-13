import {
  IssueRelationType,
  LinearClient,
  PaginationOrderBy,
  PaginationSortOrder,
  type Comment,
  type Issue,
  type IssueLabel,
  type IssueRelation,
  type Team
} from "@linear/sdk"
import { Effect } from "effect"
import { AuthError, LinearApiError, LinearDomainError } from "./errors"
import type {
  ApplyLabelInput,
  AssignIssueInput,
  AuthStatus,
  CloseIssueInput,
  CommentSummary,
  CreateCommentInput,
  CreateIssueInput,
  CreateLabelInput,
  CreateRelationInput,
  Credentials,
  FrontierResult,
  GatewayError,
  IssueDetail,
  IssueSummary,
  LabelSummary,
  LinearGateway,
  ListCommentsInput,
  ListIssuesInput,
  ListLabelsInput,
  ListRelationsInput,
  MutationResult,
  PageResult,
  RelationDirection,
  RelationSummary,
  RelationType,
  TeamSummary,
  UnassignIssueInput,
  UpdateIssueDescriptionInput
} from "./linear"
import { fetchAllPages, type ConnectionLike } from "./linear-pagination"
import {
  completedStates,
  findIssueByUuid,
  findLabelsInScope,
  resolveIssue,
  resolveLabelForTeam,
  resolveLabelGlobally,
  resolveLabelInScope,
  resolveTeam,
  resolveUser,
  resolveWorkflowState
} from "./linear-resolve"
import { projectFrontier, resolveWayfinderPrefix, WAYFINDER_TYPES, type WayfinderType } from "./wayfinder"

const TERMINAL_STATE_TYPES = ["completed", "canceled", "duplicate"]

export const makeSdkLinearGateway = (
  credentials: Credentials | undefined,
  options: { readonly client?: LinearClient } = {}
): LinearGateway => {
  const getClient = (): Effect.Effect<LinearClient, AuthError> => {
    if (options.client) {
      return Effect.succeed(options.client)
    }
    if (!credentials) {
      return Effect.fail(new AuthError({
        message: "Linear credentials are not configured",
        help: "Run `linear-axi auth login` or set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN."
      }))
    }

    return Effect.succeed(
      credentials.kind === "apiKey"
        ? new LinearClient({ apiKey: credentials.value })
        : new LinearClient({ accessToken: credentials.value })
    )
  }

  const call = <Value>(name: string, run: (client: LinearClient) => Promise<Value>): Effect.Effect<Value, GatewayError> =>
    Effect.gen(function*() {
      const client = yield* getClient()
      return yield* Effect.tryPromise({
        try: () => run(client),
        catch: (cause) => {
          if (cause instanceof LinearDomainError) {
            return cause
          }
          return new LinearApiError({
            message: readableError(cause),
            help: `Retry \`linear-axi ${name}\` after checking Linear access.`
          })
        }
      })
    })

  return {
    authStatus: () =>
      credentials === undefined && !options.client
        ? Effect.succeed({ authenticated: false, method: "none" })
        : call("auth status", async (client): Promise<AuthStatus> => {
            const viewer = await client.viewer
            return {
              authenticated: true,
              method: credentials?.kind ?? "apiKey",
              viewer: { id: viewer.id, name: viewer.name }
            }
          }),

    listTeams: (limit) =>
      call("teams list", async (client) => {
        const teams = await client.teams({ first: limit })
        return teams.nodes.map(teamSummary)
      }),

    listIssues: (input) => call("issues list", (client) => listIssues(client, input)),
    viewIssue: (id) => call("issues view", async (client) => issueDetail(await resolveIssue(client, id))),
    createIssue: (input) => call("issues create", (client) => createIssue(client, input)),
    assignIssue: (input) => call("issues assign", (client) => assignIssue(client, input)),
    unassignIssue: (input) => call("issues unassign", (client) => unassignIssue(client, input)),
    closeIssue: (input) => call("issues close", (client) => closeIssue(client, input)),
    updateIssueDescription: (input) => call("issues update", (client) => updateIssueDescription(client, input)),
    listLabels: (input) => call("labels list", (client) => listLabels(client, input)),
    createLabel: (input) => call("labels create", (client) => createLabel(client, input)),
    applyLabel: (input) => call("labels apply", (client) => applyLabel(client, input)),
    listRelations: (input) => call("relations list", (client) => listRelations(client, input)),
    createRelation: (input) => call("relations create", (client) => createRelation(client, input)),
    listComments: (input) => call("comments list", (client) => listComments(client, input)),
    createComment: (input) => call("comments create", (client) => createComment(client, input)),
    frontier: (input) => call("wayfinder frontier", (client) => frontier(client, input.map, input.limit))
  }
}

const listIssues = async (client: LinearClient, input: ListIssuesInput): Promise<PageResult<IssueSummary>> => {
  const team = input.team ? await resolveTeam(client, input.team) : undefined
  const parent = input.parent ? await resolveIssue(client, input.parent) : undefined
  const label = input.label
    ? team
      ? await resolveLabelForTeam(client, input.label, team.id)
      : await resolveLabelGlobally(client, input.label)
    : undefined
  const assignee = input.assignee && input.assignee !== "none"
    ? await resolveUser(client, input.assignee)
    : undefined

  const connection = await client.issues({
    first: input.limit,
    after: input.after,
    includeArchived: false,
    filter: {
      ...(team ? { team: { id: { eq: team.id } } } : {}),
      ...(parent ? { parent: { id: { eq: parent.id } } } : {}),
      ...(label ? { labels: { some: { id: { eq: label.id } } } } : {}),
      ...(input.assignee === "none"
        ? { assignee: { null: true } }
        : assignee
          ? { assignee: { id: { eq: assignee.id } } }
          : {}),
      ...(input.state === "open"
        ? { state: { type: { nin: TERMINAL_STATE_TYPES } } }
        : input.state === "closed"
          ? { state: { type: { in: TERMINAL_STATE_TYPES } } }
          : {})
    }
  })
  return pageResult(connection, await Promise.all(connection.nodes.map((issue) => issueSummary(issue))))
}

const createIssue = async (
  client: LinearClient,
  input: CreateIssueInput
): Promise<MutationResult<IssueSummary>> => {
  const team = await resolveTeam(client, input.team)
  const parent = input.parent ? await resolveIssue(client, input.parent) : undefined
  const label = input.label ? await resolveLabelForTeam(client, input.label, team.id) : undefined
  if (parent && parent.teamId !== team.id) {
    throw conflict(`parent ${parent.identifier} belongs to another team`, "Use the parent's team when creating a child issue.")
  }

  const classifyExisting = async (existing: Issue): Promise<MutationResult<IssueSummary>> => {
    const detail = await issueDetail(existing)
    const matches = detail.teamId === team.id &&
      detail.title === input.title &&
      detail.description === (input.description ?? "") &&
      detail.parentId === (parent?.id ?? null) &&
      (label === undefined || detail.labels.some((existingLabel) => existingLabel.id === label.id))
    if (!matches) {
      throw conflict(`issue UUID ${input.id} already exists with different content`, "Use a new caller-retained UUID for a different issue.")
    }
    return unchanged(detail, "matching issue already exists (no-op)")
  }

  if (input.id) {
    const existing = await findIssueByUuid(client, input.id)
    if (existing) {
      return classifyExisting(existing)
    }
  }

  try {
    const payload = await client.createIssue({
      teamId: team.id,
      title: input.title,
      description: input.description,
      parentId: parent?.id,
      labelIds: label ? [label.id] : undefined,
      id: input.id
    })
    const issue = await requirePayload(payload.success, payload.issue, "create the issue")
    return changed(await issueSummary(issue, true), "issue created")
  } catch (cause) {
    if (input.id) {
      const existing = await findIssueByUuid(client, input.id)
      if (existing) {
        return classifyExisting(existing)
      }
    }
    throw cause
  }
}

const assignIssue = async (
  client: LinearClient,
  input: AssignIssueInput
): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.id)
  const assignee = await resolveUser(client, input.assignee)
  if (issue.assigneeId === assignee.id) {
    return unchanged(await issueSummary(issue), "already assigned to requested user (no-op)")
  }
  if (issue.assigneeId && !input.replace) {
    const current = await issue.assignee
    throw conflict(
      `${issue.identifier} is already assigned to ${current?.name ?? issue.assigneeId}`,
      "Choose another unassigned issue or pass `--replace` only when overwriting is deliberate. Assignment is not an atomic claim."
    )
  }

  const payload = await client.updateIssue(issue.id, { assigneeId: assignee.id })
  await requirePayload(payload.success, payload.issue, "assign the issue")
  const verified = await resolveIssue(client, issue.id)
  if (verified.assigneeId !== assignee.id) {
    throw conflict(
      `${issue.identifier} assignment could not be verified after update`,
      "Refetch the issue before attempting another claim. Assignment is not atomic."
    )
  }
  return changed(await issueSummary(verified), "issue assigned")
}

const unassignIssue = async (
  client: LinearClient,
  input: UnassignIssueInput
): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.id)
  if (!issue.assigneeId) {
    return unchanged(await issueSummary(issue), "already unassigned (no-op)")
  }
  if (input.ifAssignee) {
    const expected = await resolveUser(client, input.ifAssignee)
    if (issue.assigneeId !== expected.id) {
      const current = await issue.assignee
      throw conflict(
        `${issue.identifier} is assigned to ${current?.name ?? issue.assigneeId}, not the expected assignee`,
        "Refetch before releasing a claim so another user's assignment is preserved."
      )
    }
  }

  const payload = await client.updateIssue(issue.id, { assigneeId: null })
  await requirePayload(payload.success, payload.issue, "unassign the issue")
  const verified = await resolveIssue(client, issue.id)
  if (verified.assigneeId) {
    throw conflict(`${issue.identifier} remained assigned after update`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), "issue unassigned")
}

const closeIssue = async (
  client: LinearClient,
  input: CloseIssueInput
): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.id)
  const teamId = requireTeamId(issue)
  const currentState = await issue.state
  if (currentState && TERMINAL_STATE_TYPES.includes(currentState.type)) {
    return unchanged(await issueSummary(issue), "already closed (no-op)")
  }

  let target
  if (input.state) {
    target = await resolveWorkflowState(client, input.state, teamId)
    if (target.type !== "completed") {
      throw conflict(`workflow state ${target.name} is not completed`, "Pass a completed workflow-state UUID.")
    }
  } else {
    const states = [...await completedStates(client, teamId)].sort(
      (left, right) => left.position - right.position || left.id.localeCompare(right.id)
    )
    target = states[0]
    if (!target) {
      throw new LinearDomainError({
        message: `No completed workflow state exists for ${issue.identifier}'s team`,
        help: "Create a completed state in Linear or pass its UUID with `--state`."
      })
    }
  }

  const payload = await client.updateIssue(issue.id, { stateId: target.id })
  await requirePayload(payload.success, payload.issue, "close the issue")
  const verified = await resolveIssue(client, issue.id)
  const verifiedState = await verified.state
  if (verifiedState?.id !== target.id) {
    throw conflict(`${issue.identifier} state transition could not be verified`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), "issue closed")
}

const updateIssueDescription = async (
  client: LinearClient,
  input: UpdateIssueDescriptionInput
): Promise<MutationResult<IssueDetail>> => {
  const issue = await resolveIssue(client, input.id)
  const current = await issueDetail(issue)
  const desiredDescription = normalizeDescription(input.description)
  if (Date.parse(current.updatedAt) !== Date.parse(input.ifUpdatedAt)) {
    throw conflict(
      `${current.identifier} changed since --if-updated-at; description was not updated (current updatedAt: ${current.updatedAt})`,
      `Refetch with \`linear-axi issues view --id ${current.identifier} --full\`, merge the current description, and retry with its updatedAt.`
    )
  }
  if (current.description === desiredDescription) {
    return unchanged(current, "description already matches (no-op)")
  }

  const payload = await client.updateIssue(issue.id, { description: desiredDescription })
  const accepted = await requirePayload(payload.success, payload.issue, "update the issue description")
  const acceptedDescription = accepted.description ?? ""
  const acceptedUpdatedAt = accepted.updatedAt.toISOString()
  const verified = await issueDetail(await resolveIssue(client, issue.id))
  if (verified.description !== acceptedDescription || verified.updatedAt !== acceptedUpdatedAt) {
    throw conflict(
      `${current.identifier} description update could not be verified`,
      "Refetch and merge before retrying. Linear does not provide atomic compare-and-swap for descriptions."
    )
  }
  if (acceptedDescription === current.description && acceptedUpdatedAt === current.updatedAt) {
    return unchanged(verified, "description already matches after Linear normalization (no-op)")
  }
  if (acceptedUpdatedAt === current.updatedAt) {
    throw conflict(
      `${current.identifier} description changed without a verifiable timestamp advance`,
      "Refetch and merge before retrying."
    )
  }
  return changed(verified, "description updated and verified")
}

const listLabels = async (client: LinearClient, input: ListLabelsInput): Promise<PageResult<LabelSummary>> => {
  if (input.issue) {
    const issue = await resolveIssue(client, input.issue)
    if (input.name) {
      const labels = await fetchAllPages(await issue.labels({ first: 100 }))
      const matches = labels
        .filter((label) => label.name.toLowerCase() === input.name!.toLowerCase())
        .sort((left, right) => left.id.localeCompare(right.id))
      const offset = parseLocalCursor(input.after, "label")
      const selected = matches.slice(offset, offset + input.limit)
      const nextOffset = offset + selected.length
      return {
        items: await Promise.all(selected.map((label) => labelSummary(label))),
        page: {
          hasNext: nextOffset < matches.length,
          endCursor: nextOffset < matches.length ? `label:${nextOffset}` : null
        }
      }
    }
    const connection = await issue.labels({ first: input.limit, after: input.after })
    return pageResult(connection, await Promise.all(connection.nodes.map((label) => labelSummary(label))))
  }

  const team = input.team ? await resolveTeam(client, input.team) : undefined
  const connection = await client.issueLabels({
    first: input.limit,
    after: input.after,
    filter: {
      ...(input.name ? { name: { eqIgnoreCase: input.name } } : {}),
      ...(input.workspace ? { team: { null: true } } : team ? { team: { id: { eq: team.id } } } : {})
    }
  })
  return pageResult(connection, await Promise.all(connection.nodes.map((label) => labelSummary(label, team?.key))))
}

const createLabel = async (
  client: LinearClient,
  input: CreateLabelInput
): Promise<MutationResult<LabelSummary>> => {
  const team = input.team ? await resolveTeam(client, input.team) : undefined
  const teamId = team?.id ?? null
  const classify = async (label: IssueLabel): Promise<MutationResult<LabelSummary>> => {
    const summary = await labelSummary(label, team?.key)
    if (
      summary.name.toLowerCase() !== input.name.toLowerCase() ||
      summary.color.toLowerCase() !== input.color.toLowerCase() ||
      summary.description !== (input.description ?? "")
    ) {
      throw conflict(
        `label ${summary.name} already exists with different color or description`,
        "Choose a different name or make the requested properties match the existing label."
      )
    }
    return unchanged(summary, "matching label already exists (no-op)")
  }

  if (input.ifAbsent || input.id) {
    const lookup = input.id ?? input.name
    const matches = await findLabelsInScope(client, lookup, teamId)
    if (matches.length > 0) {
      const existing = await resolveLabelInScope(client, lookup, teamId)
      return classify(existing)
    }
  }

  try {
    const payload = await client.createIssueLabel({
      name: input.name,
      color: input.color,
      description: input.description,
      teamId: team?.id,
      id: input.id
    })
    const label = await requirePayload(payload.success, payload.issueLabel, "create the label")
    return changed(await labelSummary(label, team?.key), "label created")
  } catch (cause) {
    if (input.ifAbsent || input.id) {
      const lookup = input.id ?? input.name
      const matches = await findLabelsInScope(client, lookup, teamId)
      if (matches.length > 0) {
        return classify(await resolveLabelInScope(client, lookup, teamId))
      }
    }
    throw cause
  }
}

const applyLabel = async (
  client: LinearClient,
  input: ApplyLabelInput
): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.issue)
  const label = await resolveLabelForTeam(client, input.label, requireTeamId(issue))
  if (issue.labelIds.includes(label.id)) {
    return unchanged(await issueSummary(issue, true), "label already applied (no-op)")
  }

  try {
    const payload = await client.issueAddLabel(issue.id, label.id)
    await requirePayload(payload.success, payload.issue, "apply the label")
  } catch (cause) {
    const concurrent = await resolveIssue(client, issue.id)
    if (!concurrent.labelIds.includes(label.id)) {
      throw cause
    }
    return unchanged(await issueSummary(concurrent, true), "label already applied (no-op)")
  }
  const verified = await resolveIssue(client, issue.id)
  if (!verified.labelIds.includes(label.id)) {
    throw conflict(`${label.name} was not present after apply`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified, true), "label applied")
}

const listRelations = async (
  client: LinearClient,
  input: ListRelationsInput
): Promise<PageResult<RelationSummary>> => {
  const issue = await resolveIssue(client, input.issue)
  const outgoing = input.direction === "incoming"
    ? []
    : await fetchAllPages(await issue.relations({ first: 100, includeArchived: false }))
  const incoming = input.direction === "outgoing"
    ? []
    : await fetchAllPages(await issue.inverseRelations({ first: 100, includeArchived: false }))
  const rows = [
    ...await Promise.all(outgoing.map((relation) => relationSummary(relation, "outgoing"))),
    ...await Promise.all(incoming.map((relation) => relationSummary(relation, "incoming")))
  ]
    .filter((relation) => !input.type || relation.type === input.type)
    .sort((left, right) => left.id.localeCompare(right.id) || left.direction.localeCompare(right.direction))
  const offset = parseLocalCursor(input.after, "relation")
  const items = rows.slice(offset, offset + input.limit)
  const nextOffset = offset + items.length
  return {
    items,
    page: {
      hasNext: nextOffset < rows.length,
      endCursor: nextOffset < rows.length ? `relation:${nextOffset}` : null
    }
  }
}

const createRelation = async (
  client: LinearClient,
  input: CreateRelationInput
): Promise<MutationResult<RelationSummary>> => {
  const source = await resolveIssue(client, input.issue)
  const target = await resolveIssue(client, input.relatedIssue)
  const relations = await fetchAllPages(await source.relations({ first: 100, includeArchived: false }))
  const existing = relations.find(
    (relation) => relation.relatedIssueId === target.id && relation.type === input.type
  )
  if (existing) {
    return unchanged(await relationSummary(existing, "outgoing"), "directed relation already exists (no-op)")
  }

  try {
    const payload = await client.createIssueRelation({
      issueId: source.id,
      relatedIssueId: target.id,
      type: relationType(input.type),
      id: input.id
    })
    const relation = await requirePayload(payload.success, payload.issueRelation, "create the relation")
    return changed(await relationSummary(relation, "outgoing"), "directed relation created")
  } catch (cause) {
    const concurrent = await fetchAllPages(await source.relations({ first: 100, includeArchived: false }))
    const match = concurrent.find(
      (relation) => relation.relatedIssueId === target.id && relation.type === input.type
    )
    if (match) {
      return unchanged(await relationSummary(match, "outgoing"), "directed relation already exists (no-op)")
    }
    throw cause
  }
}

const listComments = async (
  client: LinearClient,
  input: ListCommentsInput
): Promise<PageResult<CommentSummary>> => {
  const issue = await resolveIssue(client, input.issue)
  const connection = await issue.comments({ first: input.limit, after: input.after, orderBy: PaginationOrderBy.CreatedAt })
  return pageResult(connection, await Promise.all(connection.nodes.map((comment) => commentSummary(comment, issue.id))))
}

const createComment = async (
  client: LinearClient,
  input: CreateCommentInput
): Promise<MutationResult<CommentSummary>> => {
  const issue = await resolveIssue(client, input.issue)
  const classify = async (comment: Comment): Promise<MutationResult<CommentSummary>> => {
    if (comment.issueId !== issue.id || comment.body !== input.body) {
      throw conflict(`comment UUID ${input.id} already exists with different issue or body`, "Use a new caller-retained UUID for a different comment.")
    }
    return unchanged(await commentSummary(comment, issue.id), "matching comment already exists (no-op)")
  }
  if (input.id) {
    const existing = await findCommentByUuid(client, input.id)
    if (existing) {
      return classify(existing)
    }
  }

  try {
    const payload = await client.createComment({ issueId: issue.id, body: input.body, id: input.id })
    const comment = await requirePayload(payload.success, payload.comment, "create the comment")
    return changed(await commentSummary(comment, issue.id), "comment created")
  } catch (cause) {
    if (input.id) {
      const existing = await findCommentByUuid(client, input.id)
      if (existing) {
        return classify(existing)
      }
    }
    throw cause
  }
}

const frontier = async (client: LinearClient, mapId: string, limit: number): Promise<FrontierResult> => {
  const mapIssue = await resolveIssue(client, mapId)
  const map = await issueDetail(mapIssue)
  const prefix = resolveWayfinderPrefix(map.identifier, map.labels)
  const typeLabels = new Map<string, { name: string; type: WayfinderType }>()
  for (const type of WAYFINDER_TYPES) {
    const label = await resolveLabelForTeam(client, `${prefix}:${type}`, map.teamId)
    typeLabels.set(label.id, { name: label.name, type })
  }

  const candidates = await fetchAllPages(
    await client.issues({
      first: 50,
      includeArchived: false,
      filter: {
        parent: { id: { eq: map.id } },
        assignee: { null: true },
        state: { type: { nin: TERMINAL_STATE_TYPES } },
        hasBlockedByRelations: { eq: false }
      },
      sort: [
        { manual: { order: PaginationSortOrder.Ascending } },
        { createdAt: { order: PaginationSortOrder.Ascending } }
      ]
    })
  )
  const projected = projectFrontier(
    candidates.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      createdAt: issue.createdAt.toISOString(),
      subIssueSortOrder: issue.subIssueSortOrder ?? null,
      labelIds: issue.labelIds
    })),
    typeLabels
  )
  return {
    map: { id: map.id, identifier: map.identifier, title: map.title },
    total: projected.length,
    items: projected.slice(0, limit)
  }
}

const findCommentByUuid = async (client: LinearClient, id: string): Promise<Comment | undefined> => {
  const comments = await fetchAllPages(await client.comments({ first: 50, filter: { id: { eq: id } } }))
  const matches = comments.filter((comment) => comment.id === id)
  if (matches.length > 1) {
    throw new LinearDomainError({ message: `Ambiguous Linear comment ${id}`, help: "Retry with an exact unique UUID." })
  }
  return matches[0]
}

const issueSummary = async (issue: Issue, includeLabelNames = false): Promise<IssueSummary> => {
  const state = await issue.state
  const assignee = await issue.assignee
  const parent = await issue.parent
  const labels = includeLabelNames
    ? (await fetchAllPages(await issue.labels({ first: 100 }))).map((label) => ({ id: label.id, name: label.name }))
    : issue.labelIds.map((id) => ({ id, name: id }))
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: state?.name ?? "unknown",
    stateType: state?.type ?? "unknown",
    assignee: assignee?.name ?? "unassigned",
    assigneeId: issue.assigneeId ?? null,
    parent: parent?.identifier ?? null,
    parentId: issue.parentId ?? null,
    labels,
    updatedAt: issue.updatedAt.toISOString(),
    createdAt: issue.createdAt.toISOString(),
    url: issue.url,
    subIssueSortOrder: issue.subIssueSortOrder ?? null
  }
}

const issueDetail = async (issue: Issue): Promise<IssueDetail> => {
  const summary = await issueSummary(issue, true)
  const team = await issue.team
  if (!team) {
    throw new LinearDomainError({ message: `${issue.identifier} has no team`, help: "Inspect the issue in Linear." })
  }
  return {
    ...summary,
    description: issue.description ?? "",
    priority: issue.priority,
    team: team.key,
    teamId: team.id
  }
}

const labelSummary = async (label: IssueLabel, knownTeamKey?: string): Promise<LabelSummary> => {
  const team = label.teamId && !knownTeamKey ? await label.team : undefined
  return {
    id: label.id,
    name: label.name,
    scope: label.teamId === undefined ? "workspace" : (knownTeamKey ?? team?.key ?? label.teamId),
    teamId: label.teamId ?? null,
    color: label.color,
    description: label.description ?? "",
    isGroup: label.isGroup,
    archivedAt: label.archivedAt?.toISOString() ?? null
  }
}

const relationSummary = async (
  relation: IssueRelation,
  direction: RelationDirection
): Promise<RelationSummary> => {
  const counterpart = direction === "outgoing" ? await relation.relatedIssue : await relation.issue
  if (!counterpart) {
    throw new LinearDomainError({ message: `Relation ${relation.id} has no counterpart issue`, help: "Inspect the relation in Linear." })
  }
  const state = await counterpart.state
  return {
    id: relation.id,
    type: relation.type as RelationType,
    direction,
    identifier: counterpart.identifier,
    title: counterpart.title,
    state: state?.name ?? "unknown",
    sourceId: relation.issueId ?? "unknown",
    targetId: relation.relatedIssueId ?? "unknown"
  }
}

const commentSummary = async (comment: Comment, issueId: string): Promise<CommentSummary> => {
  const user = await comment.user
  return {
    id: comment.id,
    issueId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    author: user?.name ?? "unknown",
    url: comment.url
  }
}

const teamSummary = (team: Team): TeamSummary => ({ id: team.id, key: team.key, name: team.name })

const requireTeamId = (issue: Issue): string => {
  if (!issue.teamId) {
    throw new LinearDomainError({ message: `${issue.identifier} has no team`, help: "Inspect the issue in Linear." })
  }
  return issue.teamId
}

const pageResult = <Node, Value>(connection: ConnectionLike<Node>, items: ReadonlyArray<Value>): PageResult<Value> => ({
  items,
  page: {
    hasNext: connection.pageInfo.hasNextPage,
    endCursor: connection.pageInfo.endCursor ?? null
  }
})

const requirePayload = async <Value>(
  success: boolean,
  value: Promise<Value> | undefined,
  operation: string
): Promise<Value> => {
  if (!success || !value) {
    throw new Error(`Linear did not ${operation}`)
  }
  return value
}

const relationType = (type: RelationType): IssueRelationType => {
  switch (type) {
    case "blocks": return IssueRelationType.Blocks
    case "duplicate": return IssueRelationType.Duplicate
    case "related": return IssueRelationType.Related
    case "similar": return IssueRelationType.Similar
  }
}

const changed = <Value>(value: Value, result: string): MutationResult<Value> => ({ value, changed: true, result })
const unchanged = <Value>(value: Value, result: string): MutationResult<Value> => ({ value, changed: false, result })

const conflict = (message: string, help: string): LinearDomainError => new LinearDomainError({ message, help })

const parseLocalCursor = (cursor: string | undefined, kind: string): number => {
  if (!cursor) {
    return 0
  }
  const match = new RegExp(`^${kind}:([0-9]+)$`).exec(cursor)
  if (!match) {
    throw new LinearDomainError({
      message: `invalid ${kind} cursor`,
      help: `Use the exact page.endCursor returned by the previous ${kind} list command.`
    })
  }
  return Number(match[1])
}

const readableError = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message.replaceAll(/\s+/g, " ").trim()
  }
  return "Linear request failed"
}

const normalizeDescription = (description: string): string =>
  description.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n+$/, "")
