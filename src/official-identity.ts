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

export const officialReferenceValues = (reference: unknown): ReadonlyArray<string> => {
  if (isNonEmptyString(reference)) return [reference]
  if (!Predicate.isObject(reference)) return []
  return REFERENCE_KEYS.flatMap((key) => isNonEmptyString(reference[key]) ? [reference[key]] : [])
}

export const officialReferenceMatchesIdentity = (
  reference: unknown,
  identity: OfficialEntityIdentity
): boolean => {
  if (Predicate.isObject(reference) && isNonEmptyString(reference.id)) {
    return textEqual(reference.id, identity.id)
  }
  const aliases = new Set(identity.aliases.map((alias) => alias.toLowerCase()))
  const values = officialReferenceValues(reference)
  return values.length > 0 && values.every((value) => aliases.has(value.toLowerCase()))
}

export const officialOwnerReference = (
  entity: Readonly<Record<string, unknown>>,
  owner: "project" | "team"
): unknown => {
  const idKey = `${owner}Id`
  return idKey in entity ? entity[idKey] : entity[owner]
}

export const officialReferenceSelector = (reference: unknown): string | undefined =>
  officialReferenceValues(reference)[0]

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
const textEqual = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase()
