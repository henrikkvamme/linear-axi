import type { LinearClient } from "@linear/sdk"
import { type Effect } from "effect"
import type { AuthError, LinearApiError, LinearDomainError } from "./errors"
import { makeSdkLinearGateway } from "./linear-sdk"
import type { FrontierIssue } from "./wayfinder"

export const DESCRIPTION_CONCURRENCY_WARNING =
  "Known-stale writes are rejected and the result is refetched, but Linear has no atomic compare-and-swap; a final read/write race remains."

export interface Credentials {
  readonly kind: "apiKey" | "accessToken"
  readonly value: string
}

export type GatewayError = AuthError | LinearApiError | LinearDomainError

export interface LinearGateway {
  authStatus(): Effect.Effect<AuthStatus, GatewayError>
  listTeams(limit: number): Effect.Effect<ReadonlyArray<TeamSummary>, GatewayError>
  listIssues(input: ListIssuesInput): Effect.Effect<PageResult<IssueSummary>, GatewayError>
  viewIssue(id: string): Effect.Effect<IssueDetail, GatewayError>
  createIssue(input: CreateIssueInput): Effect.Effect<MutationResult<IssueSummary>, GatewayError>
  assignIssue(input: AssignIssueInput): Effect.Effect<MutationResult<IssueSummary>, GatewayError>
  unassignIssue(input: UnassignIssueInput): Effect.Effect<MutationResult<IssueSummary>, GatewayError>
  closeIssue(input: CloseIssueInput): Effect.Effect<MutationResult<IssueSummary>, GatewayError>
  updateIssueDescription(input: UpdateIssueDescriptionInput): Effect.Effect<MutationResult<IssueDetail>, GatewayError>
  listLabels(input: ListLabelsInput): Effect.Effect<PageResult<LabelSummary>, GatewayError>
  createLabel(input: CreateLabelInput): Effect.Effect<MutationResult<LabelSummary>, GatewayError>
  applyLabel(input: ApplyLabelInput): Effect.Effect<MutationResult<IssueSummary>, GatewayError>
  listRelations(input: ListRelationsInput): Effect.Effect<PageResult<RelationSummary>, GatewayError>
  createRelation(input: CreateRelationInput): Effect.Effect<MutationResult<RelationSummary>, GatewayError>
  listComments(input: ListCommentsInput): Effect.Effect<PageResult<CommentSummary>, GatewayError>
  createComment(input: CreateCommentInput): Effect.Effect<MutationResult<CommentSummary>, GatewayError>
  frontier(input: FrontierInput): Effect.Effect<FrontierResult, GatewayError>
}

export interface AuthStatus {
  readonly authenticated: boolean
  readonly method: "apiKey" | "accessToken" | "none"
  readonly viewer?: {
    readonly id: string
    readonly name: string
  }
}

export interface TeamSummary {
  readonly id: string
  readonly key: string
  readonly name: string
}

export interface LabelRef {
  readonly id: string
  readonly name: string
}

export interface IssueSummary {
  readonly id: string
  readonly identifier: string
  readonly title: string
  readonly state: string
  readonly stateType: string
  readonly assignee: string
  readonly assigneeId: string | null
  readonly parent: string | null
  readonly parentId: string | null
  readonly labels: ReadonlyArray<LabelRef>
  readonly updatedAt: string
  readonly createdAt: string
  readonly url: string
  readonly subIssueSortOrder: number | null
}

export interface IssueDetail extends IssueSummary {
  readonly description: string
  readonly priority: number
  readonly team: string
  readonly teamId: string
}

export interface LabelSummary {
  readonly id: string
  readonly name: string
  readonly scope: string
  readonly teamId: string | null
  readonly color: string
  readonly description: string
  readonly isGroup: boolean
  readonly archivedAt: string | null
}

export interface RelationSummary {
  readonly id: string
  readonly type: RelationType
  readonly direction: RelationDirection
  readonly identifier: string
  readonly title: string
  readonly state: string
  readonly sourceId: string
  readonly targetId: string
}

export interface CommentSummary {
  readonly id: string
  readonly issueId: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly author: string
  readonly url: string
}

export interface PageResult<Value> {
  readonly items: ReadonlyArray<Value>
  readonly page: {
    readonly hasNext: boolean
    readonly endCursor: string | null
  }
}

export interface MutationResult<Value> {
  readonly value: Value
  readonly changed: boolean
  readonly result: string
}

export interface ListIssuesInput {
  readonly limit: number
  readonly after?: string
  readonly assignee?: string
  readonly team?: string
  readonly label?: string
  readonly parent?: string
  readonly state?: "open" | "closed"
}

export interface CreateIssueInput {
  readonly team: string
  readonly title: string
  readonly description?: string
  readonly parent?: string
  readonly label?: string
  readonly id?: string
}

export interface AssignIssueInput {
  readonly id: string
  readonly assignee: string
  readonly replace: boolean
}

export interface UnassignIssueInput {
  readonly id: string
  readonly ifAssignee?: string
}

export interface CloseIssueInput {
  readonly id: string
  readonly state?: string
}

export interface UpdateIssueDescriptionInput {
  readonly id: string
  readonly description: string
  readonly ifUpdatedAt: string
}

export interface ListLabelsInput {
  readonly limit: number
  readonly after?: string
  readonly workspace?: boolean
  readonly team?: string
  readonly name?: string
  readonly issue?: string
}

export interface CreateLabelInput {
  readonly name: string
  readonly color: string
  readonly workspace: boolean
  readonly team?: string
  readonly description?: string
  readonly id?: string
  readonly ifAbsent: boolean
}

export interface ApplyLabelInput {
  readonly issue: string
  readonly label: string
}

export type RelationType = "blocks" | "related" | "duplicate" | "similar"
export type RelationDirection = "outgoing" | "incoming"

export interface ListRelationsInput {
  readonly issue: string
  readonly type?: RelationType
  readonly direction: RelationDirection | "both"
  readonly after?: string
  readonly limit: number
}

export interface CreateRelationInput {
  readonly issue: string
  readonly relatedIssue: string
  readonly type: RelationType
  readonly id?: string
}

export interface ListCommentsInput {
  readonly issue: string
  readonly after?: string
  readonly limit: number
}

export interface CreateCommentInput {
  readonly issue: string
  readonly body: string
  readonly id?: string
}

export interface FrontierInput {
  readonly map: string
  readonly limit: number
}

export interface FrontierResult {
  readonly map: Pick<IssueSummary, "id" | "identifier" | "title">
  readonly total: number
  readonly items: ReadonlyArray<FrontierIssue>
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

export const makeLinearGateway = (
  env: NodeJS.ProcessEnv,
  options: { readonly client?: LinearClient } = {}
): LinearGateway => makeSdkLinearGateway(credentialsFromEnv(env), options)
