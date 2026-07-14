import { Buffer } from "node:buffer"
import { Schema } from "effect"
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

export interface FrontierPage {
  readonly items: ReadonlyArray<FrontierIssue>
  readonly pageInfo: {
    readonly hasNextPage: boolean
    readonly endCursor: string | null
  }
}

interface FrontierCursor {
  readonly v: 1
  readonly order: number | null
  readonly createdAt: string
  readonly id: string
}

const FrontierCursorSchema = Schema.Struct({
  v: Schema.Literal(1),
  order: Schema.Union([Schema.Number, Schema.Null]),
  createdAt: Schema.String,
  id: Schema.String
})
const decodeFrontierCursorValue = Schema.decodeUnknownSync(FrontierCursorSchema)

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
    .map((candidate) => projectCandidate(candidate, typeLabels))

export const paginateFrontier = (
  candidates: ReadonlyArray<FrontierCandidate>,
  typeLabels: ReadonlyMap<string, { readonly name: string; readonly type: WayfinderType }>,
  first: number,
  after?: string
): FrontierPage => {
  const cursor = after === undefined ? undefined : decodeFrontierCursor(after)
  const sorted = [...candidates].sort(compareCandidates)
  const projected = sorted.map((candidate) => projectCandidate(candidate, typeLabels))
  const start = cursor === undefined
    ? 0
    : sorted.findIndex((candidate) => compareCandidateToCursor(candidate, cursor) > 0)
  const startIndex = start === -1 ? sorted.length : start
  const endIndex = Math.min(startIndex + first, sorted.length)
  const items = projected.slice(startIndex, endIndex)
  const lastCandidate = endIndex > startIndex ? sorted[endIndex - 1] : undefined
  return {
    items,
    pageInfo: {
      hasNextPage: endIndex < sorted.length,
      endCursor: lastCandidate ? encodeFrontierCursor(lastCandidate) : null
    }
  }
}

export const encodeFrontierCursor = (candidate: Pick<FrontierCandidate, "id" | "createdAt" | "subIssueSortOrder">): string => {
  const value: FrontierCursor = {
    v: 1,
    order: candidate.subIssueSortOrder,
    createdAt: candidate.createdAt,
    id: candidate.id.toLowerCase()
  }
  return `wf1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`
}

export const validateFrontierCursor = (cursor: string): void => {
  decodeFrontierCursor(cursor)
}

const decodeFrontierCursor = (cursor: string): FrontierCursor => {
  try {
    if (!cursor.startsWith("wf1.")) {
      throw new Error("version")
    }
    const decoded = decodeFrontierCursorValue(
      JSON.parse(Buffer.from(cursor.slice("wf1.".length), "base64url").toString("utf8"))
    )
    const createdAtTime = Date.parse(decoded.createdAt)
    if (
      !Number.isFinite(decoded.order ?? 0) ||
      !Number.isFinite(createdAtTime) ||
      new Date(createdAtTime).toISOString() !== decoded.createdAt ||
      !isUuid(decoded.id)
    ) {
      throw new Error("shape")
    }
    if (encodeFrontierCursor({
      id: decoded.id,
      createdAt: decoded.createdAt,
      subIssueSortOrder: decoded.order
    }) !== cursor) {
      throw new Error("encoding")
    }
    return decoded
  } catch {
    throw new LinearDomainError({
      message: "invalid frontier cursor",
      help: "Use the exact pageInfo.endCursor returned by the previous wayfinder frontier command."
    })
  }
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)

const projectCandidate = (
  candidate: FrontierCandidate,
  typeLabels: ReadonlyMap<string, { readonly name: string; readonly type: WayfinderType }>
): FrontierIssue => {
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
}

const isWayfinderMapLabel = (name: string): boolean =>
  name === "wayfinder:map" || /^WF-VERIFY-[A-Za-z0-9._-]+:map$/.test(name)

const compareCandidates = (left: FrontierCandidate, right: FrontierCandidate): number =>
  compareSortKeys(left, right)

const compareCandidateToCursor = (candidate: FrontierCandidate, cursor: FrontierCursor): number =>
  compareSortKeys(candidate, {
    subIssueSortOrder: cursor.order,
    createdAt: cursor.createdAt,
    id: cursor.id
  })

const compareSortKeys = (
  left: Pick<FrontierCandidate, "subIssueSortOrder" | "createdAt" | "id">,
  right: Pick<FrontierCandidate, "subIssueSortOrder" | "createdAt" | "id">
): number => {
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

  const created = compareText(left.createdAt, right.createdAt)
  return created !== 0 ? created : compareText(left.id.toLowerCase(), right.id.toLowerCase())
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
