import { LinearError, type Issue, type IssueLabel, type IssueRelation, type LinearClient, type Team, type User, type WorkflowState } from "@linear/sdk"
import { LinearDomainError } from "./errors"
import { fetchAllPages } from "./linear-pagination"

export const resolveTeam = async (client: LinearClient, keyOrId: string): Promise<Team> => {
  const identity = normalizeUuid(keyOrId)
  const teams = await fetchAllPages(
    await client.teams({
      first: 50,
      includeArchived: true,
      filter: isUuid(identity)
        ? { id: { eq: identity } }
        : { key: { eqIgnoreCase: identity } }
    })
  )
  const matches = teams.filter((team) =>
    isUuid(identity) ? uuidEqual(team.id, identity) : team.key.toLowerCase() === identity.toLowerCase()
  )
  return exactlyOneActive(
    `team ${keyOrId}`,
    matches,
    (team) => `${team.id} (${team.key})`,
    (team) => team.archivedAt
  )
}

export const resolveTeamReference = async (
  client: LinearClient,
  idKeyOrName: string,
  includeArchived = false
): Promise<Team> => {
  const identity = normalizeUuid(idKeyOrName)
  const normalized = identity.toLowerCase()
  const teams = await fetchAllPages(
    await client.teams({
      first: 50,
      includeArchived: true,
      filter: isUuid(identity)
        ? { id: { eq: identity } }
        : { or: [{ key: { eqIgnoreCase: identity } }, { name: { eqIgnoreCase: identity } }] }
    })
  )
  const matches = teams.filter((team) => isUuid(identity)
    ? uuidEqual(team.id, identity)
    : team.key.toLowerCase() === normalized || team.name.toLowerCase() === normalized)
  return includeArchived
    ? exactlyOne(`team ${idKeyOrName}`, matches, (team) => `${team.id} (${team.key}, ${team.name})`)
    : exactlyOneActive(
        `team ${idKeyOrName}`,
        matches,
        (team) => `${team.id} (${team.key}, ${team.name})`,
        (team) => team.archivedAt
      )
}

export const resolveInitiative = async (
  client: LinearClient,
  idOrName: string,
  includeArchived = false
) => {
  const identity = normalizeUuid(idOrName)
  const normalized = identity.toLowerCase()
  const initiatives = await fetchAllPages(
    await client.initiatives({
      first: 50,
      includeArchived: true,
      filter: isUuid(identity)
        ? { id: { eq: identity } }
        : { name: { eqIgnoreCase: identity } }
    })
  )
  const matches = initiatives.filter((initiative) => isUuid(identity)
    ? uuidEqual(initiative.id, identity)
    : initiative.name.toLowerCase() === normalized)
  return includeArchived
    ? exactlyOne(`initiative ${idOrName}`, matches, (initiative) => `${initiative.id} (${initiative.name})`)
    : exactlyOneActive(
        `initiative ${idOrName}`,
        matches,
        (initiative) => `${initiative.id} (${initiative.name})`,
        (initiative) => initiative.archivedAt
      )
}

export const resolveIssue = async (client: LinearClient, idOrKey: string): Promise<Issue> => {
  const identity = normalizeUuid(idOrKey)
  const normalized = identity.toLowerCase()
  if (isUuid(identity)) {
    const issues = await fetchAllPages(
      await client.issues({ first: 50, includeArchived: true, filter: { id: { eq: identity } } })
    )
    return exactlyOneActive(
      `issue ${idOrKey}`,
      issues.filter((issue) => uuidEqual(issue.id, identity)),
      (issue) => `${issue.id} (${issue.identifier})`,
      (issue) => issue.archivedAt
    )
  }

  const identifier = /^(.*)-([0-9]+)$/.exec(identity)
  const issues = identifier && identifier[1]
    ? await fetchAllPages(
        await client.issues({
          first: 50,
          includeArchived: true,
          filter: {
            number: { eq: Number(identifier[2]) },
            team: { key: { eqIgnoreCase: identifier[1] } }
          }
        })
      )
    : []
  return exactlyOneActive(
    `issue ${idOrKey}`,
    issues.filter((issue) => issue.identifier.toLowerCase() === normalized),
    (issue) => `${issue.id} (${issue.identifier})`,
    (issue) => issue.archivedAt
  )
}

export const findIssueByUuid = async (client: LinearClient, id: string): Promise<Issue | undefined> => {
  const identity = normalizeUuid(id)
  const issues = await fetchAllPages(
    await client.issues({ first: 50, includeArchived: true, filter: { id: { eq: identity } } })
  )
  return findOneActive(
    `issue ${id}`,
    issues.filter((issue) => uuidEqual(issue.id, identity)),
    (issue) => `${issue.id} (${issue.identifier})`,
    (issue) => issue.archivedAt
  )
}

export const resolveUser = async (client: LinearClient, selector: string): Promise<User> => {
  if (selector === "me") {
    return client.viewer
  }
  const identity = normalizeUuid(selector)
  const normalized = identity.toLowerCase()
  const users = await fetchAllPages(
    await client.users({
      first: 50,
      includeArchived: true,
      includeDisabled: true,
      filter: isUuid(identity)
        ? { id: { eq: identity } }
        : {
            or: [
              { name: { eqIgnoreCase: identity } },
              { displayName: { eqIgnoreCase: identity } },
              { email: { eqIgnoreCase: identity } }
            ]
          }
    })
  )
  const matches = users.filter((user) => isUuid(identity)
    ? uuidEqual(user.id, identity)
    : [user.name, user.displayName, user.email]
      .some((value) => value?.toLowerCase() === normalized))
  return exactlyOne(
    `user ${selector}`,
    matches,
    (user) => `${user.id} (${user.name}${user.email ? `, ${user.email}` : ""})`
  )
}

export const resolveAssignableUser = async (client: LinearClient, idOrMe: string): Promise<User> => {
  const user = await resolveUser(client, idOrMe)
  if (user.archivedAt) {
    throw new LinearDomainError({
      message: `Linear user ${user.id} is archived and cannot be assigned issues`,
      help: "Choose an active assignable user."
    })
  }
  if (!user.active) {
    throw new LinearDomainError({
      message: `Linear user ${user.id} is disabled and cannot be assigned issues`,
      help: "Choose an active assignable user."
    })
  }
  if (!user.isAssignable) {
    throw new LinearDomainError({
      message: `Linear user ${user.id} cannot be assigned issues`,
      help: "Choose an active assignable user."
    })
  }
  return user
}

const findLabelsForTeam = async (
  client: LinearClient,
  idOrName: string,
  teamId: string
): Promise<ReadonlyArray<IssueLabel>> => {
  const identity = normalizeUuid(idOrName)
  const normalizedTeamId = normalizeUuid(teamId)
  const labels = await fetchAllPages(
    await client.issueLabels({
      first: 50,
      includeArchived: true,
      filter: isUuid(identity)
        ? { id: { eq: identity } }
        : {
            name: { eqIgnoreCase: identity },
            or: [{ team: { null: true } }, { team: { id: { eq: normalizedTeamId } } }]
          }
    })
  )
  const normalized = identity.toLowerCase()
  return labels.filter((label) => {
    const identityMatches = isUuid(identity)
      ? uuidEqual(label.id, identity)
      : label.name.toLowerCase() === normalized
    return identityMatches && (label.teamId === undefined || uuidEqual(label.teamId, normalizedTeamId))
  })
}

export const resolveLabelForTeam = async (
  client: LinearClient,
  idOrName: string,
  teamId: string
): Promise<IssueLabel> => exactlyOneActive(
  `label ${idOrName}`,
  await findLabelsForTeam(client, idOrName, teamId),
  labelCandidate,
  (label) => label.archivedAt
)

export const resolveLabelForRemoval = async (
  issue: Issue,
  idOrName: string,
  teamId: string
): Promise<IssueLabel | undefined> => {
  const identity = normalizeUuid(idOrName)
  const normalized = identity.toLowerCase()
  const normalizedTeamId = normalizeUuid(teamId)
  const attached = await fetchAllPages(await issue.labels({ first: 100, includeArchived: true }))
  const matches = attached.filter((label) =>
    (isUuid(identity) ? uuidEqual(label.id, identity) : label.name.toLowerCase() === normalized) &&
    (label.teamId === undefined || uuidEqual(label.teamId, normalizedTeamId)))
  if (matches.length > 1) throw ambiguity(`attached label ${idOrName}`, matches, labelCandidate)
  return matches[0]
}

export const resolveLabelGlobally = async (client: LinearClient, idOrName: string): Promise<IssueLabel> => {
  const identity = normalizeUuid(idOrName)
  const labels = await fetchAllPages(
    await client.issueLabels({
      first: 50,
      includeArchived: true,
      filter: isUuid(identity)
        ? { id: { eq: identity } }
        : { name: { eqIgnoreCase: identity } }
    })
  )
  const normalized = identity.toLowerCase()
  const matches = labels.filter((label) =>
    isUuid(identity) ? uuidEqual(label.id, identity) : label.name.toLowerCase() === normalized
  )
  return exactlyOneActive(`label ${idOrName}`, matches, labelCandidate, (label) => label.archivedAt)
}

export const resolveLabelInScope = async (
  client: LinearClient,
  idOrName: string,
  teamId: string | null
): Promise<IssueLabel> => {
  const labels = await findLabelsInScopeByIdentity(
    client,
    idOrName,
    teamId,
    isUuid(idOrName) ? "id" : "name",
    true
  )
  return exactlyOneActive(`label ${idOrName}`, labels, labelCandidate, (label) => label.archivedAt)
}

export const findLabelByUuid = async (
  client: LinearClient,
  id: string
): Promise<IssueLabel | undefined> => {
  const identity = normalizeUuid(id)
  const labels = await fetchAllPages(
    await client.issueLabels({
      first: 50,
      includeArchived: true,
      filter: { id: { eq: identity } }
    })
  )
  return findOneActive(
    `label ${id}`,
    labels.filter((label) => uuidEqual(label.id, identity)),
    labelCandidate,
    (label) => label.archivedAt
  )
}

export const findLabelByNameInScope = (
  client: LinearClient,
  name: string,
  teamId: string | null
): Promise<IssueLabel | undefined> => findOneLabelInScope(client, name, teamId, "name")

export const findLabelsInScope = (
  client: LinearClient,
  idOrName: string,
  teamId: string | null
): Promise<ReadonlyArray<IssueLabel>> =>
  findLabelsInScopeByIdentity(client, idOrName, teamId, isUuid(idOrName) ? "id" : "name")

const findOneLabelInScope = async (
  client: LinearClient,
  value: string,
  teamId: string | null,
  identity: "id" | "name"
): Promise<IssueLabel | undefined> => {
  const labels = await findLabelsInScopeByIdentity(client, value, teamId, identity, true)
  return findOneActive(`label ${value}`, labels, labelCandidate, (label) => label.archivedAt)
}

const findLabelsInScopeByIdentity = async (
  client: LinearClient,
  value: string,
  teamId: string | null,
  identity: "id" | "name",
  includeArchived = false
): Promise<ReadonlyArray<IssueLabel>> => {
  const normalizedValue = identity === "id" ? normalizeUuid(value) : value
  const normalizedTeamId = teamId === null ? null : normalizeUuid(teamId)
  const labels = await fetchAllPages(
    await client.issueLabels({
      first: 50,
      includeArchived: true,
      filter: {
        ...(identity === "id" ? { id: { eq: normalizedValue } } : { name: { eqIgnoreCase: normalizedValue } }),
        team: normalizedTeamId === null ? { null: true } : { id: { eq: normalizedTeamId } }
      }
    })
  )
  const normalizedName = normalizedValue.toLowerCase()
  return labels.filter((label) =>
    (identity === "id" ? uuidEqual(label.id, normalizedValue) : label.name.toLowerCase() === normalizedName) &&
    (normalizedTeamId === null ? label.teamId === undefined : label.teamId !== undefined && uuidEqual(label.teamId, normalizedTeamId)) &&
    (includeArchived || !label.archivedAt)
  )
}

export const findRelationByUuid = async (client: LinearClient, id: string): Promise<IssueRelation | undefined> => {
  const relation = await lookupRelationByUuid(client, id)
  if (!relation) {
    return undefined
  }
  return findOneActive(
    `issue relation ${id}`,
    [relation],
    (match) => match.id,
    (match) => match.archivedAt
  )
}

export const lookupRelationByUuid = async (client: LinearClient, id: string): Promise<IssueRelation | undefined> => {
  const identity = normalizeUuid(id)
  let relation: IssueRelation
  try {
    relation = await client.issueRelation(identity)
  } catch (cause) {
    if (isMissingIssueRelation(cause)) {
      return undefined
    }
    throw cause
  }
  if (!uuidEqual(relation.id, identity)) {
    throw new LinearDomainError({
      message: `Linear issue relation lookup for ${id} returned a different identity`,
      help: "Retry with the exact caller-retained relation UUID."
    })
  }
  return relation
}

const isMissingIssueRelation = (cause: unknown): boolean => {
  if (cause instanceof LinearError) {
    return cause.errors?.some((error) =>
      error.path?.includes("issueRelation") === true && /not found/i.test(error.message)
    ) === true
  }
  return cause instanceof Error && /^Entity not found: IssueRelation$/i.test(cause.message.trim())
}

export const resolveWorkflowState = async (
  client: LinearClient,
  idOrName: string,
  teamId: string
): Promise<WorkflowState> => {
  const identity = normalizeUuid(idOrName)
  const normalizedTeamId = normalizeUuid(teamId)
  const states = await fetchAllPages(
    await client.workflowStates({
      first: 50,
      includeArchived: true,
      filter: {
        ...(isUuid(identity) ? { id: { eq: identity } } : { name: { eqIgnoreCase: identity } }),
        team: { id: { eq: normalizedTeamId } }
      }
    })
  )
  return exactlyOneActive(
    `workflow state ${idOrName}`,
    states.filter((state) => isUuid(identity)
      ? uuidEqual(state.id, identity)
      : state.name.toLowerCase() === identity.toLowerCase()),
    (state) => `${state.id} (${state.name})`,
    (state) => state.archivedAt
  )
}

export const completedStates = async (client: LinearClient, teamId: string): Promise<ReadonlyArray<WorkflowState>> =>
  fetchAllPages(
    await client.workflowStates({
      first: 50,
      includeArchived: false,
      filter: { team: { id: { eq: normalizeUuid(teamId) } }, type: { eq: "completed" } }
    })
  )

export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export const normalizeUuid = (value: string): string => isUuid(value) ? value.toLowerCase() : value

export const uuidEqual = (left: string, right: string): boolean =>
  normalizeUuid(left) === normalizeUuid(right)

const exactlyOne = <Value>(
  description: string,
  matches: ReadonlyArray<Value>,
  candidate: (value: Value) => string
): Value => {
  if (matches.length === 0) {
    throw notFound(description)
  }
  if (matches.length > 1) {
    throw ambiguity(description, matches, candidate)
  }
  return matches[0]!
}

const exactlyOneActive = <Value>(
  description: string,
  matches: ReadonlyArray<Value>,
  candidate: (value: Value) => string,
  archivedAt: (value: Value) => unknown
): Value => {
  const match = findOneActive(description, matches, candidate, archivedAt)
  if (!match) {
    throw notFound(description)
  }
  return match
}

const findOneActive = <Value>(
  description: string,
  matches: ReadonlyArray<Value>,
  candidate: (value: Value) => string,
  archivedAt: (value: Value) => unknown
): Value | undefined => {
  const active = matches.filter((value) => !archivedAt(value))
  if (active.length > 1) {
    throw ambiguity(description, active, candidate)
  }
  if (active.length === 1) {
    return active[0]
  }
  const archived = matches.filter((value) => Boolean(archivedAt(value)))
  if (archived.length > 0) {
    throw new LinearDomainError({
      message: `Linear ${description} is archived; matched ${archived.map(candidate).join(", ")}`,
      help: "Restore the archived object in Linear or retry with a different active identity."
    })
  }
  return undefined
}

const notFound = (description: string): LinearDomainError =>
  new LinearDomainError({
    message: `No Linear ${description} matched`,
    help: "List the relevant objects and retry with an exact UUID."
  })

const ambiguity = <Value>(
  description: string,
  matches: ReadonlyArray<Value>,
  candidate: (value: Value) => string
): LinearDomainError =>
  new LinearDomainError({
    message: `Ambiguous Linear ${description}; matched ${matches.map(candidate).join(", ")}`,
    help: "Retry with the exact UUID of the intended object."
  })

const labelCandidate = (label: IssueLabel): string =>
  `${label.id} (${label.name}, ${label.teamId === undefined ? "workspace" : `team ${label.teamId}`})`
