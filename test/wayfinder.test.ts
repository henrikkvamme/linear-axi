import { describe, expect, test } from "bun:test"
import { LinearDomainError } from "../src/errors"
import { DESCRIPTION_CONCURRENCY_WARNING } from "../src/linear"
import { projectFrontier, resolveWayfinderPrefix } from "../src/wayfinder"

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
