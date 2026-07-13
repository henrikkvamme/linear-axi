import { LinearDomainError } from "./errors"

export const WAYFINDER_TYPES = ["research", "prototype", "grilling", "task"] as const
export type WayfinderType = (typeof WAYFINDER_TYPES)[number]

export interface WayfinderLabelRef {
  readonly id: string
  readonly name: string
}
export interface FrontierCandidate {
  readonly id: string
  readonly identifier: string
  readonly title: string
  readonly createdAt: string
  readonly subIssueSortOrder: number | null
  readonly labelIds: ReadonlyArray<string>
}

export interface FrontierIssue {
  readonly id: string
  readonly identifier: string
  readonly title: string
  readonly type: WayfinderType
}

export const resolveWayfinderPrefix = (mapIdentifier: string, labels: ReadonlyArray<WayfinderLabelRef>): string => {
  const mapLabels = labels.filter((label) => isWayfinderMapLabel(label.name))
  if (mapLabels.length !== 1) {
    throw new LinearDomainError({
      message: `${mapIdentifier} must have exactly one Wayfinder map label; found ${mapLabels.length}`,
      help: "Apply exactly one `wayfinder:map` label and retry."
    })
  }

  return mapLabels[0]!.name.slice(0, -":map".length)
}

export const projectFrontier = (
  candidates: ReadonlyArray<FrontierCandidate>,
  typeLabels: ReadonlyMap<string, { readonly name: string; readonly type: WayfinderType }>
): ReadonlyArray<FrontierIssue> =>
  [...candidates]
    .sort(compareCandidates)
    .map((candidate) => {
      const matches = candidate.labelIds.flatMap((id) => {
        const match = typeLabels.get(id)
        return match ? [match] : []
      })

      if (matches.length !== 1) {
        const names = matches.length === 0 ? "none" : matches.map((label) => label.name).join(", ")
        throw new LinearDomainError({
          message: `${candidate.identifier} must have exactly one Wayfinder type label; found ${matches.length} (${names})`,
          help: "Apply exactly one map-scoped research, prototype, grilling, or task label and retry."
        })
      }

      return {
        id: candidate.id,
        identifier: candidate.identifier,
        title: candidate.title,
        type: matches[0]!.type
      }
    })

const isWayfinderMapLabel = (name: string): boolean =>
  name === "wayfinder:map" || /^WF-VERIFY-[A-Za-z0-9._-]+:map$/.test(name)

const compareCandidates = (left: FrontierCandidate, right: FrontierCandidate): number => {
  const leftOrder = left.subIssueSortOrder
  const rightOrder = right.subIssueSortOrder
  if (leftOrder === null && rightOrder !== null) {
    return 1
  }
  if (leftOrder !== null && rightOrder === null) {
    return -1
  }
  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder
  }

  const created = left.createdAt.localeCompare(right.createdAt)
  return created !== 0 ? created : left.id.localeCompare(right.id)
}
