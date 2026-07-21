import { Predicate } from "effect"

export interface OfficialEntityIdentity {
  readonly id: string
  readonly aliases: ReadonlyArray<string>
}

const REFERENCE_KEYS = ["id", "identifier", "key", "name", "slugId"] as const

export const officialEntityIdentity = (
  entity: Readonly<Record<string, unknown>>,
  aliasKeys: ReadonlyArray<string>
): OfficialEntityIdentity | undefined => {
  if (!isNonEmptyString(entity.id)) return undefined
  return {
    id: entity.id,
    aliases: [...new Set([entity.id, ...aliasKeys.flatMap((key) => isNonEmptyString(entity[key]) ? [entity[key]] : [])])]
  }
}

export const officialSelectorIsImmutableId = (selector: string): boolean =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(selector)

export const officialEntityMatchesSelector = (
  entity: Readonly<Record<string, unknown>>,
  selector: string,
  aliasKeys: ReadonlyArray<string> = ["id", "identifier"]
): boolean => {
  if (officialSelectorIsImmutableId(selector)) {
    return isNonEmptyString(entity.id) && textEqual(entity.id, selector)
  }
  return aliasKeys.some((key) => {
    const value = entity[key]
    return (isNonEmptyString(value) || typeof value === "number") && textEqual(String(value), selector)
  })
}

export const officialReferenceValues = (reference: unknown): ReadonlyArray<string> => {
  if (isNonEmptyString(reference)) return [reference]
  if (Array.isArray(reference)) return reference.flatMap(officialReferenceValues)
  if (!Predicate.isObject(reference)) return []
  return REFERENCE_KEYS.flatMap((key) => isNonEmptyString(reference[key]) ? [reference[key]] : [])
}

export const officialReferenceMatchesIdentity = (
  reference: unknown,
  identity: OfficialEntityIdentity
): boolean => {
  if (Array.isArray(reference)) {
    return reference.length > 0 && reference.every((value) => officialReferenceMatchesIdentity(value, identity))
  }
  if (isNonEmptyString(reference) && officialSelectorIsImmutableId(reference)) {
    return textEqual(reference, identity.id)
  }
  if (Predicate.isObject(reference) && isNonEmptyString(reference.id)) {
    return textEqual(reference.id, identity.id)
  }
  const aliases = new Set(identity.aliases.map((alias) => alias.toLowerCase()))
  const values = officialReferenceValues(reference)
  return values.length > 0 && values.every((value) =>
    officialSelectorIsImmutableId(value)
      ? textEqual(value, identity.id)
      : aliases.has(value.toLowerCase()))
}

export const officialOwnerReference = (
  entity: Readonly<Record<string, unknown>>,
  owner: "pipeline" | "project" | "team"
): unknown => {
  const idKey = `${owner}Id`
  const hasId = Object.prototype.hasOwnProperty.call(entity, idKey)
  const hasNested = Object.prototype.hasOwnProperty.call(entity, owner)
  if (!hasId) return hasNested ? entity[owner] : undefined
  if (!hasNested) return entity[idKey]
  const flattened = entity[idKey]
  const nested = entity[owner]
  return flattened === null && nested === null ? null : [flattened, nested]
}

export const officialReferenceSelector = (reference: unknown): string | undefined =>
  officialReferenceValues(reference)[0]

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
const textEqual = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase()
