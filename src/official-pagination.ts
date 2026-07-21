import { Effect, Predicate } from "effect"
import { LinearDomainError, type CliError } from "./errors"
import type { LinearGateway } from "./linear"

const MAX_OFFICIAL_PAGES = 1_000

export const fetchOfficialRows = Effect.fn("fetchOfficialRows")(function*(
  gateway: LinearGateway,
  tool: string,
  args: Readonly<Record<string, unknown>>,
  key: string,
  stopWhen?: (rows: ReadonlyArray<Record<string, unknown>>) => boolean
): Effect.fn.Return<ReadonlyArray<Record<string, unknown>>, CliError> {
  const rows: Array<Record<string, unknown>> = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  do {
    const page = yield* gateway.callOfficialTool(tool, { ...args, ...(cursor === undefined ? {} : { cursor }) })
    if (!Predicate.isObject(page) || !Array.isArray(page[key]) || page[key].some((row) => !Predicate.isObject(row))) {
      return yield* officialPaginationShapeDrift(tool, `${key} rows`)
    }
    rows.push(...page[key] as ReadonlyArray<Record<string, unknown>>)
    pages += 1
    if (typeof page.hasNextPage !== "boolean") {
      return yield* officialPaginationShapeDrift(tool, "pagination metadata")
    }
    if (!page.hasNextPage || stopWhen?.(rows) === true) return rows
    if (pages >= MAX_OFFICIAL_PAGES) {
      return yield* Effect.fail(new LinearDomainError({
        message: `Official Linear MCP ${tool} pagination exceeded the ${MAX_OFFICIAL_PAGES}-page safety limit`,
        help: "Narrow the selector and retry."
      }))
    }
    if (typeof page.cursor !== "string" || page.cursor.trim().length === 0) {
      return yield* officialPaginationShapeDrift(tool, "cursor")
    }
    if (seenCursors.has(page.cursor)) {
      return yield* Effect.fail(new LinearDomainError({
        message: `Official Linear MCP ${tool} pagination cursor did not advance`,
        help: "Retry after Linear pagination recovers."
      }))
    }
    seenCursors.add(page.cursor)
    cursor = page.cursor
  } while (cursor !== undefined)
  return rows
})

const officialPaginationShapeDrift = (
  tool: string,
  detail: string
): Effect.Effect<never, LinearDomainError> => Effect.fail(new LinearDomainError({
  message: `Official Linear MCP output shape drifted for ${tool}: expected valid ${detail}`,
  help: "Refresh the frozen parity inventory and update linear-axi before retrying."
}))
