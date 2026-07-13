import { describe, expect, test } from "bun:test"
import { LinearDomainError } from "../src/errors"
import { DESCRIPTION_CONCURRENCY_WARNING } from "../src/linear"
import {
  encodeFrontierCursor,
  paginateFrontier,
  projectFrontier,
  resolveWayfinderPrefix
} from "../src/wayfinder"

describe("Wayfinder frontier projection", () => {
  const labels = new Map([
    ["research-id", { name: "wayfinder:research", type: "research" as const }],
    ["task-id", { name: "wayfinder:task", type: "task" as const }]
  ])

  test("sorts null order last and breaks equal order/time ties by id", () => {
    const projected = projectFrontier([
      { id: "z", identifier: "BEN-4", title: "Null", createdAt: "2026-01-01T00:00:00Z", subIssueSortOrder: null, labelIds: ["task-id"] },
      { id: "b", identifier: "BEN-3", title: "B", createdAt: "2026-01-01T00:00:00Z", subIssueSortOrder: 1, labelIds: ["task-id"] },
      { id: "a", identifier: "BEN-2", title: "A", createdAt: "2026-01-01T00:00:00Z", subIssueSortOrder: 1, labelIds: ["research-id"] }
    ], labels)
    expect(projected.map((issue) => issue.id)).toEqual(["a", "b", "z"])
  })

  test("paginates more than 100 deterministic items and returns a final empty page", () => {
    const candidates = Array.from({ length: 205 }, (_, index) => ({
      id: `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
      identifier: `BEN-${index + 1}`,
      title: `Issue ${index + 1}`,
      createdAt: "2026-01-01T00:00:00Z",
      subIssueSortOrder: index,
      labelIds: ["task-id"]
    }))

    const first = paginateFrontier(candidates, labels, 100)
    const second = paginateFrontier(candidates, labels, 100, first.pageInfo.endCursor!)
    const third = paginateFrontier(candidates, labels, 100, second.pageInfo.endCursor!)
    const empty = paginateFrontier(candidates, labels, 100, third.pageInfo.endCursor!)

    expect([first.items.length, second.items.length, third.items.length, empty.items.length]).toEqual([100, 100, 5, 0])
    expect(first.pageInfo.hasNextPage).toBe(true)
    expect(third.pageInfo.hasNextPage).toBe(false)
    expect(empty.pageInfo).toEqual({ hasNextPage: false, endCursor: null })
    expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual(candidates.map((item) => item.id))
  })

  test("stale frontier cursors resume strictly after their encoded sort key", () => {
    const removed = {
      id: "22222222-2222-4222-8222-222222222222",
      identifier: "BEN-2",
      title: "Removed",
      createdAt: "2026-01-01T00:00:00Z",
      subIssueSortOrder: 2,
      labelIds: ["task-id"]
    }
    const cursor = encodeFrontierCursor(removed)
    const candidates = [
      { ...removed, id: "11111111-1111-4111-8111-111111111111", identifier: "BEN-1", subIssueSortOrder: 1 },
      { ...removed, id: "33333333-3333-4333-8333-333333333333", identifier: "BEN-3", subIssueSortOrder: 3 }
    ]

    expect(paginateFrontier(candidates, labels, 20, cursor).items.map((item) => item.identifier)).toEqual(["BEN-3"])
  })

  test("concurrent frontier insertions before a cursor do not prevent progress", () => {
    const base = {
      id: "22222222-2222-4222-8222-222222222222",
      identifier: "BEN-2",
      title: "Second",
      createdAt: "2026-01-01T00:00:00Z",
      subIssueSortOrder: 2,
      labelIds: ["task-id"]
    }
    const cursor = encodeFrontierCursor(base)
    const candidates = [
      { ...base, id: "11111111-1111-4111-8111-111111111111", identifier: "BEN-1", subIssueSortOrder: 1 },
      base,
      { ...base, id: "33333333-3333-4333-8333-333333333333", identifier: "BEN-3", subIssueSortOrder: 3 }
    ]

    expect(paginateFrontier(candidates, labels, 20, cursor).items.map((item) => item.identifier)).toEqual(["BEN-3"])
  })

  test("rejects malformed frontier cursors", () => {
    expect(() => paginateFrontier([], labels, 20, "not-a-frontier-cursor")).toThrow("invalid frontier cursor")
  })

  test("rejects children with zero or multiple type labels", () => {
    for (const labelIds of [[], ["task-id", "research-id"]]) {
      expect(() => projectFrontier([
        { id: "bad", identifier: "BEN-2", title: "Bad", createdAt: "2026-01-01T00:00:00Z", subIssueSortOrder: 1, labelIds }
      ], labels)).toThrow(LinearDomainError)
    }
  })

  test("requires exactly one map label and supports only run-scoped verification labels besides production", () => {
    expect(resolveWayfinderPrefix("BEN-1", [{ id: "m", name: "wayfinder:map" }])).toBe("wayfinder")
    expect(resolveWayfinderPrefix("BEN-1", [{ id: "m", name: "WF-VERIFY-20260713T140000Z:map" }])).toBe("WF-VERIFY-20260713T140000Z")
    expect(() => resolveWayfinderPrefix("BEN-1", [])).toThrow("exactly one")
  })
})
describe("documented concurrency model", () => {
  test("known staleness is rejectable but the final description read/write window remains", () => {
    let revision = 1
    let description = "initial"
    const callerRevision = revision
    description = "human edit"
    revision += 1
    expect(callerRevision).not.toBe(revision)

    const finalWindowRevision = revision
    expect(finalWindowRevision).toBe(revision)
    description = "another human edit after preflight"
    revision += 1
    description = "caller replacement"
    revision += 1

    expect(description).toBe("caller replacement")
    expect(DESCRIPTION_CONCURRENCY_WARNING).toContain("no atomic compare-and-swap")
    expect(DESCRIPTION_CONCURRENCY_WARNING).toContain("final read/write race remains")
  })

  test("two unassigned readers can both write because assignment is not an atomic claim", () => {
    let assignee: string | null = null
    const firstRead = assignee
    const secondRead = assignee
    if (firstRead === null) assignee = "first"
    if (secondRead === null) assignee = "second"
    expect(firstRead).toBeNull()
    expect(secondRead).toBeNull()
    expect(assignee).toBe("second")
  })
})
