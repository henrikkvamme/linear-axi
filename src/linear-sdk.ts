import {
  IssueRelationType,
  LinearClient,
  PaginationOrderBy,
  PaginationSortOrder,
  type Comment,
  type Issue,
  type IssueLabel,
  type IssueRelation,
  type Team,
  type WorkflowState
} from "@linear/sdk"
import { Effect } from "effect"
import { AuthError, LinearApiError, LinearDomainError } from "./errors"
import type {
  ApplyLabelInput,
  AssignIssueInput,
  AuthStatus,
  CloseIssueInput,
  ChangeIssueStateInput,
  ClearIssueFieldsInput,
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
  ListWorkflowStatesInput,
  MutationResult,
  PageResult,
  RelationDirection,
  RelationSummary,
  RelationType,
  RemoveRelationInput,
  RelationRemovalSummary,
  ReplaceLabelsInput,
  SetIssueParentInput,
  TeamSummary,
  UnassignIssueInput,
  UpdateIssueDescriptionInput
} from "./linear"
import { decodeLocalCursorOffset, fetchAllPages, type ConnectionLike, type LocalCursorKind } from "./linear-pagination"
import { makeOfficialMcpToolCaller } from "./official-mcp"
import { normalizeRichText, richTextEqual } from "./rich-text"
import {
  completedStates,
  findIssueByUuid,
  findLabelByNameInScope,
  findLabelByUuid,
  findRelationByUuid,
  lookupRelationByUuid,
  normalizeUuid,
  resolveAssignableUser,
  resolveInitiative,
  resolveIssue,
  resolveIssueForRemoval,
  resolveLabelForRemoval,
  resolveLabelForTeam,
  resolveLabelGlobally,
  resolveTeam,
  resolveTeamReference,
  resolveUser,
  resolveWorkflowState,
  uuidEqual
} from "./linear-resolve"
import {
  paginateFrontier,
  resolveWayfinderPrefix,
  validateFrontierCursor,
  WAYFINDER_TYPES,
  type WayfinderType
} from "./wayfinder"

const TERMINAL_STATE_TYPES = ["completed", "canceled", "duplicate"]

export const makeSdkLinearGateway = (
  credentials: Credentials | undefined,
  options: { readonly client?: LinearClient } = {}
): LinearGateway => {
  const callOfficialTool = credentials ? makeOfficialMcpToolCaller(credentials) : undefined
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
    callOfficialTool: (name, args) => callOfficialTool
      ? callOfficialTool(name, args)
      : Effect.fail(new AuthError({
          message: "Linear credentials are not configured",
          help: "Run `linear-axi auth login` or set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN."
        })),
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

    resolveProjectUpdateAssociations: (input) => call("projects update", async (client) => {
      const [teams, initiatives] = await Promise.all([
        Promise.all(input.teams.map(async (selector) => (await resolveTeamReference(client, selector, input.includeArchived)).id)),
        Promise.all(input.initiatives.map(async (selector) => (await resolveInitiative(client, selector, input.includeArchived)).id))
      ])
      return { teams, initiatives }
    }),

    listWorkflowStates: (input) => call("workflow-states list", (client) => listWorkflowStates(client, input)),

    listIssues: (input) => call("issues list", (client) => listIssues(client, input)),
    viewIssue: (id) => call("issues view", async (client) => issueDetail(await resolveIssue(client, id))),
    createIssue: (input) => call("issues create", (client) => createIssue(client, input)),
    assignIssue: (input) => call("issues assign", (client) => assignIssue(client, input)),
    unassignIssue: (input) => call("issues unassign", (client) => unassignIssue(client, input)),
    closeIssue: (input) => call("issues close", (client) => closeIssue(client, input)),
    changeIssueState: (input) => call("issues state", (client) => changeIssueState(client, input)),
    setIssueParent: (input) => call("issues parent", (client) => setIssueParent(client, input)),
    clearIssueFields: (input) => call("issues update clear", (client) => clearIssueFields(client, input)),
    updateIssueDescription: (input) => call("issues update", (client) => updateIssueDescription(client, input)),
    listLabels: (input) => call("labels list", (client) => listLabels(client, input)),
    createLabel: (input) => call("labels create", (client) => createLabel(client, input)),
    applyLabel: (input) => call("labels apply", (client) => applyLabel(client, input)),
    removeLabel: (input) => call("labels remove", (client) => removeLabel(client, input)),
    replaceLabels: (input) => call("labels replace", (client) => replaceLabels(client, input)),
    listRelations: (input) => call("relations list", (client) => listRelations(client, input)),
    createRelation: (input) => call("relations create", (client) => createRelation(client, input)),
    removeRelation: (input) => call("relations remove", (client) => removeRelation(client, input)),
    listComments: (input) => call("comments list", (client) => listComments(client, input)),
    createComment: (input) => call("comments create", (client) => createComment(client, input)),
    frontier: (input) => call("wayfinder frontier", (client) => frontier(client, input.map, input.first, input.after))
  }
}

const listWorkflowStates = async (client: LinearClient, input: ListWorkflowStatesInput) => {
  const team = await resolveTeam(client, input.team)
  const states = await fetchAllPages(await client.workflowStates({
    first: 50,
    includeArchived: false,
    filter: { team: { id: { eq: team.id } } }
  }))
  return states
    .map((state) => ({
      id: state.id,
      name: state.name,
      type: state.type,
      color: state.color,
      position: state.position,
      teamId: team.id
    }))
    .sort((left, right) => left.position - right.position || compareText(left.id, right.id))
}

const changeIssueState = async (client: LinearClient, input: ChangeIssueStateInput): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.id)
  const target = await resolveWorkflowState(client, input.state, requireTeamId(issue))
  const current = await issue.state
  if (current && uuidEqual(current.id, target.id)) {
    return unchanged(await issueSummary(issue), "already in the requested workflow state (no-op)")
  }
  const payload = await client.updateIssue(issue.id, { stateId: target.id })
  await requirePayload(payload.success, payload.issue, "change the issue workflow state")
  const verified = await resolveIssue(client, issue.id)
  const verifiedState = await verified.state
  if (!verifiedState || !uuidEqual(verifiedState.id, target.id)) {
    throw conflict(`${issue.identifier} state transition could not be verified`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), "issue workflow state changed")
}

const setIssueParent = async (client: LinearClient, input: SetIssueParentInput): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.id)
  const parent = input.parent === null ? undefined : await resolveIssue(client, input.parent)
  if (parent && uuidEqual(issue.id, parent.id)) {
    throw conflict(`${issue.identifier} cannot be its own parent`, "Choose a different parent issue.")
  }
  if (parent && !uuidEqual(requireTeamId(issue), requireTeamId(parent))) {
    throw conflict(`parent ${parent.identifier} belongs to another team`, "Choose a parent from the issue's team.")
  }
  const desiredParentId = parent?.id ?? null
  if (nullableUuidEqual(issue.parentId ?? null, desiredParentId)) {
    return unchanged(await issueSummary(issue), parent ? "requested parent already set (no-op)" : "parent already clear (no-op)")
  }
  const payload = await client.updateIssue(issue.id, { parentId: desiredParentId })
  await requirePayload(payload.success, payload.issue, parent ? "set the issue parent" : "clear the issue parent")
  const verified = await resolveIssue(client, issue.id)
  if (!nullableUuidEqual(verified.parentId ?? null, desiredParentId)) {
    throw conflict(`${issue.identifier} parent update could not be verified`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), parent ? "issue parent set" : "issue parent cleared")
}

const clearIssueFields = async (client: LinearClient, input: ClearIssueFieldsInput): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.id)
  const dueDateAlreadyClear = !input.dueDate || issue.dueDate === undefined || issue.dueDate === null
  const milestoneAlreadyClear = !input.milestone || issue.projectMilestoneId === undefined || issue.projectMilestoneId === null
  if (dueDateAlreadyClear && milestoneAlreadyClear) {
    return unchanged(await issueSummary(issue), "requested issue fields already clear (no-op)")
  }
  const payload = await client.updateIssue(issue.id, {
    ...(input.dueDate ? { dueDate: null } : {}),
    ...(input.milestone ? { projectMilestoneId: null } : {})
  })
  await requirePayload(payload.success, payload.issue, "clear issue fields")
  const verified = await resolveIssue(client, issue.id)
  if ((input.dueDate && verified.dueDate != null) || (input.milestone && verified.projectMilestoneId != null)) {
    throw conflict(`${issue.identifier} cleared fields could not be verified`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), "requested issue fields cleared")
}

const listIssues = async (client: LinearClient, input: ListIssuesInput): Promise<PageResult<IssueSummary>> => {
  const team = input.team ? await resolveTeam(client, input.team) : undefined
  const parent = input.parent ? await resolveIssue(client, input.parent) : undefined
  if (team && parent && (parent.teamId === undefined || !uuidEqual(parent.teamId, team.id))) {
    throw conflict(`parent ${parent.identifier} belongs to another team`, "Use the parent's team when listing child issues.")
  }
  const labelTeamId = team?.id ?? (parent ? requireTeamId(parent) : undefined)
  const label = input.label
    ? labelTeamId
      ? await resolveLabelForTeam(client, input.label, labelTeamId)
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
  const summaryFields = new Set(input.fields)
  return pageResult(
    connection,
    await Promise.all(connection.nodes.map((issue) => issueSummary(issue, summaryFields)))
  )
}

const createIssue = async (
  client: LinearClient,
  input: CreateIssueInput
): Promise<MutationResult<IssueSummary>> => {
  const callerId = input.id ? normalizeUuid(input.id) : undefined
  const team = await resolveTeam(client, input.team)
  const parent = input.parent ? await resolveIssue(client, input.parent) : undefined
  if (parent && (parent.teamId === undefined || !uuidEqual(parent.teamId, team.id))) {
    throw conflict(`parent ${parent.identifier} belongs to another team`, "Use the parent's team when creating a child issue.")
  }
  const label = input.label ? await resolveLabelForTeam(client, input.label, team.id) : undefined
  if (label) {
    requireOrdinaryLabel(label)
  }

  const classifyExisting = async (existing: Issue): Promise<MutationResult<IssueSummary>> => {
    const detail = await issueDetail(existing)
    const matches = uuidEqual(detail.teamId, team.id) &&
      detail.title === input.title &&
      richTextEqual(detail.description, input.description ?? "") &&
      nullableUuidEqual(detail.parentId, parent?.id ?? null) &&
      (label === undefined || detail.labels.some((existingLabel) => uuidEqual(existingLabel.id, label.id)))
    if (!matches) {
      throw conflict(`issue UUID ${callerId} already exists with different content`, "Use a new caller-retained UUID for a different issue.")
    }
    return unchanged(detail, "matching issue already exists (no-op)")
  }

  if (callerId) {
    const existing = await findIssueByUuid(client, callerId)
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
      id: callerId
    })
    const issue = await requirePayload(payload.success, payload.issue, "create the issue")
    return changed(await issueSummary(issue), "issue created")
  } catch (cause) {
    if (callerId) {
      const existing = await findIssueByUuid(client, callerId)
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
  const assignee = await resolveAssignableUser(client, input.assignee)
  if (issue.assigneeId !== undefined && uuidEqual(issue.assigneeId, assignee.id)) {
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
  if (verified.assigneeId === undefined || !uuidEqual(verified.assigneeId, assignee.id)) {
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
    if (!uuidEqual(issue.assigneeId, expected.id)) {
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
  let target: WorkflowState
  if (input.state) {
    target = await resolveWorkflowState(client, input.state, teamId)
    if (target.type !== "completed") {
      throw conflict(`workflow state ${target.name} is not completed`, "Pass a completed workflow-state UUID.")
    }
    const currentState = await issue.state
    if (currentState && uuidEqual(currentState.id, target.id)) {
      return unchanged(await issueSummary(issue), "already in the requested completed state (no-op)")
    }
  } else {
    const currentState = await issue.state
    if (currentState && TERMINAL_STATE_TYPES.includes(currentState.type)) {
      return unchanged(await issueSummary(issue), "already closed (no-op)")
    }
    const states = await completedStates(client, teamId)
    if (states.length === 0) {
      throw new LinearDomainError({
        message: `No completed workflow state exists for ${issue.identifier}'s team`,
        help: "Create a completed state in Linear or pass its UUID with `--state`."
      })
    }
    if (states.length > 1) {
      const candidates = [...states]
        .sort((left, right) => compareText(left.id, right.id))
        .map((state) => `${state.id} (${state.name})`)
        .join(", ")
      throw conflict(
        `Ambiguous completed workflow state for ${issue.identifier}; matched ${candidates}`,
        "Pass `--state <completed-state-uuid>` to choose the intended completed state."
      )
    }
    target = states[0]!
  }

  const payload = await client.updateIssue(issue.id, { stateId: target.id })
  await requirePayload(payload.success, payload.issue, "close the issue")
  const verified = await resolveIssue(client, issue.id)
  const verifiedState = await verified.state
  if (!verifiedState || !uuidEqual(verifiedState.id, target.id)) {
    throw conflict(`${issue.identifier} state transition could not be verified`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), "issue closed")
}

const updateIssueDescription = async (
  client: LinearClient,
  input: UpdateIssueDescriptionInput
): Promise<MutationResult<IssueDetail>> => {
  const issue = await resolveIssue(client, input.id)
  const currentDescription = issue.description ?? ""
  const currentUpdatedAt = issue.updatedAt.toISOString()
  const desiredDescription = normalizeRichText(input.description)
  if (currentUpdatedAt !== input.ifUpdatedAt) {
    throw conflict(
      `${issue.identifier} changed since --if-updated-at; description was not updated (current updatedAt: ${currentUpdatedAt})`,
      `Refetch with \`linear-axi issues view --id ${issue.identifier} --full\`, merge the current description, and retry with its updatedAt.`
    )
  }
  if (richTextEqual(currentDescription, desiredDescription)) {
    const current = await issueDetail(issue)
    return unchanged(
      current,
      currentDescription === desiredDescription
        ? "description already matches (no-op)"
        : "description already matches after Linear normalization (no-op)"
    )
  }

  const payload = await client.updateIssue(issue.id, { description: desiredDescription })
  const accepted = await requirePayload(payload.success, payload.issue, "update the issue description")
  const acceptedDescription = accepted.description ?? ""
  const acceptedUpdatedAt = accepted.updatedAt.toISOString()
  const verifiedIssue = await resolveIssue(client, issue.id)
  const verifiedDescription = verifiedIssue.description ?? ""
  const verifiedUpdatedAt = verifiedIssue.updatedAt.toISOString()
  if (
    verifiedDescription !== acceptedDescription ||
    verifiedUpdatedAt !== acceptedUpdatedAt ||
    !richTextEqual(verifiedDescription, desiredDescription)
  ) {
    throw conflict(
      `${issue.identifier} description update could not be verified`,
      "Refetch and merge before retrying. Linear does not provide atomic compare-and-swap for descriptions."
    )
  }
  if (acceptedDescription === currentDescription && acceptedUpdatedAt === currentUpdatedAt) {
    return unchanged(await issueDetail(verifiedIssue), "description already matches after Linear normalization (no-op)")
  }
  if (acceptedUpdatedAt === currentUpdatedAt) {
    throw conflict(
      `${issue.identifier} description changed without a verifiable timestamp advance`,
      "Refetch and merge before retrying."
    )
  }
  return changed(await issueDetail(verifiedIssue), "description updated and verified")
}

const listLabels = async (client: LinearClient, input: ListLabelsInput): Promise<PageResult<LabelSummary>> => {
  const localOffset = input.issue && input.name ? parseLocalCursor(input.after, "label") : 0
  if (input.issue) {
    const issue = await resolveIssue(client, input.issue)
    if (input.name) {
      const labels = await fetchAllPages(await issue.labels({ first: 100, includeArchived: input.includeArchived }))
      const matches = labels
        .filter((label) => label.name.toLowerCase() === input.name!.toLowerCase())
        .sort((left, right) => compareText(left.id, right.id))
      const selected = matches.slice(localOffset, localOffset + input.limit)
      const nextOffset = localOffset + selected.length
      return {
        items: await labelSummaries(selected, input.fields),
        page: {
          hasNext: nextOffset < matches.length,
          endCursor: nextOffset < matches.length ? `label:${nextOffset}` : null
        }
      }
    }
    const connection = await issue.labels({
      first: input.limit,
      after: input.after,
      includeArchived: input.includeArchived
    })
    return pageResult(connection, await labelSummaries(connection.nodes, input.fields))
  }

  const team = input.team ? await resolveTeam(client, input.team) : undefined
  const connection = await client.issueLabels({
    first: input.limit,
    after: input.after,
    includeArchived: input.includeArchived,
    filter: {
      ...(input.name ? { name: { eqIgnoreCase: input.name } } : {}),
      ...(input.workspace ? { team: { null: true } } : team ? { team: { id: { eq: team.id } } } : {})
    }
  })
  return pageResult(connection, await labelSummaries(connection.nodes, input.fields, team?.key))
}

const createLabel = async (
  client: LinearClient,
  input: CreateLabelInput
): Promise<MutationResult<LabelSummary>> => {
  const callerId = input.id ? normalizeUuid(input.id) : undefined
  const team = input.team ? await resolveTeam(client, input.team) : undefined
  const teamId = team?.id ?? null
  const parent = input.parent
    ? (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.parent)
        ? await findLabelByUuid(client, input.parent)
        : await findLabelByNameInScope(client, input.parent, teamId))
    : undefined
  if (input.parent && !parent) {
    throw new LinearDomainError({
      message: `No label group matched ${input.parent}`,
      help: "Run `linear-axi labels list` to find the exact group id or name."
    })
  }
  if (parent && (!parent.isGroup || !labelBelongsToScope(parent, teamId))) {
    throw conflict(
      `label parent ${input.parent} is not a group in the requested scope`,
      "Choose a group from the same workspace or team scope."
    )
  }
  const summarizeRequestedLabel = async (label: IssueLabel): Promise<{
    readonly summary: LabelSummary
    readonly matches: boolean
  }> => {
    const summary = await labelSummary(label, team?.key)
    return {
      summary,
      matches: labelBelongsToScope(label, teamId) &&
        summary.name.toLowerCase() === input.name.toLowerCase() &&
        summary.color.toLowerCase() === input.color.toLowerCase() &&
        summary.description === (input.description ?? "") &&
        summary.isGroup === (input.isGroup ?? false) &&
        summary.parentId === (parent?.id ?? null)
    }
  }

  const classify = async (label: IssueLabel): Promise<MutationResult<LabelSummary>> => {
    if (!input.isGroup) requireOrdinaryLabel(label)
    const { summary, matches } = await summarizeRequestedLabel(label)
    if (!matches) {
      throw conflict(
        `label ${summary.name} already exists with different requested properties`,
        "Choose a different name or make the requested properties match the existing label."
      )
    }
    return unchanged(summary, "matching label already exists (no-op)")
  }

  const classifyExisting = async (): Promise<MutationResult<LabelSummary> | undefined> => {
    const idMatch = callerId ? await findLabelByUuid(client, callerId) : undefined
    if (idMatch && !labelBelongsToScope(idMatch, teamId)) {
      const requestedScope = team ? `team ${team.key}` : "the workspace"
      const actualScope = idMatch.teamId === undefined ? "the workspace" : `team ${idMatch.teamId}`
      throw conflict(
        `label caller UUID ${callerId} belongs to ${actualScope}, not ${requestedScope}`,
        "Use a new caller-retained UUID or create the label in its existing scope."
      )
    }
    if (idMatch && !input.isGroup) requireOrdinaryLabel(idMatch)

    if (callerId && input.ifAbsent) {
      const nameMatch = await findLabelByNameInScope(client, input.name, teamId)
      if (nameMatch && !input.isGroup) requireOrdinaryLabel(nameMatch)
      if (!nameMatch && !idMatch) {
        return undefined
      }
      if (!nameMatch) {
        throw conflict(
          `label caller UUID ${callerId} conflicts with requested name ${input.name}; it belongs to ${idMatch!.name}`,
          "Use a new caller-retained UUID or make both identities refer to the same scoped label."
        )
      }
      if (!idMatch) {
        throw conflict(
          `label name ${input.name} conflicts with caller UUID ${callerId}; it belongs to ${nameMatch.id}`,
          "Use a new label name or make both identities refer to the same scoped label."
        )
      }
      if (!uuidEqual(nameMatch.id, idMatch.id)) {
        throw conflict(
          `label name ${input.name} and caller UUID ${callerId} conflict with different scoped labels`,
          "Use a name and caller-retained UUID that refer to the same scoped label."
        )
      }
      return classify(idMatch)
    }

    if (idMatch) {
      return classify(idMatch)
    }
    if (input.ifAbsent) {
      const nameMatch = await findLabelByNameInScope(client, input.name, teamId)
      return nameMatch ? classify(nameMatch) : undefined
    }
    return undefined
  }

  const existing = await classifyExisting()
  if (existing) {
    return existing
  }

  let created: IssueLabel
  try {
    const payload = await client.createIssueLabel({
      name: input.name,
      color: input.color,
      description: input.description,
      teamId: team?.id,
      id: callerId,
      isGroup: input.isGroup,
      parentId: parent?.id
    })
    created = await requirePayload(payload.success, payload.issueLabel, "create the label")
  } catch (cause) {
    const concurrent = await classifyExisting()
    if (concurrent) {
      return concurrent
    }
    throw cause
  }

  const label = await findLabelByUuid(client, created.id)
  if (!label) {
    throw conflict(
      "created label could not be verified",
      "Refetch labels in the requested scope before retrying."
    )
  }
  const { summary, matches } = await summarizeRequestedLabel(label)
  if (!matches) {
    throw conflict(
      "created label could not be verified",
      "Inspect the created label before retrying."
    )
  }
  return changed(summary, "label created and verified")
}

const applyLabel = async (
  client: LinearClient,
  input: ApplyLabelInput
): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.issue)
  const label = await resolveLabelForTeam(client, input.label, requireTeamId(issue))
  requireOrdinaryLabel(label)
  if (issue.labelIds.some((id) => uuidEqual(id, label.id))) {
    return unchanged(await issueSummary(issue), "label already applied (no-op)")
  }

  try {
    const payload = await client.issueAddLabel(issue.id, label.id)
    await requirePayload(payload.success, payload.issue, "apply the label")
  } catch (cause) {
    const concurrent = await resolveIssue(client, issue.id)
    if (!concurrent.labelIds.some((id) => uuidEqual(id, label.id))) {
      throw cause
    }
    return unchanged(await issueSummary(concurrent), "label already applied (no-op)")
  }
  const verified = await resolveIssue(client, issue.id)
  if (!verified.labelIds.some((id) => uuidEqual(id, label.id))) {
    throw conflict(`${label.name} was not present after apply`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), "label applied")
}

const removeLabel = async (
  client: LinearClient,
  input: ApplyLabelInput
): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.issue)
  const label = await resolveLabelForRemoval(issue, input.label, requireTeamId(issue))
  if (!label) return unchanged(await issueSummary(issue), "label already absent (no-op)")
  requireOrdinaryLabel(label)
  if (!issue.labelIds.some((id) => uuidEqual(id, label.id))) {
    return unchanged(await issueSummary(issue), "label already absent (no-op)")
  }
  const payload = await client.issueRemoveLabel(issue.id, label.id)
  await requirePayload(payload.success, payload.issue, "remove the label")
  const verified = await resolveIssue(client, issue.id)
  if (verified.labelIds.some((id) => uuidEqual(id, label.id))) {
    throw conflict(`${label.name} remained present after removal`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), "label removed")
}

const replaceLabels = async (
  client: LinearClient,
  input: ReplaceLabelsInput
): Promise<MutationResult<IssueSummary>> => {
  const issue = await resolveIssue(client, input.issue)
  const labels = await Promise.all(input.labels.map((selector) =>
    resolveLabelForTeam(client, selector, requireTeamId(issue))))
  labels.forEach(requireOrdinaryLabel)
  const desiredIds = [...new Set(labels.map((label) => normalizeUuid(label.id)))].sort(compareText)
  const currentIds = issue.labelIds.map(normalizeUuid).sort(compareText)
  if (desiredIds.length === currentIds.length && desiredIds.every((id, index) => id === currentIds[index])) {
    return unchanged(await issueSummary(issue), "labels already match requested replacement (no-op)")
  }
  const payload = await client.updateIssue(issue.id, { labelIds: desiredIds })
  await requirePayload(payload.success, payload.issue, "replace the issue labels")
  const verified = await resolveIssue(client, issue.id)
  const verifiedIds = verified.labelIds.map(normalizeUuid).sort(compareText)
  if (desiredIds.length !== verifiedIds.length || desiredIds.some((id, index) => id !== verifiedIds[index])) {
    throw conflict(`${issue.identifier} labels could not be verified after replacement`, "Refetch the issue before retrying.")
  }
  return changed(await issueSummary(verified), "issue labels replaced")
}

const listRelations = async (
  client: LinearClient,
  input: ListRelationsInput
): Promise<PageResult<RelationSummary>> => {
  const offset = parseLocalCursor(input.after, "relation")
  const issue = await resolveIssue(client, input.issue)
  const [outgoing, incoming] = await Promise.all([
    input.direction === "incoming"
      ? Promise.resolve([])
      : issue.relations({ first: 100, includeArchived: false }).then(fetchAllPages),
    input.direction === "outgoing"
      ? Promise.resolve([])
      : issue.inverseRelations({ first: 100, includeArchived: false }).then(fetchAllPages)
  ])
  const rows = [
    ...outgoing.map((relation) => ({ relation, direction: "outgoing" as const })),
    ...incoming.map((relation) => ({ relation, direction: "incoming" as const }))
  ]
    .filter(({ relation }) => !input.type || relation.type === input.type)
    .sort(({ relation: left, direction: leftDirection }, { relation: right, direction: rightDirection }) =>
      compareText(left.id, right.id) || compareText(leftDirection, rightDirection)
    )
  const selected = rows.slice(offset, offset + input.limit)
  const items = await Promise.all(selected.map(({ relation, direction }) => relationSummary(relation, direction)))
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
  const callerId = input.id ? normalizeUuid(input.id) : undefined
  const source = await resolveIssue(client, input.issue)
  const target = await resolveIssue(client, input.relatedIssue)
  if (input.type === "blocks" && uuidEqual(source.id, target.id)) {
    throw new LinearDomainError({
      message: `${source.identifier} cannot block itself`,
      help: "Choose two different issues for the blocker and blocked issue."
    })
  }

  const classifyExisting = async (): Promise<MutationResult<RelationSummary> | undefined> => {
    const [relations, idMatch] = await Promise.all([
      source.relations({ first: 100, includeArchived: false }).then(fetchAllPages),
      callerId ? findRelationByUuid(client, callerId) : Promise.resolve(undefined)
    ])
    const naturalMatch = relations.find((relation) => relationMatches(relation, source.id, target.id, input.type))

    if (idMatch) {
      if (!relationMatches(idMatch, source.id, target.id, input.type)) {
        throw conflict(
          `relation caller UUID ${callerId} conflicts with another directed relation`,
          "Use a new caller-retained UUID or make the source, target, and type match the existing relation."
        )
      }
      if (naturalMatch && !uuidEqual(naturalMatch.id, idMatch.id)) {
        throw conflict(
          `directed relation and caller UUID ${callerId} conflict with different relations`,
          "Use the caller-retained UUID of the existing directed relation."
        )
      }
      return unchanged(await relationSummary(idMatch, "outgoing"), "directed relation already exists (no-op)")
    }

    if (naturalMatch) {
      if (callerId) {
        throw conflict(
          `directed relation already exists under UUID ${naturalMatch.id}, not caller UUID ${callerId}`,
          "Reuse the existing relation UUID or omit --id."
        )
      }
      return unchanged(await relationSummary(naturalMatch, "outgoing"), "directed relation already exists (no-op)")
    }
    return undefined
  }

  const existing = await classifyExisting()
  if (existing) {
    return existing
  }

  try {
    const payload = await client.createIssueRelation({
      issueId: source.id,
      relatedIssueId: target.id,
      type: relationType(input.type),
      id: callerId
    })
    const relation = await requirePayload(payload.success, payload.issueRelation, "create the relation")
    return changed(await relationSummary(relation, "outgoing"), "directed relation created")
  } catch (cause) {
    const concurrent = await classifyExisting()
    if (concurrent) {
      return concurrent
    }
    throw cause
  }
}

const removeRelation = async (
  client: LinearClient,
  input: RemoveRelationInput
): Promise<MutationResult<RelationRemovalSummary>> => {
  let relation: IssueRelation | undefined
  let desired: RelationRemovalSummary
  if (input.id) {
    relation = await lookupRelationByUuid(client, input.id)
    desired = { id: input.id }
  } else {
    const source = await resolveIssue(client, input.issue!)
    const target = await resolveIssueForRemoval(client, input.relatedIssue!)
    const type = input.type!
    const relations = await fetchAllPages(await source.relations({ first: 100, includeArchived: true }))
    const matches = relations.filter((candidate) => !candidate.archivedAt && relationMatches(candidate, source.id, target.id, type))
    if (matches.length > 1) {
      throw conflict(
        `Ambiguous directed relation; matched ${matches.map((candidate) => candidate.id).join(", ")}`,
        "Retry with `relations remove --id <relation-id>`."
      )
    }
    relation = matches[0]
    desired = { id: relation?.id ?? null, type, sourceId: source.id, targetId: target.id }
  }
  if (!relation || relation.archivedAt) {
    return unchanged(desired, "directed relation already absent (no-op)")
  }
  const payload = await client.deleteIssueRelation(relation.id)
  if (!payload.success) {
    throw conflict(`relation ${relation.id} was not removed`, "Refetch the relation before retrying.")
  }
  const verified = await lookupRelationByUuid(client, relation.id)
  if (verified && !verified.archivedAt) {
    throw conflict(`relation ${relation.id} remained active after removal`, "Refetch the relation before retrying.")
  }
  return changed({
    id: relation.id,
    type: relation.type as RelationType,
    sourceId: relation.issueId,
    targetId: relation.relatedIssueId
  }, "directed relation removed")
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
  const callerId = input.id ? normalizeUuid(input.id) : undefined
  const issue = await resolveIssue(client, input.issue)
  const classify = async (comment: Comment): Promise<MutationResult<CommentSummary>> => {
    if (typeof comment.issueId !== "string" || !uuidEqual(comment.issueId, issue.id) || !richTextEqual(comment.body, input.body)) {
      throw conflict(`comment UUID ${callerId} already exists with different issue or body`, "Use a new caller-retained UUID for a different comment.")
    }
    return unchanged(await commentSummary(comment, issue.id), "matching comment already exists (no-op)")
  }
  if (callerId) {
    const existing = await findCommentByUuid(client, callerId)
    if (existing) {
      return classify(existing)
    }
  }

  try {
    const payload = await client.createComment({ issueId: issue.id, body: input.body, id: callerId })
    const comment = await requirePayload(payload.success, payload.comment, "create the comment")
    return changed(await commentSummary(comment, issue.id), "comment created")
  } catch (cause) {
    if (callerId) {
      const existing = await findCommentByUuid(client, callerId)
      if (existing) {
        return classify(existing)
      }
    }
    throw cause
  }
}

const frontier = async (
  client: LinearClient,
  mapId: string,
  first: number,
  after?: string
): Promise<FrontierResult> => {
  if (!Number.isInteger(first) || first < 1 || first > 100) {
    throw new LinearDomainError({
      message: "invalid frontier page size",
      help: "Use --first with an integer between 1 and 100."
    })
  }
  if (after !== undefined) {
    validateFrontierCursor(after)
  }
  const map = await resolveIssue(client, mapId)
  const mapLabels = await loadIssueLabels(map, false)
  const prefix = resolveWayfinderPrefix(map.identifier, mapLabels)
  const teamId = requireTeamId(map)
  const resolvedTypeLabels = await Promise.all(
    WAYFINDER_TYPES.map(async (type) => {
      const label = await resolveLabelForTeam(client, `${prefix}:${type}`, teamId)
      requireOrdinaryLabel(label)
      return { label, type }
    })
  )
  const typeLabels = new Map<string, { name: string; type: WayfinderType }>(
    resolvedTypeLabels.map(({ label, type }) => [label.id, { name: label.name, type }])
  )

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
  const frontierCandidates = candidates.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    createdAt: issue.createdAt.toISOString(),
    subIssueSortOrder: issue.subIssueSortOrder ?? null,
    labelIds: issue.labelIds
  }))
  const result = paginateFrontier(frontierCandidates, typeLabels, first, after)
  return {
    map: { id: map.id, identifier: map.identifier, title: map.title },
    total: frontierCandidates.length,
    items: result.items,
    pageInfo: result.pageInfo
  }
}

const findCommentByUuid = async (client: LinearClient, id: string): Promise<Comment | undefined> => {
  const identity = normalizeUuid(id)
  const comments = await fetchAllPages(
    await client.comments({ first: 50, includeArchived: true, filter: { id: { eq: identity } } })
  )
  const matches = comments.filter((comment) => uuidEqual(comment.id, identity))
  const active = matches.filter((comment) => !comment.archivedAt)
  if (active.length > 1) {
    throw new LinearDomainError({ message: `Ambiguous Linear comment ${id}`, help: "Retry with an exact unique UUID." })
  }
  if (active.length === 1) {
    return active[0]
  }
  if (matches.some((comment) => Boolean(comment.archivedAt))) {
    throw conflict(
      `Linear comment ${id} is archived`,
      "Restore the archived comment in Linear or use a different caller-retained UUID."
    )
  }
  return undefined
}

const issueSummary = async (
  issue: Issue,
  fields?: ReadonlySet<string>
): Promise<IssueSummary> => {
  const requested = (field: string): boolean => fields === undefined || fields.has(field)
  const [state, assignee, parent, labels] = await Promise.all([
    requested("state") ? issue.state : undefined,
    requested("assignee") ? issue.assignee : undefined,
    requested("parent") ? issue.parent : undefined,
    requested("labels") ? loadIssueLabels(issue, true) : []
  ])
  const labelRefs = labels
    .map((label) => ({ id: label.id, name: label.name }))
    .sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id))
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
    labels: labelRefs,
    updatedAt: issue.updatedAt.toISOString(),
    createdAt: issue.createdAt.toISOString(),
    url: issue.url,
    subIssueSortOrder: issue.subIssueSortOrder ?? null
  }
}

const loadIssueLabels = async (issue: Issue, includeArchived: boolean): Promise<ReadonlyArray<IssueLabel>> =>
  fetchAllPages(await issue.labels({ first: 100, includeArchived }))

const issueDetail = async (issue: Issue): Promise<IssueDetail> => {
  const summary = await issueSummary(issue)
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

const labelSummaries = async (
  labels: ReadonlyArray<IssueLabel>,
  fields?: ReadonlyArray<string>,
  knownTeamKey?: string
): Promise<ReadonlyArray<LabelSummary>> => {
  const projectsScope = fields === undefined || fields.includes("scope")
  if (!projectsScope) {
    return Promise.all(labels.map((label) => labelSummary(label, undefined, false)))
  }

  const teamKeys = new Map<string, Promise<string | undefined>>()
  return Promise.all(labels.map(async (label) => {
    if (!label.teamId || knownTeamKey) {
      return labelSummary(label, knownTeamKey, false)
    }
    const teamId = label.teamId.toLowerCase()
    let teamKey = teamKeys.get(teamId)
    if (!teamKey) {
      teamKey = Promise.resolve(label.team).then((team) => team?.key)
      teamKeys.set(teamId, teamKey)
    }
    return labelSummary(label, await teamKey, false)
  }))
}

const labelSummary = async (
  label: IssueLabel,
  knownTeamKey?: string,
  resolveTeam = true
): Promise<LabelSummary> => {
  const team = label.teamId && !knownTeamKey && resolveTeam ? await label.team : undefined
  return {
    id: label.id,
    name: label.name,
    scope: label.teamId === undefined ? "workspace" : (knownTeamKey ?? team?.key ?? label.teamId),
    teamId: label.teamId ?? null,
    parentId: label.parentId ?? null,
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
  const botActor = comment.botActor
  const externalUser = user || botActor ? undefined : await comment.externalUser
  return {
    id: comment.id,
    issueId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    author: user?.name || (botActor ? botActor.name || botActor.type : externalUser?.name) || "unknown",
    url: comment.url
  }
}

const requireOrdinaryLabel = (label: IssueLabel): void => {
  if (label.isGroup) {
    throw conflict(
      `label group ${label.name} conflicts with the requested ordinary label`,
      "Choose an ordinary label name and caller-retained UUID."
    )
  }
}

const labelBelongsToScope = (label: IssueLabel, teamId: string | null): boolean =>
  teamId === null
    ? label.teamId === undefined
    : label.teamId !== undefined && uuidEqual(label.teamId, teamId)

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

const relationMatches = (
  relation: IssueRelation,
  sourceId: string,
  targetId: string,
  type: RelationType
): boolean => relation.type === type &&
  relation.issueId !== undefined && uuidEqual(relation.issueId, sourceId) &&
  relation.relatedIssueId !== undefined && uuidEqual(relation.relatedIssueId, targetId)

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

const parseLocalCursor = (cursor: string | undefined, kind: LocalCursorKind): number => {
  if (cursor === undefined) {
    return 0
  }
  const offset = decodeLocalCursorOffset(cursor, kind)
  if (offset === undefined) {
    throw new LinearDomainError({
      message: `invalid ${kind} cursor`,
      help: `Use the exact page.endCursor returned by the previous ${kind} list command.`
    })
  }
  return offset
}

const readableError = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message.replaceAll(/\s+/g, " ").trim()
  }
  return "Linear request failed"
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const nullableUuidEqual = (left: string | null, right: string | null): boolean =>
  left === null || right === null ? left === right : uuidEqual(left, right)
