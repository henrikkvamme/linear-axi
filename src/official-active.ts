import { Effect } from "effect"
import { LinearDomainError } from "./errors"

export const requireOfficialEntityActive = (
  noun: string,
  selector: string,
  entity: Readonly<Record<string, unknown>>,
  context: string = `${noun} archived state`
): Effect.Effect<void, LinearDomainError> => {
  if (!hasValidOfficialArchivedState(entity)) return activeStateShapeError(context)
  return entity.archivedAt === null
    ? Effect.void
    : Effect.fail(new LinearDomainError({
        message: `${noun} ${selector} is archived`,
        help: `Choose an active ${noun}.`
      }))
}

export const filterOfficialActiveEntities = (
  noun: string,
  entities: ReadonlyArray<Record<string, unknown>>,
  context: string = `${noun} archived state`
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, LinearDomainError> => {
  if (entities.some((entity) => !hasValidOfficialArchivedState(entity))) return activeStateShapeError(context)
  return Effect.succeed(entities.filter((entity) => entity.archivedAt === null))
}

export const hasValidOfficialArchivedState = (
  entity: Readonly<Record<string, unknown>>
): boolean => Object.prototype.hasOwnProperty.call(entity, "archivedAt") &&
  (entity.archivedAt === null || nonEmptyString(entity.archivedAt))

const activeStateShapeError = (context: string): Effect.Effect<never, LinearDomainError> =>
  Effect.fail(new LinearDomainError({
    message: `Official Linear MCP output shape drifted for ${context}: expected explicit archivedAt`,
    help: "Refresh the frozen parity inventory and update linear-axi before retrying."
  }))

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
