import type { Issue, IssueLabel, LinearClient, Team, User, WorkflowState } from "@linear/sdk"
import { LinearDomainError } from "./errors"
import { fetchAllPages } from "./linear-pagination"

export const resolveTeam = async (client: LinearClient, keyOrId: string): Promise<Team> => {
  const teams = await fetchAllPages(
    await client.teams({
      first: 50,
      filter: isUuid(keyOrId)
        ? { id: { eq: keyOrId } }
        : { key: { eqIgnoreCase: keyOrId } }
    })
  )
  const matches = teams.filter((team) =>
    isUuid(keyOrId) ? team.id === keyOrId : team.key.toLowerCase() === keyOrId.toLowerCase()
  )
  return exactlyOne(`team ${keyOrId}`, matches, (team) => `${team.id} (${team.key})`)
}

export const resolveIssue = async (client: LinearClient, idOrKey: string): Promise<Issue> => {
  const normalized = idOrKey.toLowerCase()
  if (isUuid(idOrKey)) {
    const issues = await fetchAllPages(
      await client.issues({ first: 50, includeArchived: true, filter: { id: { eq: idOrKey } } })
    )
    return exactlyOne(
      `issue ${idOrKey}`,
      issues.filter((issue) => issue.id.toLowerCase() === normalized),
      (issue) => `${issue.id} (${issue.identifier})`
    )
  }

  const identifier = /^(.*)-([0-9]+)$/.exec(idOrKey)
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
  return exactlyOne(
    `issue ${idOrKey}`,
    issues.filter((issue) => issue.identifier.toLowerCase() === normalized),
    (issue) => `${issue.id} (${issue.identifier})`
  )
}

export const findIssueByUuid = async (client: LinearClient, id: string): Promise<Issue | undefined> => {
  const issues = await fetchAllPages(
    await client.issues({ first: 50, includeArchived: true, filter: { id: { eq: id } } })
  )
  const matches = issues.filter((issue) => issue.id === id)
  if (matches.length > 1) {
    throw ambiguity(`issue ${id}`, matches, (issue) => `${issue.id} (${issue.identifier})`)
  }
  return matches[0]
}

export const resolveUser = async (client: LinearClient, idOrMe: string): Promise<User> => {
  if (idOrMe === "me") {
    return client.viewer
  }
  if (!isUuid(idOrMe)) {
    throw new LinearDomainError({
      message: `assignee ${idOrMe} is not ` + "`me` or a user UUID",
      help: "Use `--assignee me` or an exact user UUID."
    })
  }

  const users = await fetchAllPages(await client.users({ first: 50, filter: { id: { eq: idOrMe } } }))
  return exactlyOne(`user ${idOrMe}`, users.filter((user) => user.id === idOrMe), (user) => user.id)
}

export const resolveLabelForTeam = async (
  client: LinearClient,
  idOrName: string,
  teamId: string
): Promise<IssueLabel> => {
  const labels = await fetchAllPages(
    await client.issueLabels({
      first: 50,
      includeArchived: true,
      filter: isUuid(idOrName)
        ? { id: { eq: idOrName } }
        : {
            name: { eqIgnoreCase: idOrName },
            or: [{ team: { null: true } }, { team: { id: { eq: teamId } } }]
          }
    })
  )
  const normalized = idOrName.toLowerCase()
  const matches = labels.filter((label) => {
    const identityMatches = isUuid(idOrName)
      ? label.id === idOrName
      : label.name.toLowerCase() === normalized
    return identityMatches && (label.teamId === undefined || label.teamId === teamId)
  })
  return exactlyOne(`label ${idOrName}`, matches, labelCandidate)
}

export const resolveLabelGlobally = async (client: LinearClient, idOrName: string): Promise<IssueLabel> => {
  const labels = await fetchAllPages(
    await client.issueLabels({
      first: 50,
      includeArchived: true,
      filter: isUuid(idOrName)
        ? { id: { eq: idOrName } }
        : { name: { eqIgnoreCase: idOrName } }
    })
  )
  const normalized = idOrName.toLowerCase()
  const matches = labels.filter((label) =>
    isUuid(idOrName) ? label.id === idOrName : label.name.toLowerCase() === normalized
  )
  return exactlyOne(`label ${idOrName}`, matches, labelCandidate)
}

export const resolveLabelInScope = async (
  client: LinearClient,
  idOrName: string,
  teamId: string | null
): Promise<IssueLabel> => {
  const labels = await findLabelsInScope(client, idOrName, teamId)
  return exactlyOne(`label ${idOrName}`, labels, labelCandidate)
}

export const findLabelByIdInScope = (
  client: LinearClient,
  id: string,
  teamId: string | null
): Promise<IssueLabel | undefined> => findOneLabelInScope(client, id, teamId, "id")

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
  const labels = await findLabelsInScopeByIdentity(client, value, teamId, identity)
  if (labels.length > 1) {
    throw ambiguity(`label ${value}`, labels, labelCandidate)
  }
  return labels[0]
}

const findLabelsInScopeByIdentity = async (
  client: LinearClient,
  value: string,
  teamId: string | null,
  identity: "id" | "name"
): Promise<ReadonlyArray<IssueLabel>> => {
  const labels = await fetchAllPages(
    await client.issueLabels({
      first: 50,
      includeArchived: true,
      filter: {
        ...(identity === "id" ? { id: { eq: value } } : { name: { eqIgnoreCase: value } }),
        team: teamId === null ? { null: true } : { id: { eq: teamId } }
      }
    })
  )
  const normalized = value.toLowerCase()
  return labels.filter((label) =>
    (identity === "id" ? label.id === value : label.name.toLowerCase() === normalized) &&
    (teamId === null ? label.teamId === undefined : label.teamId === teamId)
  )
}

export const resolveWorkflowState = async (
  client: LinearClient,
  id: string,
  teamId: string
): Promise<WorkflowState> => {
  const states = await fetchAllPages(
    await client.workflowStates({ first: 50, filter: { id: { eq: id }, team: { id: { eq: teamId } } } })
  )
  return exactlyOne(`workflow state ${id}`, states.filter((state) => state.id === id), (state) => `${state.id} (${state.name})`)
}

export const completedStates = async (client: LinearClient, teamId: string): Promise<ReadonlyArray<WorkflowState>> =>
  fetchAllPages(
    await client.workflowStates({
      first: 50,
      filter: { team: { id: { eq: teamId } }, type: { eq: "completed" } }
    })
  )

export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const exactlyOne = <Value>(
  description: string,
  matches: ReadonlyArray<Value>,
  candidate: (value: Value) => string
): Value => {
  if (matches.length === 0) {
    throw new LinearDomainError({
      message: `No Linear ${description} matched`,
      help: "List the relevant objects and retry with an exact UUID."
    })
  }
  if (matches.length > 1) {
    throw ambiguity(description, matches, candidate)
  }
  return matches[0]!
}

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
