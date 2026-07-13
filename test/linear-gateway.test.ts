import { describe, expect, test } from "bun:test"
import type { Issue, LinearClient } from "@linear/sdk"
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

describe("SDK LinearGateway conflict contracts", () => {
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

  test("post-write mismatch is a conflict", async () => {
    const before = issue()
    const after = issue({ description: "other", updatedAt: new Date("2026-07-13T12:01:00.000Z") })
    let reads = 0
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      updateIssue: async () => ({ success: true, issue: Promise.resolve(after) })
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

  test("close selects the stable lowest position and UUID completed state", async () => {
    const firstState = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Done B", type: "completed", position: 2 }
    const selectedState = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Done A", type: "completed", position: 1 }
    const before = issue()
    const after = issue({ state: Promise.resolve(selectedState) })
    let reads = 0
    let selected: string | undefined
    const client = clientWithIssues([], {
      issues: async () => page([reads++ === 0 ? before : after]),
      workflowStates: async () => page([firstState, selectedState]),
      updateIssue: async (_id: string, input: { stateId?: string }) => {
        selected = input.stateId
        return { success: true, issue: Promise.resolve(after) }
      }
    })
    const result = await Effect.runPromise(makeLinearGateway({}, { client }).closeIssue({ id: "BEN-1" }))
    expect(result.changed).toBe(true)
    expect(selected).toBe(selectedState.id)
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
