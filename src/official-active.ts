import { Effect, Predicate } from "effect"
import { LinearDomainError } from "./errors"
import type { LinearGateway } from "./linear"

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

export const requireOfficialUserActive = Effect.fn("requireOfficialUserActive")(function*(
  selector: string,
  entity: Readonly<Record<string, unknown>>,
  context: string = "get_user"
) {
  yield* requireOfficialEntityActive("user", selector, entity, context)
  if (!Object.prototype.hasOwnProperty.call(entity, "active") || typeof entity.active !== "boolean") {
    return yield* activeUserShapeError(context)
  }
  if (!entity.active) {
    return yield* Effect.fail(new LinearDomainError({
      message: `user ${selector} is inactive`,
      help: "Choose an active user."
    }))
  }
})

export const resolveOfficialViewerUser = Effect.fn("resolveOfficialViewerUser")(function*(
  gateway: LinearGateway
) {
  const status = yield* gateway.authStatus()
  if (!status.authenticated || !status.viewer || !nonEmptyString(status.viewer.id)) {
    return yield* viewerIdentityShapeError("authenticated viewer identity was unavailable")
  }
  const user = yield* gateway.callOfficialTool("get_user", { query: "me" })
  if (!Predicate.isObject(user) || !nonEmptyString(user.id)) {
    return yield* viewerIdentityShapeError("get_user me returned no immutable id")
  }
  if (user.id.toLowerCase() !== status.viewer.id.toLowerCase()) {
    return yield* viewerIdentityShapeError("get_user me did not match the authenticated viewer")
  }
  yield* requireOfficialUserActive("me", user)
  return user
})

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

const activeUserShapeError = (context: string): Effect.Effect<never, LinearDomainError> =>
  Effect.fail(new LinearDomainError({
    message: `Official Linear MCP output shape drifted for ${context}: expected explicit active user metadata`,
    help: "Refresh the frozen parity inventory and update linear-axi before retrying."
  }))

const viewerIdentityShapeError = (detail: string): Effect.Effect<never, LinearDomainError> =>
  Effect.fail(new LinearDomainError({
    message: `Official Linear viewer identity could not be proven: ${detail}`,
    help: "Run `linear-axi auth status`, then retry only after the authenticated viewer is confirmed."
  }))

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
