import { Predicate } from "effect"

export interface OfficialCollectionOptions {
  readonly referenceKeys: ReadonlyArray<string>
  readonly canonicalIdentityKey?: string
}

export const officialCollectionEqual = (
  current: unknown,
  desired: unknown,
  options: OfficialCollectionOptions
): boolean => officialCollectionMatches(current, desired, true, options)

export const officialCollectionContains = (
  current: unknown,
  desired: unknown,
  options: OfficialCollectionOptions
): boolean => officialCollectionMatches(current, desired, false, options)

export const officialCollectionAbsent = (
  current: unknown,
  desired: unknown,
  options: OfficialCollectionOptions
): boolean => {
  if (!Array.isArray(current) || !Array.isArray(desired)) return false
  const references = officialCollectionReferences(current, options, desired.length > 0)
  return references.every((values) => values.length > 0) &&
    desired.every((value) => !references.some((values) => values.some((reference) => officialReferenceTextEqual(reference, String(value)))))
}

export const officialReferenceEqual = (
  current: unknown,
  desired: unknown,
  options: OfficialCollectionOptions
): boolean => {
  if (!validReference(desired)) return current === desired
  if (Predicate.isObject(current)) {
    const canonicalIdentityKey = options.canonicalIdentityKey
    if (canonicalIdentityKey !== undefined) {
      const identity = current[canonicalIdentityKey]
      return validReference(identity) && officialReferenceTextEqual(String(identity), String(desired))
    }
    return officialObjectReferences(current, options.referenceKeys)
      .some((reference) => officialReferenceTextEqual(reference, String(desired)))
  }
  return validReference(current) && officialReferenceTextEqual(String(current), String(desired))
}

export const findCanonicalIntersection = (
  left: unknown,
  right: unknown
): string | undefined => {
  if (!Array.isArray(left) || !Array.isArray(right)) return undefined
  const rightValues = new Set(right.map((value) => String(value).toLowerCase()))
  return left.map(String).find((value) => rightValues.has(value.toLowerCase()))
}

const officialCollectionMatches = (
  current: unknown,
  desired: unknown,
  exact: boolean,
  options: OfficialCollectionOptions
): boolean => {
  if (!Array.isArray(current) || !Array.isArray(desired)) return false
  const entries = officialCollectionReferences(current, options, desired.length > 0).map((references) => ({
    key: references[0]?.toLowerCase(),
    references
  }))
  if (entries.some(({ key }) => key === undefined)) return false
  const currentKeys = new Set(entries.map(({ key }) => key as string))
  const desiredKeys = new Set<string>()
  for (const value of desired) {
    const matches = new Set(entries
      .filter(({ references }) => references.some((reference) => officialReferenceTextEqual(reference, String(value))))
      .map(({ key }) => key as string))
    if (matches.size !== 1) return false
    desiredKeys.add([...matches][0]!)
  }
  return !exact || desiredKeys.size === currentKeys.size
}

const officialCollectionReferences = (
  value: ReadonlyArray<unknown>,
  options: OfficialCollectionOptions,
  requireCanonicalIdentity: boolean
): ReadonlyArray<ReadonlyArray<string>> => value.map((item) => {
  if (requireCanonicalIdentity && options.canonicalIdentityKey !== undefined) {
    if (!Predicate.isObject(item)) return []
    const identity = item[options.canonicalIdentityKey]
    return validReference(identity) ? [String(identity)] : []
  }
  return Predicate.isObject(item)
    ? officialObjectReferences(item, options.referenceKeys)
    : validReference(item) ? [String(item)] : []
})

const officialObjectReferences = (
  value: Readonly<Record<PropertyKey, unknown>>,
  referenceKeys: ReadonlyArray<string>
): ReadonlyArray<string> => referenceKeys
  .map((key) => value[key])
  .filter((reference): reference is string | number => validReference(reference))
  .map(String)

const officialReferenceTextEqual = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase()
const validReference = (value: unknown): value is string | number => nonEmptyString(value) || typeof value === "number"
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
