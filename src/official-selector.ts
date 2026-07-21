import { Effect } from "effect"
import { LinearDomainError } from "./errors"

const MAX_CANDIDATE_IDS = 10

export const resolveExactOfficialEntity = (
  noun: string,
  selector: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  keys: ReadonlyArray<string>
): Effect.Effect<Record<string, unknown>, LinearDomainError> => {
  const normalized = selector.toLowerCase()
  const matches = rows.filter((row) => keys.some((key) => {
    const value = row[key]
    return (typeof value === "string" || typeof value === "number") && String(value).toLowerCase() === normalized
  }))
  const candidateIds = renderCandidateIds(matches.length > 0 ? matches : rows)
  if (matches.length === 0) {
    return Effect.fail(new LinearDomainError({
      message: `No ${noun} exactly matched ${selector}`,
      help: candidateIds
    }))
  }
  if (matches.length > 1) {
    return Effect.fail(new LinearDomainError({
      message: `Ambiguous ${noun} selector ${selector}`,
      help: candidateIds
    }))
  }
  const match = matches[0]!
  if (!nonEmptyString(match.id)) {
    return Effect.fail(new LinearDomainError({
      message: `${noun} selector ${selector} matched an entity without an immutable id`,
      help: candidateIds
    }))
  }
  return Effect.succeed(match)
}

export const resolveExactOfficialId = (
  noun: string,
  selector: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  keys: ReadonlyArray<string>
): Effect.Effect<string, LinearDomainError> => resolveExactOfficialEntity(noun, selector, rows, keys).pipe(
  Effect.map((entity) => entity.id as string)
)

export const renderCandidateIds = (rows: ReadonlyArray<Record<string, unknown>>): string => {
  const ids = rows
    .map((row) => nonEmptyString(row.id) ? row.id : "missing-id")
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  const displayed = ids.slice(0, MAX_CANDIDATE_IDS)
  return `Candidate ids (showing ${displayed.length} of ${ids.length}): ${displayed.join(", ") || "none"}. Narrow with an immutable id or a more specific selector.`
}

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
