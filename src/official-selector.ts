import { Effect } from "effect"
import { LinearDomainError } from "./errors"

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
  const candidateIds = (matches.length > 0 ? matches : rows)
    .map((row) => nonEmptyString(row.id) ? row.id : "missing-id")
    .join(", ") || "none"
  if (matches.length === 0) {
    return Effect.fail(new LinearDomainError({
      message: `No ${noun} exactly matched ${selector}`,
      help: `Candidate ids: ${candidateIds}`
    }))
  }
  if (matches.length > 1) {
    return Effect.fail(new LinearDomainError({
      message: `Ambiguous ${noun} selector ${selector}`,
      help: `Candidate ids: ${candidateIds}`
    }))
  }
  const match = matches[0]!
  if (!nonEmptyString(match.id)) {
    return Effect.fail(new LinearDomainError({
      message: `${noun} selector ${selector} matched an entity without an immutable id`,
      help: `Candidate ids: ${candidateIds}`
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

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
