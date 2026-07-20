import { describe, expect, test } from "bun:test"
import type { Comment, Issue, IssueLabel, LinearClient, User } from "@linear/sdk"
import { Effect } from "effect"
import { makeLinearGateway } from "../src/linear"
import type { ConnectionLike } from "../src/linear-pagination"

const page = <Value>(nodes: ReadonlyArray<Value>): ConnectionLike<Value> => ({
  nodes,
  pageInfo: { hasNextPage: false, endCursor: null },
  fetchNext: async () => page(nodes)
})

const issue = (overrides: Record<string, unknown> = {}): Issue => ({
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "BEN-1",
  title: "Map",
  description: "initial",
  priority: 0,
  labelIds: [],
  assigneeId: undefined,
  parentId: undefined,
  teamId: "22222222-2222-4222-8222-222222222222",
  updatedAt: new Date("2026-07-13T12:00:00.000Z"),
  createdAt: new Date("2026-07-13T11:00:00.000Z"),
  url: "https://linear.app/acme/issue/BEN-1",
  subIssueSortOrder: null,
  state: Promise.resolve({ id: "state", name: "Todo", type: "unstarted" }),
  assignee: undefined,
  parent: undefined,
  team: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222", key: "BEN" }),
  labels: async () => page([]),
  ...overrides
} as unknown as Issue)

const clientWithIssues = (
  issues: ReadonlyArray<Issue>,
  extras: Record<string, unknown> = {}
): LinearClient => ({
  issues: async () => page(issues),
  ...extras
} as unknown as LinearClient)

const team = {
  id: "22222222-2222-4222-8222-222222222222",
  key: "BEN",
  name: "Bender"
}

const user = (overrides: Record<string, unknown> = {}): User => ({
  id: "33333333-3333-4333-8333-333333333333",
  name: "Henrik",
  active: true,
  isAssignable: true,
  ...overrides
} as unknown as User)

const comment = (overrides: Record<string, unknown> = {}): Comment => ({
  id: "44444444-4444-4444-8444-444444444444",
  issueId: issue().id,
  body: "initial",
  createdAt: new Date("2026-07-13T12:00:00.000Z"),
  updatedAt: new Date("2026-07-13T12:00:00.000Z"),
  user: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333", name: "Henrik" }),
  url: "https://linear.app/acme/issue/BEN-1#comment",
  ...overrides
} as unknown as Comment)

const issueLabel = (overrides: Record<string, unknown> = {}): IssueLabel => ({
  id: "55555555-5555-4555-8555-555555555555",
  name: "wayfinder:task",
  teamId: team.id,
  color: "#123456",
  description: "Task",
  isGroup: false,
  parentId: undefined,
  archivedAt: undefined,
  ...overrides
} as unknown as IssueLabel)

describe("SDK LinearGateway conflict contracts", () => {
  test("resolves human issue identifiers by exact team key and issue number", async () => {
    const filters: unknown[] = []
    const client = clientWithIssues([], {
      issues: async (variables: { filter?: unknown }) => {
        filters.push(variables.filter)
        return page(variables.filter && JSON.stringify(variables.filter).includes('"number":{"eq":1}') ? [issue()] : [])
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).viewIssue("BEN-1"))

    expect(result.identifier).toBe("BEN-1")
    expect(filters).toEqual([{ number: { eq: 1 }, team: { key: { eqIgnoreCase: "BEN" } } }])
  })

  test("human issue resolution preserves not-found and ambiguity errors", async () => {
    const ambiguousClient = clientWithIssues([
      issue(),
      issue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
    ])
    const ambiguous = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client: ambiguousClient }).viewIssue("BEN-1")
    ))
    const missing = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client: clientWithIssues([]) }).viewIssue("BEN-404")
    ))

    expect(ambiguous.message).toContain("Ambiguous Linear issue BEN-1")
    expect(missing.message).toContain("No Linear issue BEN-404 matched")
  })

  test("archived exact identities are classified and rejected before mutation", async () => {
    const archivedIssue = issue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      identifier: "BEN-2",
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const activeIssue = issue()
    const archivedComment = comment({ archivedAt: new Date("2026-07-13T13:00:00.000Z") })
    const archivedLabel = issueLabel({ archivedAt: new Date("2026-07-13T13:00:00.000Z") })
    let issueCreates = 0
    let commentCreates = 0
    let labelCreates = 0
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) => {
        const filter = JSON.stringify(variables.filter)
        return page(filter.includes('"number":{"eq":2}') || filter.includes(archivedIssue.id) ? [archivedIssue] : [activeIssue])
      },
      teams: async () => page([team]),
      comments: async () => page([archivedComment]),
      issueLabels: async () => page([archivedLabel]),
      createIssue: async () => { issueCreates += 1; return { success: true } },
      createComment: async () => { commentCreates += 1; return { success: true } },
      createIssueLabel: async () => { labelCreates += 1; return { success: true } }
    })
    const gateway = makeLinearGateway({}, { client })

    const errors = await Promise.all([
      Effect.runPromise(Effect.flip(gateway.viewIssue("BEN-2"))),
      Effect.runPromise(Effect.flip(gateway.createIssue({
        team: "BEN",
        title: archivedIssue.title,
        description: archivedIssue.description ?? "",
        id: archivedIssue.id
      }))),
      Effect.runPromise(Effect.flip(gateway.createComment({
        issue: "BEN-1",
        body: archivedComment.body,
        id: archivedComment.id
      }))),
      Effect.runPromise(Effect.flip(gateway.createLabel({
        name: archivedLabel.name,
        color: archivedLabel.color,
        description: archivedLabel.description ?? undefined,
        workspace: false,
        team: "BEN",
        id: archivedLabel.id,
        ifAbsent: false
      })))
    ])

    expect(errors.every((error) => error.message.toLowerCase().includes("archived"))).toBe(true)
    expect([issueCreates, commentCreates, labelCreates]).toEqual([0, 0, 0])
  })

  test.each([team.key, team.id])("archived team identity %s is classified before issue creation", async (identity) => {
    const archivedTeam = {
      ...team,
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    }
    const teamQueries: Array<{ includeArchived?: boolean }> = []
    let creates = 0
    const client = clientWithIssues([], {
      teams: async (variables: { includeArchived?: boolean }) => {
        teamQueries.push(variables)
        return page([archivedTeam])
      },
      createIssue: async () => {
        creates += 1
        return { success: false }
      }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).createIssue({ team: identity, title: "Map" })
    ))

    expect(error.message).toContain("archived")
    expect(teamQueries.map((query) => query.includeArchived)).toEqual([true])
    expect(creates).toBe(0)
  })

  test("project update association selectors resolve canonical team and initiative ids", async () => {
    const initiative = {
      id: "88888888-8888-4888-8888-888888888888",
      name: "Growth",
      archivedAt: undefined
    }
    const teamFilters: unknown[] = []
    const initiativeFilters: unknown[] = []
    const client = clientWithIssues([], {
      teams: async (variables: { filter?: unknown }) => {
        teamFilters.push(variables.filter)
        return page([team])
      },
      initiatives: async (variables: { filter?: unknown }) => {
        initiativeFilters.push(variables.filter)
        return page([initiative])
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).resolveProjectUpdateAssociations({
      teams: ["Bender"],
      initiatives: ["Growth"],
      includeArchived: false
    }))

    expect(result).toEqual({ teams: [team.id], initiatives: [initiative.id] })
    expect(teamFilters).toEqual([{ or: [{ key: { eqIgnoreCase: "Bender" } }, { name: { eqIgnoreCase: "Bender" } }] }])
    expect(initiativeFilters).toEqual([{ name: { eqIgnoreCase: "Growth" } }])
  })

  test("project association removal resolves archived exact identities without enabling active paths", async () => {
    const archivedTeam = {
      ...team,
      id: "99999999-9999-4999-8999-999999999999",
      key: "OLD",
      name: "Archived team",
      archivedAt: new Date("2026-07-01T00:00:00.000Z")
    }
    const archivedInitiative = {
      id: "88888888-8888-4888-8888-888888888888",
      name: "Legacy",
      archivedAt: new Date("2026-07-01T00:00:00.000Z")
    }
    const client = clientWithIssues([], {
      teams: async () => page([archivedTeam]),
      initiatives: async () => page([archivedInitiative])
    })
    const gateway = makeLinearGateway({}, { client })

    const removal = await Effect.runPromise(gateway.resolveProjectUpdateAssociations({
      teams: [archivedTeam.id],
      initiatives: [archivedInitiative.id],
      includeArchived: true
    }))
    const activeError = await Effect.runPromise(Effect.flip(gateway.resolveProjectUpdateAssociations({
      teams: [archivedTeam.id],
      initiatives: [],
      includeArchived: false
    })))

    expect(removal).toEqual({ teams: [archivedTeam.id], initiatives: [archivedInitiative.id] })
    expect(activeError.message).toContain("archived")
  })

  test("active exact matches win over archived duplicates", async () => {
    const active = issueLabel()
    const archived = issueLabel({
      id: "66666666-6666-4666-8666-666666666666",
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const client = clientWithIssues([issue({ labelIds: [active.id] })], {
      issueLabels: async () => page([archived, active])
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).applyLabel({
      issue: "BEN-1",
      label: active.name
    }))

    expect(result.changed).toBe(false)
  })

  test("multiple active exact labels remain ambiguous", async () => {
    const first = issueLabel()
    const second = issueLabel({ id: "66666666-6666-4666-8666-666666666666" })
    let applies = 0
    const client = clientWithIssues([issue()], {
      issueLabels: async () => page([first, second]),
      issueAddLabel: async () => { applies += 1; return { success: true } }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).applyLabel({ issue: "BEN-1", label: first.name })
    ))

    expect(error.message).toContain("Ambiguous Linear label")
    expect(applies).toBe(0)
  })

  test("parent-scoped issue labels avoid unrelated team ambiguity", async () => {
    const filters: unknown[] = []
    const parent = issue()
    const client = clientWithIssues([], {
      issues: async (variables: { filter?: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":1}') ? [parent] : []),
      issueLabels: async (variables: { filter: unknown }) => {
        filters.push(variables.filter)
        return page([issueLabel()])
      }
    })

    await Effect.runPromise(makeLinearGateway({}, { client }).listIssues({
      parent: "BEN-1",
      label: "wayfinder:task",
      limit: 20,
      fields: ["state"]
    }))

    expect(filters).toEqual([{
      name: { eqIgnoreCase: "wayfinder:task" },
      or: [{ team: { null: true } }, { team: { id: { eq: team.id } } }]
    }])
  })

  test("issue create rejects a parent-team conflict before label lookup or mutation", async () => {
    const otherTeam = { ...team, id: "99999999-9999-4999-8999-999999999999", key: "OTHER" }
    const parent = issue({ teamId: otherTeam.id, team: Promise.resolve(otherTeam) })
    let labelReads = 0
    let creates = 0
    const client = clientWithIssues([parent], {
      teams: async () => page([team]),
      issueLabels: async () => { labelReads += 1; return page([]) },
      createIssue: async () => { creates += 1; return { success: true } }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).createIssue({
        team: "BEN",
        title: "Child",
        parent: "BEN-1",
        label: "wayfinder:task"
      })
    ))

    expect(error.message).toContain("belongs to another team")
    expect(labelReads).toBe(0)
    expect(creates).toBe(0)
  })

  test("stale description rejects before mutation", async () => {
    let updates = 0
    const client = clientWithIssues([issue()], {
      updateIssue: async () => { updates += 1; return { success: true } }
    })
    const gateway = makeLinearGateway({}, { client })
    const exit = await Effect.runPromiseExit(gateway.updateIssueDescription({
      id: "BEN-1",
      description: "replacement",
      ifUpdatedAt: "2026-07-13T11:59:59.000Z"
    }))
    expect(exit._tag).toBe("Failure")
    expect(updates).toBe(0)
  })

  test("sub-millisecond timestamp differences reject before mutation", async () => {
    let updates = 0
    const client = clientWithIssues([issue()], {
      updateIssue: async () => { updates += 1; return { success: true } }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).updateIssueDescription({
        id: "BEN-1",
        description: "replacement",
        ifUpdatedAt: "2026-07-13T12:00:00.0001Z"
      })
    ))

    expect(error.message).toContain("changed since --if-updated-at")
    expect(updates).toBe(0)
  })

  test("stale description rejects before loading unrelated issue relations", async () => {
    let labelReads = 0
    const staleIssue = issue({
      labels: async () => {
        labelReads += 1
        throw new Error("unrelated label read failed")
      }
    })
    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client: clientWithIssues([staleIssue]) }).updateIssueDescription({
        id: "BEN-1",
        description: "replacement",
        ifUpdatedAt: "2026-07-13T11:59:59.000Z"
      })
    ))

    expect(error.message).toContain("changed since --if-updated-at")
    expect(labelReads).toBe(0)
  })

  test("matching description is an idempotent no-op", async () => {
    let updates = 0
    const client = clientWithIssues([issue()], {
      updateIssue: async () => { updates += 1; return { success: true } }
    })
    const result = await Effect.runPromise(makeLinearGateway({}, { client }).updateIssueDescription({
      id: "BEN-1",
      description: "initial",
      ifUpdatedAt: "2026-07-13T12:00:00.000Z"
    }))
    expect(result.changed).toBe(false)
    expect(updates).toBe(0)
  })

  test("due date and milestone clears use one mutation and verify both fields", async () => {
    const before = issue({ dueDate: "2026-08-01", projectMilestoneId: "milestone-id" })
    const after = issue({ dueDate: undefined, projectMilestoneId: undefined })
    let reads = 0
    let sent: Record<string, unknown> | undefined
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      updateIssue: async (_id: string, input: Record<string, unknown>) => {
        sent = input
        return { success: true, issue: Promise.resolve(after) }
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).clearIssueFields({
      id: "BEN-1",
      dueDate: true,
      milestone: true
    }))

    expect(sent).toEqual({ dueDate: null, projectMilestoneId: null })
    expect(result.changed).toBe(true)
  })

  test("indeterminate due date and milestone clears require full issue inspection", async () => {
    const before = issue({ dueDate: "2026-08-01", projectMilestoneId: "milestone-id" })
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([before], {
        updateIssue: async () => { throw new Error("connection reset") }
      })
    })

    const error = await Effect.runPromise(Effect.flip(gateway.clearIssueFields({
      id: "BEN-1",
      dueDate: true,
      milestone: true
    })))

    expect(error.message).toContain("outcome is unknown")
    expect(error.help).toContain("linear-axi issues inspect --id BEN-1 --full")
    expect(error.help).not.toContain("issues view")
  })

  test("new issue mutations reconcile desired state after indeterminate SDK failures", async () => {
    const targetState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "In Progress", type: "started", position: 1 }
    const beforeState = issue()
    const afterState = issue({ state: Promise.resolve(targetState) })
    let stateReads = 0
    const stateResult = await Effect.runPromise(makeLinearGateway({}, {
      client: clientWithIssues([], {
        issues: async () => page([stateReads++ === 0 ? beforeState : afterState]),
        workflowStates: async () => page([targetState]),
        updateIssue: async () => { throw new Error("connection reset") }
      })
    }).changeIssueState({ id: "BEN-1", state: targetState.id }))

    const parent = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const beforeParent = issue()
    const afterParent = issue({ parentId: parent.id, parent: Promise.resolve(parent) })
    let parentReads = 0
    const parentResult = await Effect.runPromise(makeLinearGateway({}, {
      client: clientWithIssues([], {
        issues: async (variables: { filter: unknown }) => {
          const filter = JSON.stringify(variables.filter)
          if (filter.includes('"number":{"eq":2}')) return page([parent])
          return page([parentReads++ === 0 ? beforeParent : afterParent])
        },
        updateIssue: async () => { throw new Error("connection reset") }
      })
    }).setIssueParent({ id: "BEN-1", parent: "BEN-2" }))

    const beforeClear = issue({ dueDate: "2026-08-01", projectMilestoneId: "milestone-id" })
    const afterClear = issue({ dueDate: undefined, projectMilestoneId: undefined })
    let clearReads = 0
    const clearResult = await Effect.runPromise(makeLinearGateway({}, {
      client: clientWithIssues([], {
        issues: async () => page([clearReads++ === 0 ? beforeClear : afterClear]),
        updateIssue: async () => { throw new Error("connection reset") }
      })
    }).clearIssueFields({ id: "BEN-1", dueDate: true, milestone: true }))

    const addedLabel = issueLabel({ name: "Bug" })
    const beforeAdd = issue()
    const afterAdd = issue({ labelIds: [addedLabel.id], labels: async () => page([addedLabel]) })
    let addReads = 0
    const addResult = await Effect.runPromise(makeLinearGateway({}, {
      client: clientWithIssues([], {
        issues: async () => page([addReads++ === 0 ? beforeAdd : afterAdd]),
        issueLabels: async () => page([addedLabel]),
        issueAddLabel: async () => { throw new Error("connection reset") }
      })
    }).applyLabel({ issue: "BEN-1", label: "Bug" }))

    const beforeRemove = issue({ labelIds: [addedLabel.id], labels: async () => page([addedLabel]) })
    const afterRemove = issue()
    let removeReads = 0
    const removeResult = await Effect.runPromise(makeLinearGateway({}, {
      client: clientWithIssues([], {
        issues: async () => page([removeReads++ === 0 ? beforeRemove : afterRemove]),
        issueRemoveLabel: async () => { throw new Error("connection reset") }
      })
    }).removeLabel({ issue: "BEN-1", label: "Bug" }))

    const replacement = issueLabel({ id: "66666666-6666-4666-8666-666666666666", name: "Urgent" })
    const beforeReplace = issue({ labelIds: [addedLabel.id] })
    const afterReplace = issue({ labelIds: [replacement.id], labels: async () => page([replacement]) })
    let replaceReads = 0
    const replaceResult = await Effect.runPromise(makeLinearGateway({}, {
      client: clientWithIssues([], {
        issues: async () => page([replaceReads++ === 0 ? beforeReplace : afterReplace]),
        issueLabels: async () => page([replacement]),
        updateIssue: async () => { throw new Error("connection reset") }
      })
    }).replaceLabels({ issue: "BEN-1", labels: ["Urgent"] }))

    expect([stateResult, parentResult, clearResult, addResult, removeResult, replaceResult]
      .map((result) => [result.changed, result.result])).toEqual([
        [false, "requested workflow state update verified after an indeterminate response"],
        [false, "requested parent update verified after an indeterminate response"],
        [false, "requested field clear verified after an indeterminate response"],
        [false, "requested label add verified after an indeterminate response"],
        [false, "requested label removal verified after an indeterminate response"],
        [false, "requested label replacement verified after an indeterminate response"]
      ])
  })

  test("indeterminate label replacement fails closed without replay guidance", async () => {
    const current = issueLabel({ name: "Current" })
    const desired = issueLabel({ id: "66666666-6666-4666-8666-666666666666", name: "Desired" })
    const unchangedIssue = issue({ labelIds: [current.id], labels: async () => page([current]) })
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([unchangedIssue], {
        issueLabels: async () => page([desired]),
        updateIssue: async () => { throw new Error("connection reset") }
      })
    })

    const error = await Effect.runPromise(Effect.flip(gateway.replaceLabels({ issue: "BEN-1", labels: ["Desired"] })))

    expect(error.message).toContain("outcome is unknown")
    expect(error.help).toContain("linear-axi issues view --id BEN-1 --full")
    expect(error.help).not.toContain("Retry")
  })

  test("definitive rejection and successful mismatches keep distinct mutation guidance", async () => {
    const current = issueLabel({ name: "Current" })
    const desired = issueLabel({ id: "66666666-6666-4666-8666-666666666666", name: "Desired" })
    const unchangedIssue = issue({ labelIds: [current.id], labels: async () => page([current]) })
    const run = (updateIssue: () => Promise<Record<string, unknown>>) => makeLinearGateway({}, {
      client: clientWithIssues([unchangedIssue], {
        issueLabels: async () => page([desired]),
        updateIssue
      })
    }).replaceLabels({ issue: "BEN-1", labels: ["Desired"] })

    const rejected = await Effect.runPromise(Effect.flip(run(async () => ({ success: false }))))
    const uncertain = await Effect.runPromise(Effect.flip(run(async () => ({
      success: true,
      issue: Promise.resolve(unchangedIssue)
    }))))

    expect(rejected.message).toContain("Linear did not accept the label replacement")
    expect(rejected.message).not.toContain("outcome is unknown")
    expect(uncertain.message).toContain("could not be verified after dispatch")
    expect(uncertain.help).toContain("linear-axi issues view --id BEN-1 --full")
    expect(uncertain.help).not.toContain("Retry")
  })

  test("missing successful mutation payload reconciles instead of suggesting replay", async () => {
    const current = issueLabel({ name: "Current" })
    const desired = issueLabel({ id: "66666666-6666-4666-8666-666666666666", name: "Desired" })
    const before = issue({ labelIds: [current.id], labels: async () => page([current]) })
    const after = issue({ labelIds: [desired.id], labels: async () => page([desired]) })
    let reads = 0
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([], {
        issues: async () => page([reads++ === 0 ? before : after]),
        issueLabels: async () => page([desired]),
        updateIssue: async () => ({ success: true, issue: undefined })
      })
    })

    const result = await Effect.runPromise(gateway.replaceLabels({ issue: "BEN-1", labels: ["Desired"] }))

    expect(result).toMatchObject({
      changed: false,
      result: "requested label replacement verified after an indeterminate response"
    })
  })

  test("missing successful mutation payload fails closed when state cannot be reconciled", async () => {
    const current = issueLabel({ name: "Current" })
    const desired = issueLabel({ id: "66666666-6666-4666-8666-666666666666", name: "Desired" })
    const unchangedIssue = issue({ labelIds: [current.id], labels: async () => page([current]) })
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([unchangedIssue], {
        issueLabels: async () => page([desired]),
        updateIssue: async () => ({ success: true, issue: undefined })
      })
    })

    const error = await Effect.runPromise(Effect.flip(gateway.replaceLabels({ issue: "BEN-1", labels: ["Desired"] })))

    expect(error.message).toContain("outcome is unknown")
    expect(error.help).toContain("linear-axi issues view --id BEN-1 --full")
    expect(error.help).not.toContain("Retry")
  })

  test("successful description update refetches and verifies content and timestamp", async () => {
    const before = issue()
    const after = issue({ description: "replacement", updatedAt: new Date("2026-07-13T12:01:00.000Z") })
    let reads = 0
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      updateIssue: async () => ({ success: true, issue: Promise.resolve(after) })
    })
    const result = await Effect.runPromise(makeLinearGateway({}, { client }).updateIssueDescription({
      id: "BEN-1",
      description: "replacement",
      ifUpdatedAt: "2026-07-13T12:00:00.000Z"
    }))
    expect(result.changed).toBe(true)
    expect(result.value.description).toBe("replacement")
    expect(reads).toBe(2)
  })

  test("description update canonicalizes CRLF and terminal newlines before mutation", async () => {
    const before = issue()
    const after = issue({ description: "line one\nline two", updatedAt: new Date("2026-07-13T12:01:00.000Z") })
    let reads = 0
    let sent: string | null | undefined
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      updateIssue: async (_id: string, input: { description?: string | null }) => {
        sent = input.description
        return { success: true, issue: Promise.resolve(after) }
      }
    })
    const result = await Effect.runPromise(makeLinearGateway({}, { client }).updateIssueDescription({
      id: "BEN-1",
      description: "line one\r\nline two\r\n",
      ifUpdatedAt: "2026-07-13T12:00:00.000Z"
    }))
    expect(sent).toBe("line one\nline two")
    expect(result.value.description).toBe("line one\nline two")
  })

  test("caller-UUID issue retry accepts server-canonical Markdown and newlines", async () => {
    const existing = issue({ description: "[decision](<https://example.com>)" })
    let creates = 0
    const client = clientWithIssues([existing], {
      teams: async () => page([team]),
      createIssue: async () => { creates += 1; return { success: true, issue: Promise.resolve(existing) } }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).createIssue({
      team: "BEN",
      title: "Map",
      description: "[decision](https://example.com)\r\n",
      id: existing.id
    }))

    expect(result.changed).toBe(false)
    expect(creates).toBe(0)
  })

  test("caller-UUID issue retry rejects materially different Markdown", async () => {
    const existing = issue({ description: "[decision](<https://example.com>)" })
    const client = clientWithIssues([existing], { teams: async () => page([team]) })
    const exit = await Effect.runPromiseExit(makeLinearGateway({}, { client }).createIssue({
      team: "BEN",
      title: "Map",
      description: "[other](https://example.com)\n",
      id: existing.id
    }))

    expect(exit._tag).toBe("Failure")
  })

  test("description verification follows Linear's server-canonical Markdown", async () => {
    const before = issue()
    const after = issue({ description: "[decision](<https://example.com>)", updatedAt: new Date("2026-07-13T12:01:00.000Z") })
    let reads = 0
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      updateIssue: async () => ({ success: true, issue: Promise.resolve(after) })
    })
    const result = await Effect.runPromise(makeLinearGateway({}, { client }).updateIssueDescription({
      id: "BEN-1",
      description: "[decision](https://example.com)\n",
      ifUpdatedAt: "2026-07-13T12:00:00.000Z"
    }))
    expect(result.changed).toBe(true)
    expect(result.value.description).toBe("[decision](<https://example.com>)")
  })

  test("server-normalized equivalent description is a no-op", async () => {
    const current = issue({ description: "[decision](<https://example.com>)" })
    let updates = 0
    const client = clientWithIssues([current], {
      updateIssue: async () => {
        updates += 1
        return { success: true, issue: Promise.resolve(current) }
      }
    })
    const result = await Effect.runPromise(makeLinearGateway({}, { client }).updateIssueDescription({
      id: "BEN-1",
      description: "[decision](https://example.com)\n",
      ifUpdatedAt: "2026-07-13T12:00:00.000Z"
    }))
    expect(result.changed).toBe(false)
    expect(result.result).toContain("Linear normalization")
    expect(updates).toBe(0)
  })

  test("description verification rejects a material server transformation", async () => {
    const before = issue()
    const transformed = issue({ description: "server rewrite", updatedAt: new Date("2026-07-13T12:01:00.000Z") })
    let reads = 0
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : transformed]),
      updateIssue: async () => ({ success: true, issue: Promise.resolve(transformed) })
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).updateIssueDescription({
        id: "BEN-1",
        description: "requested replacement",
        ifUpdatedAt: "2026-07-13T12:00:00.000Z"
      })
    ))

    expect(error.message).toContain("could not be verified")
  })

  test("caller-UUID comment retry accepts server-canonical Markdown and newlines", async () => {
    const existing = comment({ body: "[decision](<https://example.com>)" })
    let creates = 0
    const client = clientWithIssues([issue()], {
      comments: async () => page([existing]),
      createComment: async () => { creates += 1; return { success: true, comment: Promise.resolve(existing) } }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).createComment({
      issue: "BEN-1",
      body: "[decision](https://example.com)\r\n",
      id: existing.id
    }))

    expect(result.changed).toBe(false)
    expect(creates).toBe(0)
  })

  test("caller-UUID comment retry rejects materially different Markdown", async () => {
    const existing = comment({ body: "[decision](<https://example.com>)" })
    const client = clientWithIssues([issue()], { comments: async () => page([existing]) })

    const exit = await Effect.runPromiseExit(makeLinearGateway({}, { client }).createComment({
      issue: "BEN-1",
      body: "[other](https://example.com)\n",
      id: existing.id
    }))

    expect(exit._tag).toBe("Failure")
  })

  test("comment authors prefer users, then bots, then external users", async () => {
    const comments = [
      comment({
        id: "44444444-4444-4444-8444-444444444441",
        user: Promise.resolve({ name: "Workspace User" }),
        botActor: { name: "Ignored Bot" },
        externalUser: Promise.resolve({ name: "Ignored External User" })
      }),
      comment({
        id: "44444444-4444-4444-8444-444444444442",
        user: undefined,
        botActor: { name: "Automation" },
        externalUser: Promise.resolve({ name: "Ignored External User" })
      }),
      comment({
        id: "44444444-4444-4444-8444-444444444443",
        user: undefined,
        botActor: { name: undefined, type: "workflow", userDisplayName: "Ignored Human Name" },
        externalUser: Promise.resolve({ name: "Ignored External User" })
      }),
      comment({
        id: "44444444-4444-4444-8444-444444444444",
        user: undefined,
        botActor: undefined,
        externalUser: Promise.resolve({ name: "Slack Guest" })
      }),
      comment({
        id: "44444444-4444-4444-8444-444444444445",
        user: undefined,
        botActor: undefined,
        externalUser: undefined
      })
    ]
    const source = issue({ comments: async () => page(comments) })

    const result = await Effect.runPromise(makeLinearGateway({}, {
      client: clientWithIssues([source])
    }).listComments({ issue: "BEN-1", limit: 20 }))

    expect(result.items.map((item) => item.author)).toEqual([
      "Workspace User",
      "Automation",
      "workflow",
      "Slack Guest",
      "unknown"
    ])
  })

  test("post-write mismatch is a conflict", async () => {
    const before = issue()
    const accepted = issue({ description: "replacement", updatedAt: new Date("2026-07-13T12:01:00.000Z") })
    const after = issue({ description: "other", updatedAt: new Date("2026-07-13T12:02:00.000Z") })
    let reads = 0
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      updateIssue: async () => ({ success: true, issue: Promise.resolve(accepted) })
    })
    const exit = await Effect.runPromiseExit(makeLinearGateway({}, { client }).updateIssueDescription({
      id: "BEN-1",
      description: "replacement",
      ifUpdatedAt: "2026-07-13T12:00:00.000Z"
    }))
    expect(exit._tag).toBe("Failure")
  })

  test("success false and GraphQL partial errors become typed API failures", async () => {
    const payloadClient = clientWithIssues([issue()], {
      updateIssue: async () => ({ success: false, issue: undefined })
    })
    const payloadExit = await Effect.runPromiseExit(makeLinearGateway({}, { client: payloadClient }).updateIssueDescription({
      id: "BEN-1",
      description: "replacement",
      ifUpdatedAt: "2026-07-13T12:00:00.000Z"
    }))
    expect(payloadExit._tag).toBe("Failure")

    const partialClient = clientWithIssues([], {
      issues: async () => { throw new Error("GraphQL errors: forbidden partial response") }
    })
    const error = await Effect.runPromise(Effect.flip(makeLinearGateway({}, { client: partialClient }).viewIssue("BEN-1")))
    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toBe("GraphQL errors: forbidden partial response")
    expect(error.message).not.toContain(" at ")
  })

  test("already terminal close and same-assignee assignment are satisfied no-ops", async () => {
    let updates = 0
    const viewer = user()
    const terminal = issue({
      state: Promise.resolve({ id: "done", name: "Done", type: "completed" }),
      assigneeId: viewer.id,
      assignee: Promise.resolve(viewer)
    })
    const client = clientWithIssues([terminal], {
      viewer: Promise.resolve(viewer),
      updateIssue: async () => { updates += 1; return { success: true } }
    })
    const gateway = makeLinearGateway({}, { client })
    expect((await Effect.runPromise(gateway.closeIssue({ id: "BEN-1" }))).changed).toBe(false)
    expect((await Effect.runPromise(gateway.assignIssue({ id: "BEN-1", assignee: "me", replace: false }))).changed).toBe(false)
    expect(updates).toBe(0)
  })

  test("assignment resolves exact user email, name, and display name selectors", async () => {
    const selected = user({
      name: "Alice Example",
      displayName: "alice",
      email: "alice@example.com"
    })
    const client = clientWithIssues([issue({
      assigneeId: selected.id,
      assignee: Promise.resolve(selected)
    })], {
      users: async () => page([selected])
    })
    const gateway = makeLinearGateway({}, { client })

    for (const selector of [selected.id, "Alice Example", "alice", "ALICE@EXAMPLE.COM"]) {
      const result = await Effect.runPromise(gateway.assignIssue({ id: "BEN-1", assignee: selector, replace: false }))
      expect(result).toMatchObject({ changed: false })
    }
  })

  test("non-ID user resolution applies exact case-insensitive server filters", async () => {
    const selected = user({
      name: "Alice Example",
      displayName: "alice",
      email: "alice@example.com"
    })
    const filters: Array<unknown> = []
    const client = clientWithIssues([issue({
      assigneeId: selected.id,
      assignee: Promise.resolve(selected)
    })], {
      users: async (variables: { filter?: unknown }) => {
        filters.push(variables.filter)
        return page([selected])
      }
    })

    const result = await Effect.runPromise(
      makeLinearGateway({}, { client }).assignIssue({ id: "BEN-1", assignee: "ALICE", replace: false })
    )

    expect(result.changed).toBe(false)
    expect(filters).toEqual([{
      or: [
        { name: { eqIgnoreCase: "ALICE" } },
        { displayName: { eqIgnoreCase: "ALICE" } },
        { email: { eqIgnoreCase: "ALICE" } }
      ]
    }])
  })

  test("ambiguous user names return candidate ids without mutating", async () => {
    const first = user({ name: "Alex", email: "first@example.com" })
    const second = user({
      id: "77777777-7777-4777-8777-777777777777",
      name: "Alex",
      email: "second@example.com"
    })
    let updates = 0
    const client = clientWithIssues([issue()], {
      users: async () => page([first, second]),
      updateIssue: async () => { updates += 1; return { success: true } }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).assignIssue({ id: "BEN-1", assignee: "Alex", replace: false })
    ))

    expect(error.message).toContain(first.id)
    expect(error.message).toContain(second.id)
    expect(updates).toBe(0)
  })

  test("disabled users remain resolvable for issue filters and unassign preconditions", async () => {
    const disabled = user({ active: false, isAssignable: false })
    const before = issue({ assigneeId: disabled.id, assignee: Promise.resolve(disabled) })
    const after = issue({ assigneeId: undefined, assignee: undefined })
    const userQueries: Array<{ includeArchived?: boolean; includeDisabled?: boolean }> = []
    let issueReads = 0
    const client = clientWithIssues([], {
      users: async (variables: { includeArchived?: boolean; includeDisabled?: boolean }) => {
        userQueries.push(variables)
        return page([disabled])
      },
      issues: async () => page([issueReads++ < 2 ? before : after]),
      updateIssue: async () => ({ success: true, issue: Promise.resolve(after) })
    })
    const gateway = makeLinearGateway({}, { client })

    const listed = await Effect.runPromise(gateway.listIssues({
      assignee: disabled.id,
      limit: 20,
      fields: ["assignee"]
    }))
    const released = await Effect.runPromise(gateway.unassignIssue({
      id: "BEN-1",
      ifAssignee: disabled.id
    }))

    expect(listed.items[0]?.assigneeId).toBe(disabled.id)
    expect(released.changed).toBe(true)
    expect(userQueries.map(({ includeArchived, includeDisabled }) => ({ includeArchived, includeDisabled }))).toEqual([
      { includeArchived: true, includeDisabled: true },
      { includeArchived: true, includeDisabled: true }
    ])
  })

  test("archived users remain resolvable for issue filters and unassign preconditions", async () => {
    const archived = user({
      active: false,
      isAssignable: false,
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const before = issue({ assigneeId: archived.id, assignee: Promise.resolve(archived) })
    const after = issue({ assigneeId: undefined, assignee: undefined })
    let issueReads = 0
    const client = clientWithIssues([], {
      users: async (variables: { includeArchived?: boolean; includeDisabled?: boolean }) => {
        expect(variables.includeArchived).toBe(true)
        expect(variables.includeDisabled).toBe(true)
        return page([archived])
      },
      issues: async () => page([issueReads++ < 2 ? before : after]),
      updateIssue: async () => ({ success: true, issue: Promise.resolve(after) })
    })
    const gateway = makeLinearGateway({}, { client })

    const listed = await Effect.runPromise(gateway.listIssues({
      assignee: archived.id,
      limit: 20,
      fields: ["assignee"]
    }))
    const released = await Effect.runPromise(gateway.unassignIssue({
      id: "BEN-1",
      ifAssignee: archived.id
    }))

    expect(listed.items[0]?.assigneeId).toBe(archived.id)
    expect(released.changed).toBe(true)
  })

  test("assignment requires an active unarchived assignable user", async () => {
    let updates = 0
    for (const unavailable of [
      user({ active: false, isAssignable: true }),
      user({ id: "44444444-4444-4444-8444-444444444444", active: true, isAssignable: false }),
      user({
        id: "55555555-5555-4555-8555-555555555555",
        active: true,
        isAssignable: true,
        archivedAt: new Date("2026-07-13T13:00:00.000Z")
      })
    ]) {
      const client = clientWithIssues([issue()], {
        users: async (variables: { includeArchived?: boolean; includeDisabled?: boolean }) => {
          expect(variables.includeArchived).toBe(true)
          expect(variables.includeDisabled).toBe(true)
          return page([unavailable])
        },
        updateIssue: async () => { updates += 1; return { success: true } }
      })
      const error = await Effect.runPromise(Effect.flip(
        makeLinearGateway({}, { client }).assignIssue({ id: "BEN-1", assignee: unavailable.id, replace: false })
      ))
      expect(error.message).toContain("cannot be assigned issues")
    }
    expect(updates).toBe(0)
  })

  test("close without state selects the only active completed state", async () => {
    const selectedState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Done", type: "completed", position: 1 }
    const archivedState = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Retired Done",
      type: "completed",
      position: 2,
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    }
    const before = issue()
    const after = issue({ state: Promise.resolve(selectedState) })
    const stateQueries: Array<{ includeArchived?: boolean }> = []
    let reads = 0
    let selected: string | undefined
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      workflowStates: async (variables: { includeArchived?: boolean }) => {
        stateQueries.push(variables)
        return page(variables.includeArchived ? [selectedState, archivedState] : [selectedState])
      },
      updateIssue: async (_id: string, input: { stateId?: string }) => {
        selected = input.stateId
        return { success: true, issue: Promise.resolve(after) }
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).closeIssue({ id: "BEN-1" }))

    expect(result.changed).toBe(true)
    expect(selected).toBe(selectedState.id)
    expect(stateQueries.map((query) => query.includeArchived)).toEqual([false])
  })

  test("explicit close classifies an archived workflow state before mutation", async () => {
    const archivedState = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Retired Done",
      type: "completed",
      position: 1,
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    }
    const stateQueries: Array<{ includeArchived?: boolean }> = []
    let updates = 0
    const client = clientWithIssues([issue()], {
      workflowStates: async (variables: { includeArchived?: boolean }) => {
        stateQueries.push(variables)
        return page([archivedState])
      },
      updateIssue: async () => {
        updates += 1
        return { success: false }
      }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).closeIssue({ id: "BEN-1", state: archivedState.id })
    ))

    expect(error.message).toContain("archived")
    expect(stateQueries.map((query) => query.includeArchived)).toEqual([true])
    expect(updates).toBe(0)
  })

  test("close without state rejects multiple completed states", async () => {
    const firstState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Done A", type: "completed", position: 1 }
    const secondState = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Done B", type: "completed", position: 2 }
    let updates = 0
    const client = clientWithIssues([issue()], {
      workflowStates: async () => page([firstState, secondState]),
      updateIssue: async () => { updates += 1; return { success: true } }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).closeIssue({ id: "BEN-1" })
    ))

    expect(error.message).toContain("Ambiguous completed workflow state")
    expect(error.message).toContain(`${firstState.id} (${firstState.name})`)
    expect(error.message).toContain(`${secondState.id} (${secondState.name})`)
    expect(error.help).toContain("--state")
    expect(updates).toBe(0)
  })

  test("close with an explicit state remains unambiguous", async () => {
    const selectedState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Done A", type: "completed", position: 1 }
    const otherState = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Done B", type: "completed", position: 2 }
    const before = issue()
    const after = issue({ state: Promise.resolve(selectedState) })
    let reads = 0
    let selected: string | undefined
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      workflowStates: async () => page([selectedState, otherState]),
      updateIssue: async (_id: string, input: { stateId?: string }) => {
        selected = input.stateId
        return { success: true, issue: Promise.resolve(after) }
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).closeIssue({
      id: "BEN-1",
      state: selectedState.id
    }))

    expect(result.changed).toBe(true)
    expect(selected).toBe(selectedState.id)
  })

  test("explicit close transitions canceled and differently completed issues", async () => {
    const selectedState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Released", type: "completed", position: 1 }

    for (const currentState of [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Canceled", type: "canceled" },
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Done", type: "completed" }
    ]) {
      const before = issue({ state: Promise.resolve(currentState) })
      const after = issue({ state: Promise.resolve(selectedState) })
      let reads = 0
      let updates = 0
      const client = clientWithIssues([], {
        issues: async () => page([reads++ === 0 ? before : after]),
        workflowStates: async () => page([selectedState]),
        updateIssue: async (_id: string, input: { stateId?: string }) => {
          updates += 1
          expect(input.stateId).toBe(selectedState.id)
          return { success: true, issue: Promise.resolve(after) }
        }
      })

      const result = await Effect.runPromise(makeLinearGateway({}, { client }).closeIssue({
        id: "BEN-1",
        state: selectedState.id
      }))

      expect(result.changed).toBe(true)
      expect(updates).toBe(1)
    }
  })

  test("explicit close validates the requested state before terminal no-op", async () => {
    const currentState = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Canceled", type: "canceled" }
    const activeState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "In Progress", type: "started" }
    let updates = 0
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([issue({ state: Promise.resolve(currentState) })], {
        workflowStates: async (variables: { filter: { id: { eq: string } } }) =>
          page(variables.filter.id.eq === activeState.id ? [activeState] : []),
        updateIssue: async () => { updates += 1; return { success: true } }
      })
    })

    const missing = await Effect.runPromise(Effect.flip(gateway.closeIssue({
      id: "BEN-1",
      state: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    })))
    const nonCompleted = await Effect.runPromise(Effect.flip(gateway.closeIssue({
      id: "BEN-1",
      state: activeState.id
    })))

    expect(missing.message).toContain("No Linear workflow state")
    expect(nonCompleted.message).toContain("is not completed")
    expect(updates).toBe(0)
  })

  test("explicit close is a no-op only at the exact target state", async () => {
    const selectedState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Released", type: "completed", position: 1 }
    let updates = 0
    const client = clientWithIssues([issue({ state: Promise.resolve(selectedState) })], {
      workflowStates: async () => page([selectedState]),
      updateIssue: async () => { updates += 1; return { success: true } }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).closeIssue({
      id: "BEN-1",
      state: selectedState.id
    }))

    expect(result.changed).toBe(false)
    expect(updates).toBe(0)
  })

  test.each([
    { name: "scoped name", id: undefined, requestedName: "wayfinder:task", ifAbsent: true },
    { name: "caller UUID", id: "55555555-5555-4555-8555-555555555555", requestedName: "wayfinder:task", ifAbsent: false },
    { name: "caller UUID before a name mismatch", id: "55555555-5555-4555-8555-555555555555", requestedName: "wayfinder:other", ifAbsent: true },
    { name: "scoped name before a UUID mismatch", id: "66666666-6666-4666-8666-666666666666", requestedName: "wayfinder:task", ifAbsent: true }
  ])("label create rejects a group found by $name", async ({ id, requestedName, ifAbsent }) => {
    const existing = issueLabel({ isGroup: true })
    let creates = 0
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async (variables: { filter: { id?: { eq: string } } }) =>
        page(variables.filter.id && variables.filter.id.eq !== existing.id ? [] : [existing]),
      createIssueLabel: async () => { creates += 1; return { success: true } }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).createLabel({
        name: requestedName,
        color: existing.color,
        description: existing.description ?? undefined,
        workspace: false,
        team: "BEN",
        id,
        ifAbsent
      })
    ))

    expect(error.message).toContain("label group")
    expect(creates).toBe(0)
  })

  test.each([
    { operation: "issue create", identity: "name" },
    { operation: "issue create", identity: "UUID" },
    { operation: "label apply", identity: "name" },
    { operation: "label apply", identity: "UUID" }
  ])("$operation rejects a label group resolved by exact $identity", async ({ operation, identity }) => {
    const group = issueLabel({ isGroup: true })
    let issueCreates = 0
    let labelApplies = 0
    const client = clientWithIssues([issue()], {
      teams: async () => page([team]),
      issueLabels: async () => page([group]),
      createIssue: async () => { issueCreates += 1; return { success: true } },
      issueAddLabel: async () => { labelApplies += 1; return { success: true } }
    })
    const gateway = makeLinearGateway({}, { client })
    const label = identity === "UUID" ? group.id : group.name
    const mutation = operation === "issue create"
      ? gateway.createIssue({ team: team.key, title: "Child", label })
      : gateway.applyLabel({ issue: "BEN-1", label })

    const error = await Effect.runPromise(Effect.flip(mutation))

    expect(error.message).toContain("label group")
    expect(issueCreates).toBe(0)
    expect(labelApplies).toBe(0)
  })

  test("label create with caller UUID and if-absent creates when both identities are absent", async () => {
    const id = "55555555-5555-4555-8555-555555555555"
    const created = issueLabel({ id })
    let sent: Record<string, unknown> | undefined
    const filters: unknown[] = []
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async (variables: { filter: unknown }) => {
        filters.push(variables.filter)
        return page(filters.length === 3 ? [created] : [])
      },
      createIssueLabel: async (input: Record<string, unknown>) => {
        sent = input
        return { success: true, issueLabel: Promise.resolve(created) }
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).createLabel({
      name: created.name,
      color: created.color,
      description: created.description ?? undefined,
      workspace: false,
      team: "BEN",
      id,
      ifAbsent: true
    }))

    expect(result.changed).toBe(true)
    expect(sent).toMatchObject({ id, name: created.name })
    expect(filters).toEqual([
      { id: { eq: id } },
      { name: { eqIgnoreCase: created.name }, team: { id: { eq: team.id } } },
      { id: { eq: id } }
    ])
  })

  test.each([
    { property: "scope", drift: { teamId: "99999999-9999-4999-8999-999999999999" } },
    { property: "group status", drift: { isGroup: true } },
    { property: "parent", drift: { parentId: "66666666-6666-4666-8666-666666666666" } }
  ])("label creation refetches and verifies $property", async ({ drift }) => {
    const created = issueLabel()
    const drifted = issueLabel(drift)
    let reads = 0
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async () => page(reads++ === 0 ? [] : [drifted]),
      createIssueLabel: async () => ({ success: true, issueLabel: Promise.resolve(created) })
    })

    const error = await Effect.runPromise(Effect.flip(makeLinearGateway({}, { client }).createLabel({
      name: created.name,
      color: created.color,
      description: created.description ?? undefined,
      workspace: false,
      team: "BEN",
      id: created.id,
      ifAbsent: false
    })))

    expect(reads).toBe(2)
    expect(error.message).toContain("mutation outcome is unknown")
    expect(error.help).toContain(`linear-axi labels list --team 'BEN' --name '${created.name}'`)
    expect(error.help).toContain("--fields id,name,scope,color,description,isGroup,parentId,archivedAt")
    expect(error.help).not.toContain("retry")
  })

  test("label creation readback failures require scoped inspection without replay", async () => {
    const created = issueLabel()
    let reads = 0
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async () => {
        reads += 1
        if (reads === 1) return page([])
        throw new Error("temporary read failure")
      },
      createIssueLabel: async () => ({ success: true, issueLabel: Promise.resolve(created) })
    })

    const error = await Effect.runPromise(Effect.flip(makeLinearGateway({}, { client }).createLabel({
      name: created.name,
      color: created.color,
      description: created.description ?? undefined,
      workspace: false,
      team: "BEN",
      ifAbsent: false
    })))

    expect(error.message).toContain("mutation outcome is unknown")
    expect(error.help).toContain(`linear-axi labels list --team 'BEN' --name '${created.name}'`)
    expect(error.help).not.toContain("retry")
  })

  test("label creation resolves a same-scope group and sends group metadata", async () => {
    const parent = issueLabel({ id: "66666666-6666-4666-8666-666666666666", name: "Engineering", isGroup: true })
    const child = issueLabel({ name: "Backend", parentId: parent.id })
    let sent: Record<string, unknown> | undefined
    let created = false
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async (variables: { filter: unknown }) => {
        const text = JSON.stringify(variables.filter)
        if (text.includes("Engineering")) return page([parent])
        if (created && text.includes(child.id)) return page([child])
        return page([])
      },
      createIssueLabel: async (input: Record<string, unknown>) => {
        sent = input
        created = true
        return { success: true, issueLabel: Promise.resolve(child) }
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).createLabel({
      name: "Backend",
      color: child.color,
      description: child.description ?? undefined,
      workspace: false,
      team: "BEN",
      id: child.id,
      ifAbsent: false,
      parent: "Engineering"
    }))

    expect(result.changed).toBe(true)
    expect(result.value.parentId).toBe(parent.id)
    expect(sent).toMatchObject({ id: child.id, name: "Backend", parentId: parent.id })
  })

  test("label create with caller UUID and if-absent is a no-op when both identities match", async () => {
    const existing = issueLabel()
    let creates = 0
    const filters: unknown[] = []
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async (variables: { filter: unknown }) => {
        filters.push(variables.filter)
        return page([existing])
      },
      createIssueLabel: async () => { creates += 1; return { success: true } }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).createLabel({
      name: existing.name,
      color: existing.color,
      description: existing.description ?? undefined,
      workspace: false,
      team: "BEN",
      id: existing.id,
      ifAbsent: true
    }))

    expect(result.changed).toBe(false)
    expect(creates).toBe(0)
    expect(filters).toHaveLength(2)
  })

  test("label create rechecks both identities after a concurrent create", async () => {
    const existing = issueLabel()
    let labelReads = 0
    let creates = 0
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async () => page(labelReads++ < 2 ? [] : [existing]),
      createIssueLabel: async () => {
        creates += 1
        throw new Error("name already exists")
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).createLabel({
      name: existing.name,
      color: existing.color,
      description: existing.description ?? undefined,
      workspace: false,
      team: "BEN",
      id: existing.id,
      ifAbsent: true
    }))

    expect(result.changed).toBe(false)
    expect(labelReads).toBe(4)
    expect(creates).toBe(1)
  })

  test.each([
    {
      name: "name belongs to another UUID",
      byName: issueLabel({ id: "66666666-6666-4666-8666-666666666666" }),
      byId: undefined
    },
    {
      name: "UUID belongs to another name",
      byName: undefined,
      byId: issueLabel({ name: "wayfinder:other" })
    },
    {
      name: "name and UUID resolve to different labels",
      byName: issueLabel({ id: "66666666-6666-4666-8666-666666666666" }),
      byId: issueLabel({ name: "wayfinder:other" })
    }
  ])("label create conflicts when $name", async ({ byName, byId }) => {
    let creates = 0
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async (variables: { filter: { id?: { eq: string } } }) =>
        page(variables.filter.id ? (byId ? [byId] : []) : (byName ? [byName] : [])),
      createIssueLabel: async () => { creates += 1; return { success: true } }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).createLabel({
        name: "wayfinder:task",
        color: "#123456",
        description: "Task",
        workspace: false,
        team: "BEN",
        id: "55555555-5555-4555-8555-555555555555",
        ifAbsent: true
      })
    ))

    expect(error.message).toMatch(/conflict/)
    expect(creates).toBe(0)
  })

  test.each([
    { workspace: false, team: "BEN", existingTeamId: undefined, scope: "workspace" },
    {
      workspace: false,
      team: "BEN",
      existingTeamId: "99999999-9999-4999-8999-999999999999",
      scope: "team 99999999-9999-4999-8999-999999999999"
    },
    {
      workspace: true,
      team: undefined,
      existingTeamId: "99999999-9999-4999-8999-999999999999",
      scope: "team 99999999-9999-4999-8999-999999999999"
    }
  ])("caller label UUIDs are probed globally before $scope scope conflicts", async ({ workspace, team: requestedTeam, existingTeamId }) => {
    const existing = issueLabel({ teamId: existingTeamId })
    let labelReads = 0
    let creates = 0
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async (variables: { filter: unknown }) => {
        labelReads += 1
        expect(variables.filter).toEqual({ id: { eq: existing.id } })
        return page([existing])
      },
      createIssueLabel: async () => { creates += 1; return { success: true } }
    })

    for (const ifAbsent of [false, true]) {
      const error = await Effect.runPromise(Effect.flip(
        makeLinearGateway({}, { client }).createLabel({
          name: existing.name,
          color: existing.color,
          description: existing.description ?? undefined,
          workspace,
          team: requestedTeam,
          id: existing.id,
          ifAbsent
        })
      ))
      expect(error.message).toContain("belongs to")
    }

    expect(labelReads).toBe(2)
    expect(creates).toBe(0)
  })

  test("caller label UUID retry detects a concurrent label in another scope", async () => {
    const foreign = issueLabel({ teamId: "99999999-9999-4999-8999-999999999999" })
    let labelReads = 0
    let creates = 0
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async (variables: { filter: { id?: { eq: string } } }) => {
        labelReads += 1
        if (variables.filter.id) {
          return page(labelReads === 1 ? [] : [foreign])
        }
        return page([])
      },
      createIssueLabel: async () => {
        creates += 1
        throw new Error("caller UUID was created concurrently")
      }
    })

    const error = await Effect.runPromise(Effect.flip(
      makeLinearGateway({}, { client }).createLabel({
        name: foreign.name,
        color: foreign.color,
        description: foreign.description ?? undefined,
        workspace: false,
        team: "BEN",
        id: foreign.id,
        ifAbsent: true
      })
    ))

    expect(error.message).toContain("belongs to team 99999999-9999-4999-8999-999999999999")
    expect(labelReads).toBe(3)
    expect(creates).toBe(1)
  })

  test("issue list fetches only requested relations", async () => {
    const accesses: string[] = []
    const listed = issue()
    Object.defineProperties(listed, {
      state: { configurable: true, get: () => { accesses.push("state"); return Promise.resolve(undefined) } },
      assignee: { configurable: true, get: () => { accesses.push("assignee"); return Promise.resolve(undefined) } },
      parent: { configurable: true, get: () => { accesses.push("parent"); return Promise.resolve(undefined) } }
    })
    listed.labels = (async () => { accesses.push("labels"); return page([]) }) as unknown as Issue["labels"]

    await Effect.runPromise(makeLinearGateway({}, { client: clientWithIssues([listed]) }).listIssues({
      limit: 20,
      fields: ["id", "title"]
    }))

    expect(accesses).toEqual([])
  })

  test("issue list starts requested relation reads in parallel", async () => {
    const accesses: string[] = []
    const releases: Array<() => void> = []
    const pendingValue = <Value>(value: Value): Promise<Value> => new Promise((resolve) => {
      releases.push(() => resolve(value))
    })
    const listed = issue()
    Object.defineProperties(listed, {
      state: { configurable: true, get: () => { accesses.push("state"); return pendingValue(undefined) } },
      assignee: { configurable: true, get: () => { accesses.push("assignee"); return pendingValue(undefined) } },
      parent: { configurable: true, get: () => { accesses.push("parent"); return pendingValue(undefined) } }
    })
    listed.labels = (() => {
      accesses.push("labels")
      return pendingValue(page([]))
    }) as unknown as Issue["labels"]

    const result = Effect.runPromise(
      makeLinearGateway({}, { client: clientWithIssues([listed]) }).listIssues({
        limit: 20,
        fields: ["state", "assignee", "parent", "labels"]
      })
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(accesses).toEqual(["state", "assignee", "parent", "labels"])
    for (const release of releases) release()
    await result
  })

  test("uppercase UUID inputs are normalized before exact lookup and mutation", async () => {
    const mixedId = "abcdefab-cdef-4abc-8def-abcdefabcdef"
    const stored = issue({ id: mixedId })
    const queried: string[] = []
    const client = clientWithIssues([], {
      issues: async (variables: { filter: { id: { eq: string } } }) => {
        queried.push(variables.filter.id.eq)
        return page([stored])
      },
      teams: async () => page([team])
    })
    const gateway = makeLinearGateway({}, { client })

    const result = await Effect.runPromise(gateway.viewIssue(mixedId.toUpperCase()))
    const retried = await Effect.runPromise(gateway.createIssue({
      team: "BEN",
      title: stored.title,
      description: stored.description ?? "",
      id: mixedId.toUpperCase()
    }))

    expect(result.id).toBe(mixedId)
    expect(retried.changed).toBe(false)
    expect(queried).toEqual([mixedId, mixedId])
  })

  test("issue summaries fetch active and archived label names across every page", async () => {
    let labelPages = 0
    const labelOptions: Array<boolean | undefined> = []
    const secondPage = page([
      { id: "label-1", name: "wayfinder:map" },
      { id: "label-2", name: "wayfinder:task", archivedAt: new Date("2026-07-13T13:00:00.000Z") }
    ])
    const firstPage: ConnectionLike<{ id: string; name: string; archivedAt?: Date }> = {
      nodes: [{ id: "label-1", name: "wayfinder:map" }],
      pageInfo: { hasNextPage: true, endCursor: "next" },
      fetchNext: async () => {
        labelPages += 1
        return secondPage
      }
    }
    const labeled = issue({
      labelIds: ["label-1", "label-2"],
      labels: async (variables: { includeArchived?: boolean }) => {
        labelOptions.push(variables.includeArchived)
        return firstPage
      }
    })
    const result = await Effect.runPromise(
      makeLinearGateway({}, { client: clientWithIssues([labeled]) }).listIssues({ limit: 20, fields: ["labels"] })
    )

    expect(result.items[0]?.labels).toEqual([
      { id: "label-1", name: "wayfinder:map" },
      { id: "label-2", name: "wayfinder:task" }
    ])
    expect(labelOptions).toEqual([true])
    expect(labelPages).toBe(1)
  })

  test("archived label removal is retry-idempotent without enabling add", async () => {
    const archived = issueLabel({
      id: "66666666-6666-4666-8666-666666666666",
      name: "archived",
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    let attached = true
    const labeled = issue({
      labels: async () => page(attached ? [archived] : [])
    })
    Object.defineProperty(labeled, "labelIds", { get: () => attached ? [archived.id] : [] })
    const removals: Array<readonly [string, string]> = []
    let additions = 0
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([labeled], {
        issueLabels: async () => page([archived]),
        issueAddLabel: async () => {
          additions += 1
          return { success: true, issue: Promise.resolve(labeled) }
        },
        issueRemoveLabel: async (issueId: string, labelId: string) => {
          removals.push([issueId, labelId])
          attached = false
          return { success: true, issue: Promise.resolve(labeled) }
        }
      })
    })

    const result = await Effect.runPromise(gateway.removeLabel({ issue: "BEN-1", label: "ARCHIVED" }))
    const retry = await Effect.runPromise(gateway.removeLabel({ issue: "BEN-1", label: "ARCHIVED" }))
    const addError = await Effect.runPromise(Effect.flip(gateway.applyLabel({ issue: "BEN-1", label: "ARCHIVED" })))

    expect(removals).toEqual([[labeled.id, archived.id]])
    expect(result).toMatchObject({ changed: true, result: "label removed" })
    expect(retry).toMatchObject({ changed: false, result: "label already absent (no-op)" })
    expect(addError.message.toLowerCase()).toContain("archived")
    expect(additions).toBe(0)
  })

  test("detached label removal retries no-op without global ambiguity", async () => {
    const archivedTeam = issueLabel({
      id: "66666666-6666-4666-8666-666666666666",
      name: "archived",
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const archivedWorkspace = issueLabel({
      id: "77777777-7777-4777-8777-777777777777",
      name: "archived",
      teamId: undefined,
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const unlabeled = issue()
    let globalReads = 0
    let removals = 0
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([unlabeled], {
        issueLabels: async () => {
          globalReads += 1
          return page([archivedTeam, archivedWorkspace])
        },
        issueRemoveLabel: async () => {
          removals += 1
          return { success: true, issue: Promise.resolve(unlabeled) }
        }
      })
    })

    const result = await Effect.runPromise(gateway.removeLabel({ issue: "BEN-1", label: "ARCHIVED" }))

    expect(result).toMatchObject({ changed: false, result: "label already absent (no-op)" })
    expect(globalReads).toBe(0)
    expect(removals).toBe(0)
  })

  test("attached ambiguous label removal fails closed", async () => {
    const first = issueLabel({ name: "duplicate" })
    const second = issueLabel({ id: "77777777-7777-4777-8777-777777777777", name: "duplicate", teamId: undefined })
    const labeled = issue({
      labelIds: [first.id, second.id],
      labels: async () => page([first, second])
    })
    let removals = 0
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([labeled], {
        issueRemoveLabel: async () => {
          removals += 1
          return { success: true, issue: Promise.resolve(labeled) }
        }
      })
    })

    const error = await Effect.runPromise(Effect.flip(gateway.removeLabel({ issue: "BEN-1", label: "DUPLICATE" })))

    expect(error.message).toContain("Ambiguous")
    expect(removals).toBe(0)
  })

  test("issue details and mutation results retain attached archived labels", async () => {
    const viewer = user()
    const active = issueLabel({ name: "active" })
    const archived = issueLabel({
      id: "66666666-6666-4666-8666-666666666666",
      name: "archived",
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const labelOptions: Array<boolean | undefined> = []
    const assigned = issue({
      assigneeId: viewer.id,
      assignee: Promise.resolve(viewer),
      labelIds: [active.id, archived.id],
      labels: async (variables: { includeArchived?: boolean }) => {
        labelOptions.push(variables.includeArchived)
        return page(variables.includeArchived ? [active, archived] : [active])
      }
    })
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([assigned], { viewer: Promise.resolve(viewer) })
    })

    const detail = await Effect.runPromise(gateway.viewIssue("BEN-1"))
    const noOp = await Effect.runPromise(gateway.assignIssue({ id: "BEN-1", assignee: "me", replace: false }))

    expect(detail.labels.map((label) => label.name)).toEqual(["active", "archived"])
    expect(noOp.value.labels.map((label) => label.name)).toEqual(["active", "archived"])
    expect(labelOptions).toEqual([true, true])
  })

  test("label lists are active-only by default and include archived labels on every path when requested", async () => {
    const archived = issueLabel({
      teamId: undefined,
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const globalOptions: Array<boolean | undefined> = []
    const issueOptions: Array<boolean | undefined> = []
    const labeledIssue = issue({
      labels: async (variables: { includeArchived?: boolean }) => {
        issueOptions.push(variables.includeArchived)
        return page(variables.includeArchived ? [archived] : [])
      }
    })
    const client = clientWithIssues([labeledIssue], {
      issueLabels: async (variables: { includeArchived?: boolean }) => {
        globalOptions.push(variables.includeArchived)
        return page(variables.includeArchived ? [archived] : [])
      }
    })
    const gateway = makeLinearGateway({}, { client })

    const activeOnly = await Effect.runPromise(gateway.listLabels({ limit: 20, includeArchived: false }))
    const globalArchived = await Effect.runPromise(gateway.listLabels({ limit: 20, includeArchived: true }))
    const issueArchived = await Effect.runPromise(gateway.listLabels({
      issue: "BEN-1",
      limit: 20,
      includeArchived: true
    }))
    const issueNameArchived = await Effect.runPromise(gateway.listLabels({
      issue: "BEN-1",
      name: archived.name,
      limit: 20,
      includeArchived: true
    }))

    expect(activeOnly.items).toEqual([])
    expect(globalArchived.items[0]?.archivedAt).toBe("2026-07-13T13:00:00.000Z")
    expect(issueArchived.items[0]?.archivedAt).toBe("2026-07-13T13:00:00.000Z")
    expect(issueNameArchived.items[0]?.archivedAt).toBe("2026-07-13T13:00:00.000Z")
    expect(globalOptions).toEqual([false, true])
    expect(issueOptions).toEqual([true, true])
  })

  test("label lists load projected team scopes once per unique team", async () => {
    const labels = [
      issueLabel({ id: "55555555-5555-4555-8555-555555555551", name: "first" }),
      issueLabel({ id: "55555555-5555-4555-8555-555555555552", name: "second" })
    ]
    let teamReads = 0
    for (const label of labels) {
      Object.defineProperty(label, "team", {
        configurable: true,
        get: () => {
          teamReads += 1
          return Promise.resolve(team)
        }
      })
    }
    const gateway = makeLinearGateway({}, {
      client: clientWithIssues([], { issueLabels: async () => page(labels) })
    })

    await Effect.runPromise(gateway.listLabels({
      limit: 20,
      includeArchived: false,
      fields: ["id", "name"]
    }))
    expect(teamReads).toBe(0)

    const scoped = await Effect.runPromise(gateway.listLabels({
      limit: 20,
      includeArchived: false,
      fields: ["scope"]
    }))
    expect(scoped.items.map((label) => label.scope)).toEqual(["BEN", "BEN"])
    expect(teamReads).toBe(1)
  })

  test("label summaries use locale-independent ordering", async () => {
    const labeled = issue({
      labels: async () => page([
        issueLabel({ id: "66666666-6666-4666-8666-666666666666", name: "ä" }),
        issueLabel({ id: "77777777-7777-4777-8777-777777777777", name: "z" })
      ])
    })
    const result = await Effect.runPromise(
      makeLinearGateway({}, { client: clientWithIssues([labeled]) }).listIssues({ limit: 20, fields: ["labels"] })
    )

    expect(result.items[0]?.labels.map((label) => label.name)).toEqual(["z", "ä"])
  })

  test("relation filtering and limits precede counterpart resolution", async () => {
    let counterpartReads = 0
    const counterpart = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-9", title: "Target" })
    const relation = (id: string, type: string) => {
      const value = {
        id,
        type,
        issueId: issue().id,
        relatedIssueId: counterpart.id
      } as Record<string, unknown>
      Object.defineProperty(value, "relatedIssue", {
        get: () => {
          counterpartReads += 1
          return Promise.resolve(counterpart)
        }
      })
      return value
    }
    const source = issue({
      relations: async () => page([
        relation("c", "related"),
        relation("b", "blocks"),
        relation("a", "blocks")
      ])
    })
    const gateway = makeLinearGateway({}, { client: clientWithIssues([source]) })

    const result = await Effect.runPromise(gateway.listRelations({
      issue: "BEN-1",
      type: "blocks",
      direction: "outgoing",
      limit: 1
    }))

    expect(result.items.map((item) => item.id)).toEqual(["a"])
    expect(result.page).toEqual({ hasNext: true, endCursor: "relation:1" })
    expect(counterpartReads).toBe(1)
  })

  test("relation creation sends the directed source and target tuple to Linear", async () => {
    const source = issue({ relations: async () => page([]) })
    const target = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const payloads: unknown[] = []
    const relation = {
      id: "77777777-7777-4777-8777-777777777777",
      type: "blocks",
      issueId: source.id,
      relatedIssueId: target.id,
      relatedIssue: Promise.resolve(target)
    }
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
      createIssueRelation: async (input: unknown) => {
        payloads.push(input)
        return { success: true, issueRelation: Promise.resolve(relation) }
      }
    })

    await Effect.runPromise(makeLinearGateway({}, { client }).createRelation({
      issue: "BEN-1",
      relatedIssue: "BEN-2",
      type: "blocks"
    }))

    expect(payloads).toEqual([{
      issueId: source.id,
      relatedIssueId: target.id,
      type: "blocks",
      id: undefined
    }])
  })

  test("relation creation rejects self-blocking after resolving aliases", async () => {
    const sameIssue = issue({ relations: async () => { throw new Error("must not inspect relations") } })
    let creates = 0
    const client = clientWithIssues([sameIssue], {
      createIssueRelation: async () => { creates += 1; throw new Error("must not create") }
    })

    const error = await Effect.runPromise(Effect.flip(makeLinearGateway({}, { client }).createRelation({
      issue: "BEN-1",
      relatedIssue: sameIssue.id,
      type: "blocks"
    })))

    expect(error.message).toContain("cannot block itself")
    expect(creates).toBe(0)
  })

  test("relation natural key remains an idempotent no-op without a caller UUID", async () => {
    const target = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const naturalRelation = {
      id: "77777777-7777-4777-8777-777777777777",
      type: "blocks",
      issueId: issue().id,
      relatedIssueId: target.id,
      relatedIssue: Promise.resolve(target)
    }
    const source = issue({ relations: async () => page([naturalRelation]) })
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
      createIssueRelation: async () => { throw new Error("must not create") }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).createRelation({
      issue: "BEN-1",
      relatedIssue: "BEN-2",
      type: "blocks"
    }))

    expect(result).toMatchObject({ changed: false, result: "directed relation already exists (no-op)" })
  })

  test("tuple relation removal resolves an archived target", async () => {
    const source = issue()
    const target = issue({
      id: "99999999-9999-4999-8999-999999999999",
      identifier: "BEN-2",
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const active = {
      id: "77777777-7777-4777-8777-777777777777",
      type: "blocks",
      issueId: source.id,
      relatedIssueId: target.id,
      archivedAt: undefined
    }
    source.relations = async () => page([active]) as never
    const deleted: string[] = []
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
      deleteIssueRelation: async (id: string) => {
        deleted.push(id)
        return { success: true }
      },
      issueRelation: async () => ({ ...active, archivedAt: new Date("2026-07-13T14:00:00.000Z") })
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).removeRelation({
      issue: "BEN-1",
      relatedIssue: "BEN-2",
      type: "blocks"
    }))

    expect(deleted).toEqual([active.id])
    expect(result).toMatchObject({ changed: true, value: { id: active.id } })
  })

  test("relation removal reconciles an indeterminate SDK failure", async () => {
    const source = issue()
    const target = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const relation = {
      id: "77777777-7777-4777-8777-777777777777",
      type: "blocks",
      issueId: source.id,
      relatedIssueId: target.id,
      archivedAt: undefined
    }
    source.relations = async () => page([relation]) as never
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
      deleteIssueRelation: async () => { throw new Error("connection reset") },
      issueRelation: async () => ({ ...relation, archivedAt: new Date("2026-07-13T14:00:00.000Z") })
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).removeRelation({
      issue: "BEN-1",
      relatedIssue: "BEN-2",
      type: "blocks"
    }))

    expect(result).toMatchObject({
      changed: false,
      result: "directed relation absence verified after an indeterminate response",
      value: { id: relation.id }
    })
  })

  test("indeterminate relation removal fails closed with inspection guidance", async () => {
    const source = issue()
    const target = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const relation = {
      id: "77777777-7777-4777-8777-777777777777",
      type: "blocks",
      issueId: source.id,
      relatedIssueId: target.id,
      archivedAt: undefined
    }
    source.relations = async () => page([relation]) as never
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
      deleteIssueRelation: async () => { throw new Error("connection reset") },
      issueRelation: async () => relation
    })

    const error = await Effect.runPromise(Effect.flip(makeLinearGateway({}, { client }).removeRelation({
      issue: "BEN-1",
      relatedIssue: "BEN-2",
      type: "blocks"
    })))

    expect(error.message).toContain("outcome is unknown")
    expect(error.help).toContain(`linear-axi relations list --issue ${source.id} --type blocks --direction outgoing`)
    expect(error.help).not.toContain("Retry")
  })

  test("relation removal ignores archived tuple history when one active match exists", async () => {
    const source = issue()
    const target = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const active = {
      id: "77777777-7777-4777-8777-777777777777",
      type: "blocks",
      issueId: source.id,
      relatedIssueId: target.id,
      archivedAt: undefined
    }
    const archived = {
      ...active,
      id: "88888888-8888-4888-8888-888888888888",
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    }
    source.relations = async () => page([archived, active]) as never
    const deleted: string[] = []
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
      deleteIssueRelation: async (id: string) => {
        deleted.push(id)
        return { success: true }
      },
      issueRelation: async () => ({ ...active, archivedAt: new Date("2026-07-13T14:00:00.000Z") })
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).removeRelation({
      issue: "BEN-1",
      relatedIssue: "BEN-2",
      type: "blocks"
    }))

    expect(deleted).toEqual([active.id])
    expect(result).toMatchObject({ changed: true, value: { id: active.id } })
  })

  test("starts outgoing and incoming relation pagination concurrently", async () => {
    let outgoingStarted = false
    let incomingStarted = false
    let outgoingObservedIncoming = false
    let incomingObservedOutgoing = false
    const source = issue({
      relations: async () => {
        outgoingStarted = true
        await Promise.resolve()
        outgoingObservedIncoming = incomingStarted
        return page([])
      },
      inverseRelations: async () => {
        incomingStarted = true
        await Promise.resolve()
        incomingObservedOutgoing = outgoingStarted
        return page([])
      }
    })

    await Effect.runPromise(makeLinearGateway({}, { client: clientWithIssues([source]) }).listRelations({
      issue: "BEN-1",
      direction: "both",
      limit: 20
    }))

    expect(outgoingObservedIncoming).toBe(true)
    expect(incomingObservedOutgoing).toBe(true)
  })

  test("starts relation natural-key and caller-UUID lookups concurrently", async () => {
    const callerId = "88888888-8888-4888-8888-888888888888"
    const target = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const naturalRelation = {
      id: "77777777-7777-4777-8777-777777777777",
      type: "blocks",
      issueId: issue().id,
      relatedIssueId: target.id,
      relatedIssue: Promise.resolve(target)
    }
    let identityLookupStarted = false
    let naturalLookupObservedIdentity = false
    const source = issue({
      relations: async () => {
        await Promise.resolve()
        naturalLookupObservedIdentity = identityLookupStarted
        return page([naturalRelation])
      }
    })
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
      issueRelation: async () => {
        identityLookupStarted = true
        throw new Error("Entity not found: IssueRelation")
      },
      createIssueRelation: async () => { throw new Error("must not create") }
    })

    const error = await Effect.runPromise(Effect.flip(makeLinearGateway({}, { client }).createRelation({
      issue: "BEN-1",
      relatedIssue: "BEN-2",
      type: "blocks",
      id: callerId
    })))

    expect(error.message).toContain(`not caller UUID ${callerId}`)
    expect(naturalLookupObservedIdentity).toBe(true)
  })

  test("caller relation UUID probes use singular lookup for no-op, conflict, and archived conflict", async () => {
    const relationId = "88888888-8888-4888-8888-888888888888"
    const target = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const singularLookups: string[] = []
    let connectionReads = 0
    const makeRelation = (overrides: Record<string, unknown> = {}) => ({
      id: relationId,
      type: "blocks",
      issueId: issue().id,
      relatedIssueId: target.id,
      relatedIssue: Promise.resolve(target),
      archivedAt: undefined,
      ...overrides
    })
    const run = (exact: Record<string, unknown>) => {
      const source = issue({ relations: async () => page([]) })
      const client = clientWithIssues([], {
        issues: async (variables: { filter: unknown }) =>
          page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
        issueRelation: async (id: string) => {
          singularLookups.push(id)
          return exact
        },
        issueRelations: async () => {
          connectionReads += 1
          return page([])
        },
        createIssueRelation: async () => { throw new Error("must not create") }
      })
      return makeLinearGateway({}, { client }).createRelation({
        issue: "BEN-1",
        relatedIssue: "BEN-2",
        type: "blocks",
        id: relationId
      })
    }

    const noOp = await Effect.runPromise(run(makeRelation()))
    const reused = await Effect.runPromise(Effect.flip(run(makeRelation({ relatedIssueId: issue().id }))))
    const archived = await Effect.runPromise(Effect.flip(run(makeRelation({
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    }))))

    expect(noOp.changed).toBe(false)
    expect(reused.message).toContain("conflict")
    expect(archived.message.toLowerCase()).toContain("archived")
    expect(singularLookups).toEqual([relationId, relationId, relationId])
    expect(connectionReads).toBe(0)
  })

  test("missing caller relation UUID is rechecked singularly after create failure", async () => {
    const relationId = "88888888-8888-4888-8888-888888888888"
    const target = issue({ id: "99999999-9999-4999-8999-999999999999", identifier: "BEN-2" })
    const existing = {
      id: relationId,
      type: "blocks",
      issueId: issue().id,
      relatedIssueId: target.id,
      relatedIssue: Promise.resolve(target),
      archivedAt: undefined
    }
    const source = issue({ relations: async () => page([]) })
    let identityReads = 0
    let connectionReads = 0
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"number":{"eq":2}') ? [target] : [source]),
      issueRelation: async () => {
        identityReads += 1
        if (identityReads === 1) {
          throw new Error("Entity not found: IssueRelation")
        }
        return existing
      },
      issueRelations: async () => {
        connectionReads += 1
        return page([])
      },
      createIssueRelation: async () => { throw new Error("concurrent create") }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).createRelation({
      issue: "BEN-1",
      relatedIssue: "BEN-2",
      type: "blocks",
      id: relationId
    }))

    expect(result.changed).toBe(false)
    expect(identityReads).toBe(2)
    expect(connectionReads).toBe(0)
  })

  test("frontier loads only map labels and resolves type labels concurrently", async () => {
    const typeLabels = ["research", "prototype", "grilling", "task"].map((type, index) => issueLabel({
      id: `55555555-5555-4555-8555-55555555555${index + 1}`,
      name: `wayfinder:${type}`
    }))
    const mapLabel = issueLabel({
      id: "66666666-6666-4666-8666-666666666666",
      name: "wayfinder:map"
    })
    const archivedMapLabel = issueLabel({
      id: "66666666-6666-4666-8666-666666666667",
      name: "other:map",
      archivedAt: new Date("2026-07-13T13:00:00.000Z")
    })
    const mapLabelOptions: Array<boolean | undefined> = []
    const map = issue({
      labels: async (variables: { includeArchived?: boolean }) => {
        mapLabelOptions.push(variables.includeArchived)
        return page(variables.includeArchived ? [mapLabel, archivedMapLabel] : [mapLabel])
      }
    })
    Object.defineProperties(map, {
      state: { configurable: true, get: () => { throw new Error("frontier must not load map state") } },
      assignee: { configurable: true, get: () => { throw new Error("frontier must not load map assignee") } },
      parent: { configurable: true, get: () => { throw new Error("frontier must not load map parent") } },
      team: { configurable: true, get: () => { throw new Error("frontier must use the map team ID") } }
    })
    const candidate = issue({
      id: "77777777-7777-4777-8777-777777777777",
      identifier: "BEN-2",
      title: "Ready task",
      labelIds: [typeLabels[3]!.id]
    })
    let activeLabelReads = 0
    let maxActiveLabelReads = 0
    const client = clientWithIssues([], {
      issues: async (variables: { filter: unknown }) =>
        page(JSON.stringify(variables.filter).includes('"parent"') ? [candidate] : [map]),
      issueLabels: async (variables: { filter: { name: { eqIgnoreCase: string } } }) => {
        activeLabelReads += 1
        maxActiveLabelReads = Math.max(maxActiveLabelReads, activeLabelReads)
        await Bun.sleep(5)
        activeLabelReads -= 1
        return page(typeLabels.filter((label) => label.name === variables.filter.name.eqIgnoreCase))
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).frontier({
      map: "BEN-1",
      first: 20
    }))

    expect(result.items).toEqual([{
      id: candidate.id,
      identifier: candidate.identifier,
      title: candidate.title,
      type: "task"
    }])
    expect(mapLabelOptions).toEqual([false])
    expect(maxActiveLabelReads).toBe(4)
  })

  test.each(["research", "prototype", "grilling", "task"])(
    "frontier rejects a %s label group before candidate evaluation",
    async (groupType) => {
      const typeLabels = ["research", "prototype", "grilling", "task"].map((type, index) => issueLabel({
        id: `55555555-5555-4555-8555-55555555555${index + 1}`,
        name: `wayfinder:${type}`,
        isGroup: type === groupType
      }))
      const map = issue({
        labels: async () => page([issueLabel({
          id: "66666666-6666-4666-8666-666666666666",
          name: "wayfinder:map"
        })])
      })
      let candidateReads = 0
      const client = clientWithIssues([], {
        issues: async (variables: { filter: unknown }) => {
          if (JSON.stringify(variables.filter).includes('"parent"')) {
            candidateReads += 1
            return page([])
          }
          return page([map])
        },
        issueLabels: async (variables: { filter: { name: { eqIgnoreCase: string } } }) =>
          page(typeLabels.filter((label) => label.name === variables.filter.name.eqIgnoreCase))
      })

      const error = await Effect.runPromise(Effect.flip(makeLinearGateway({}, { client }).frontier({
        map: "BEN-1",
        first: 20
      })))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain(`label group wayfinder:${groupType} conflicts with the requested ordinary label`)
      expect(candidateReads).toBe(0)
    }
  )

  test("invalid local cursors fail before Linear access", async () => {
    let issueReads = 0
    const client = clientWithIssues([], {
      issues: async () => { issueReads += 1; return page([]) }
    })
    const gateway = makeLinearGateway({}, { client })

    for (const cursor of ["invalid", "relation:01", "relation:9007199254740992", `relation:${"9".repeat(400)}`]) {
      const error = await Effect.runPromise(Effect.flip(gateway.listRelations({
        issue: "BEN-1",
        direction: "both",
        after: cursor,
        limit: 20
      })))
      expect(error.message).toBe("invalid relation cursor")
    }
    for (const cursor of ["invalid", "label:01", "label:9007199254740992", `label:${"9".repeat(400)}`]) {
      const error = await Effect.runPromise(Effect.flip(gateway.listLabels({
        issue: "BEN-1",
        name: "wayfinder:task",
        after: cursor,
        limit: 20,
        includeArchived: false
      })))
      expect(error.message).toBe("invalid label cursor")
    }
    const offsetTimestampCursor = `wf1.${Buffer.from(JSON.stringify({
      v: 1,
      order: 1,
      createdAt: "2026-01-01T01:00:00.000+01:00",
      id: "11111111-1111-4111-8111-111111111111"
    }), "utf8").toString("base64url")}`
    const frontierErrors = await Promise.all(["invalid", offsetTimestampCursor].map((after) =>
      Effect.runPromise(Effect.flip(gateway.frontier({
        map: "BEN-1",
        first: 20,
        after
      })))
    ))
    const frontierSizeError = await Effect.runPromise(Effect.flip(gateway.frontier({
      map: "BEN-1",
      first: 101
    })))

    expect(frontierErrors.map((error) => error.message)).toEqual([
      "invalid frontier cursor",
      "invalid frontier cursor"
    ])
    expect(frontierSizeError.message).toBe("invalid frontier page size")
    expect(issueReads).toBe(0)
  })

  test("rate-limit errors remain structured API failures", async () => {
    const client = clientWithIssues([], {
      issues: async () => { throw new Error("429 rate limit exceeded") }
    })
    const error = await Effect.runPromise(Effect.flip(makeLinearGateway({}, { client }).viewIssue("BEN-1")))
    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toBe("429 rate limit exceeded")
    expect(error.help).toContain("Retry `linear-axi issues view`")
  })
})
