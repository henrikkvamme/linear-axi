import { describe, expect, test } from "bun:test"
import type { LinearClient, Team } from "@linear/sdk"
import { fetchAllPages, type ConnectionLike } from "../src/linear-pagination"
import { resolveTeam } from "../src/linear-resolve"

const connection = <Value>(pages: ReadonlyArray<ReadonlyArray<Value>>): ConnectionLike<Value> => {
  const make = (index: number, accumulated: ReadonlyArray<Value>): ConnectionLike<Value> => {
    const nodes = [...accumulated, ...(pages[index] ?? [])]
    return {
      nodes,
      pageInfo: {
        hasNextPage: index < pages.length - 1,
        endCursor: index < pages.length - 1 ? `cursor-${index}` : null
      },
      fetchNext: async () => make(index + 1, nodes)
    }
  }
  return make(0, [])
}

describe("Linear connection pagination", () => {
  test("shared loop walks every page and preserves page order", async () => {
    expect(await fetchAllPages(connection([[1], [2, 3], [4]]))).toEqual([1, 2, 3, 4])
  })

  test("exact team resolver finds a match on page two", async () => {
    const first = { id: "1", key: "ONE", name: "One" } as Team
    const match = { id: "2", key: "BEN", name: "Bender" } as Team
    const client = { teams: async () => connection([[first], [match]]) } as unknown as LinearClient
    expect((await resolveTeam(client, "BEN")).id).toBe("2")
  })

  test("exact resolver rejects ambiguity split across pages", async () => {
    const one = { id: "1", key: "BEN", name: "Bender one" } as Team
    const two = { id: "2", key: "ben", name: "Bender two" } as Team
    const client = { teams: async () => connection([[one], [two]]) } as unknown as LinearClient
    expect(resolveTeam(client, "BEN")).rejects.toThrow("Ambiguous Linear team BEN")
  })

  test("loop rejects a next page without a cursor", async () => {
    const broken: ConnectionLike<number> = {
      nodes: [1],
      pageInfo: { hasNextPage: true, endCursor: null },
      fetchNext: async () => broken
    }
    expect(fetchAllPages(broken)).rejects.toThrow("without an end cursor")
  })
})
