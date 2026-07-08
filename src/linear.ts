import { LinearClient, type Issue, type Team } from "@linear/sdk"
import { Effect } from "effect"
import { AuthError, LinearApiError } from "./errors"

export interface Credentials {
  kind: "apiKey" | "accessToken"
  value: string
}

export interface LinearGateway {
  authStatus(): Effect.Effect<AuthStatus, AuthError | LinearApiError>
  listTeams(limit: number): Effect.Effect<ReadonlyArray<TeamSummary>, AuthError | LinearApiError>
  listIssues(input: ListIssuesInput): Effect.Effect<ReadonlyArray<IssueSummary>, AuthError | LinearApiError>
  viewIssue(id: string): Effect.Effect<IssueDetail, AuthError | LinearApiError>
  createIssue(input: CreateIssueInput): Effect.Effect<IssueSummary, AuthError | LinearApiError>
  createComment(input: CreateCommentInput): Effect.Effect<CommentSummary, AuthError | LinearApiError>
}

export interface AuthStatus {
  authenticated: boolean
  method: "apiKey" | "accessToken" | "none"
  viewer?: {
    id: string
    name: string
  }
}

export interface TeamSummary {
  id: string
  key: string
  name: string
}

export interface IssueSummary {
  id: string
  identifier: string
  title: string
  state: string
  assignee: string
  updatedAt: string
  url: string
}

export interface IssueDetail extends IssueSummary {
  description: string
  priority: number
  team: string
}

export interface CommentSummary {
  id: string
  issueId: string
  body: string
  url: string
}

export interface ListIssuesInput {
  limit: number
  assignee?: string
  team?: string
}

export interface CreateIssueInput {
  team: string
  title: string
  description?: string
}

export interface CreateCommentInput {
  issue: string
  body: string
}

export const credentialsFromEnv = (env: NodeJS.ProcessEnv): Credentials | undefined => {
  const apiKey = env.LINEAR_API_KEY
  if (apiKey && apiKey.length > 0) {
    return { kind: "apiKey", value: apiKey }
  }

  const accessToken = env.LINEAR_ACCESS_TOKEN
  if (accessToken && accessToken.length > 0) {
    return { kind: "accessToken", value: accessToken }
  }

  return undefined
}

export const makeLinearGateway = (env: NodeJS.ProcessEnv): LinearGateway => {
  const credentials = credentialsFromEnv(env)

  const getClient = (): Effect.Effect<LinearClient, AuthError> => {
    if (!credentials) {
      return Effect.fail(new AuthError({
        message: "Linear credentials are not configured",
        help: "Set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN."
      }))
    }

    return Effect.succeed(
      credentials.kind === "apiKey"
        ? new LinearClient({ apiKey: credentials.value })
        : new LinearClient({ accessToken: credentials.value })
    )
  }

  const call = <A>(name: string, run: (client: LinearClient) => Promise<A>) =>
    Effect.gen(function*() {
      const client = yield* getClient()
      return yield* Effect.tryPromise({
        try: () => run(client),
        catch: (cause) =>
          new LinearApiError({
            message: readableError(cause),
            help: `Retry \`linear-axi ${name}\` after checking Linear access.`
          })
      })
    })

  return {
    authStatus: () =>
      credentials === undefined
        ? Effect.succeed({ authenticated: false, method: "none" })
        : call("auth status", async (client) => {
            const viewer = await client.viewer
            return {
              authenticated: true,
              method: credentials.kind,
              viewer: {
                id: viewer.id,
                name: viewer.name
              }
            }
          }),

    listTeams: (limit) =>
      call("teams list", async (client) => {
        const teams = await client.teams({ first: limit })
        return teams.nodes.map(teamSummary)
      }),

    listIssues: (input) =>
      call("issues list", async (client) => {
        if (input.team) {
          const team = await findTeam(client, input.team)
          const issues = await team.issues({ first: input.limit })
          return Promise.all(issues.nodes.map(issueSummary))
        }

        if (input.assignee === "me") {
          const viewer = await client.viewer
          const issues = await viewer.assignedIssues({ first: input.limit })
          return Promise.all(issues.nodes.map(issueSummary))
        }

        const issues = await client.issues({ first: input.limit })
        return Promise.all(issues.nodes.map(issueSummary))
      }),

    viewIssue: (id) =>
      call("issues view", async (client) => {
        const issue = await findIssue(client, id)
        return issueDetail(issue)
      }),

    createIssue: (input) =>
      call("issues create", async (client) => {
        const team = await findTeam(client, input.team)
        const payload = await client.createIssue({
          teamId: team.id,
          title: input.title,
          description: input.description
        })

        if (!payload.success || !payload.issue) {
          throw new Error("Linear did not create the issue")
        }

        return issueSummary(await payload.issue)
      }),

    createComment: (input) =>
      call("comments create", async (client) => {
        const issue = await findIssue(client, input.issue)
        const payload = await client.createComment({
          issueId: issue.id,
          body: input.body
        })

        if (!payload.success || !payload.comment) {
          throw new Error("Linear did not create the comment")
        }

        const comment = await payload.comment
        return {
          id: comment.id,
          issueId: issue.id,
          body: comment.body,
          url: issue.url
        }
      })
  }
}

const findTeam = async (client: LinearClient, keyOrId: string): Promise<Team> => {
  if (isUuid(keyOrId)) {
    return client.team(keyOrId)
  }

  const teams = await client.teams({
    first: 2,
    filter: {
      key: { eqIgnoreCase: keyOrId }
    }
  })
  const match = teams.nodes.find(
    (team) => team.key.toLowerCase() === keyOrId.toLowerCase()
  )

  if (!match) {
    throw new Error(`No Linear team matched ${keyOrId}`)
  }

  return match
}

const findIssue = async (client: LinearClient, idOrKey: string): Promise<Issue> => {
  return client.issue(idOrKey)
}

const teamSummary = (team: Team): TeamSummary => ({
  id: team.id,
  key: team.key,
  name: team.name
})

const issueSummary = async (issue: Issue): Promise<IssueSummary> => {
  const state = await issue.state
  const assignee = await issue.assignee

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: state?.name ?? "unknown",
    assignee: assignee?.name ?? "unassigned",
    updatedAt: issue.updatedAt.toISOString(),
    url: issue.url
  }
}

const issueDetail = async (issue: Issue): Promise<IssueDetail> => {
  const summary = await issueSummary(issue)
  const team = await issue.team

  return {
    ...summary,
    description: issue.description ?? "",
    priority: issue.priority,
    team: team?.key ?? "unknown"
  }
}

const readableError = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message.replaceAll(/\s+/g, " ").trim()
  }

  return "Linear request failed"
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
