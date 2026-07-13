import { describe, expect, test } from "bun:test"
import type { Comment, Issue, IssueLabel, LinearClient } from "@linear/sdk"
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

  test("exact archived issue and caller-UUID probes include archived entities", async () => {
    const archivedIssue = issue({ archivedAt: new Date("2026-07-13T13:00:00.000Z") })
    const archivedComment = comment({ archivedAt: new Date("2026-07-13T13:00:00.000Z") })
    const archivedLabel = issueLabel({ archivedAt: new Date("2026-07-13T13:00:00.000Z") })
    const issueQueries: Array<Record<string, unknown>> = []
    const commentQueries: Array<Record<string, unknown>> = []
    const labelQueries: Array<Record<string, unknown>> = []
    const client = clientWithIssues([], {
      issues: async (variables: Record<string, unknown>) => {
        issueQueries.push(variables)
        return page([archivedIssue])
      },
      teams: async () => page([team]),
      comments: async (variables: Record<string, unknown>) => {
        commentQueries.push(variables)
        return page([archivedComment])
      },
      issueLabels: async (variables: Record<string, unknown>) => {
        labelQueries.push(variables)
        return page([archivedLabel])
      }
    })
    const gateway = makeLinearGateway({}, { client })

    expect((await Effect.runPromise(gateway.viewIssue("BEN-1"))).identifier).toBe("BEN-1")
    expect((await Effect.runPromise(gateway.createIssue({
      team: "BEN",
      title: archivedIssue.title,
      description: archivedIssue.description ?? "",
      id: archivedIssue.id
    }))).changed).toBe(false)
    expect((await Effect.runPromise(gateway.createComment({
      issue: "BEN-1",
      body: archivedComment.body,
      id: archivedComment.id
    }))).changed).toBe(false)
    expect((await Effect.runPromise(gateway.createLabel({
      name: archivedLabel.name,
      color: archivedLabel.color,
      description: archivedLabel.description ?? undefined,
      workspace: false,
      team: "BEN",
      id: archivedLabel.id,
      ifAbsent: false
    }))).changed).toBe(false)

    expect(issueQueries).not.toHaveLength(0)
    expect(issueQueries.every((variables) => variables.includeArchived === true)).toBe(true)
    expect(commentQueries).toHaveLength(1)
    expect(commentQueries[0]?.includeArchived).toBe(true)
    expect(labelQueries).toHaveLength(1)
    expect(labelQueries[0]?.includeArchived).toBe(true)
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
    const viewer = { id: "33333333-3333-4333-8333-333333333333", name: "Henrik" }
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

  test("close without state selects the only completed state", async () => {
    const selectedState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Done", type: "completed", position: 1 }
    const before = issue()
    const after = issue({ state: Promise.resolve(selectedState) })
    let reads = 0
    let selected: string | undefined
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      workflowStates: async () => page([selectedState]),
      updateIssue: async (_id: string, input: { stateId?: string }) => {
        selected = input.stateId
        return { success: true, issue: Promise.resolve(after) }
      }
    })

    const result = await Effect.runPromise(makeLinearGateway({}, { client }).closeIssue({ id: "BEN-1" }))

    expect(result.changed).toBe(true)
    expect(selected).toBe(selectedState.id)
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

  test("label create with caller UUID and if-absent creates when both identities are absent", async () => {
    const id = "55555555-5555-4555-8555-555555555555"
    const created = issueLabel({ id })
    let sent: Record<string, unknown> | undefined
    const filters: unknown[] = []
    const client = clientWithIssues([], {
      teams: async () => page([team]),
      issueLabels: async (variables: { filter: unknown }) => {
        filters.push(variables.filter)
        return page([])
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
      { name: { eqIgnoreCase: created.name }, team: { id: { eq: team.id } } },
      { id: { eq: id }, team: { id: { eq: team.id } } }
    ])
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

  test("issue summaries fetch truthful label names across every page", async () => {
    let labelPages = 0
    const secondPage = page([
      { id: "label-1", name: "wayfinder:map" },
      { id: "label-2", name: "wayfinder:task" }
    ])
    const firstPage: ConnectionLike<{ id: string; name: string }> = {
      nodes: [{ id: "label-1", name: "wayfinder:map" }],
      pageInfo: { hasNextPage: true, endCursor: "next" },
      fetchNext: async () => {
        labelPages += 1
        return secondPage
      }
    }
    const labeled = issue({
      labelIds: ["label-1", "label-2"],
      labels: async () => firstPage
    })
    const result = await Effect.runPromise(
      makeLinearGateway({}, { client: clientWithIssues([labeled]) }).listIssues({ limit: 20, fields: ["labels"] })
    )

    expect(result.items[0]?.labels).toEqual([
      { id: "label-1", name: "wayfinder:map" },
      { id: "label-2", name: "wayfinder:task" }
    ])
    expect(labelPages).toBe(1)
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

  test("invalid local cursors fail before Linear access", async () => {
    let issueReads = 0
    const client = clientWithIssues([], {
      issues: async () => { issueReads += 1; return page([]) }
    })
    const gateway = makeLinearGateway({}, { client })

    const relationError = await Effect.runPromise(Effect.flip(gateway.listRelations({
      issue: "BEN-1",
      direction: "both",
      after: "invalid",
      limit: 20
    })))
    const labelError = await Effect.runPromise(Effect.flip(gateway.listLabels({
      issue: "BEN-1",
      name: "wayfinder:task",
      after: "invalid",
      limit: 20
    })))

    expect(relationError.message).toBe("invalid relation cursor")
    expect(labelError.message).toBe("invalid label cursor")
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
