export interface ConnectionPageInfo {
  readonly hasNextPage: boolean
  readonly endCursor?: string | null
}
export interface ConnectionLike<Node> {
  readonly nodes: ReadonlyArray<Node>
  readonly pageInfo: ConnectionPageInfo
  fetchNext(): Promise<ConnectionLike<Node>>
}

const MAX_CONNECTION_PAGES = 1_000

export type LocalCursorKind = "label" | "relation"

export const decodeLocalCursorOffset = (cursor: string, kind: LocalCursorKind): number | undefined => {
  const encodedOffset = new RegExp(`^${kind}:([0-9]+)$`).exec(cursor)?.[1]
  if (encodedOffset === undefined) {
    return undefined
  }
  const offset = Number(encodedOffset)
  return Number.isSafeInteger(offset) && String(offset) === encodedOffset ? offset : undefined
}

export const fetchAllPages = async <Node>(initial: ConnectionLike<Node>): Promise<ReadonlyArray<Node>> => {
  let connection = initial
  let pages = 1
  let previousCursor: string | null | undefined

  while (connection.pageInfo.hasNextPage) {
    if (pages >= MAX_CONNECTION_PAGES) {
      throw new Error(`Linear pagination exceeded the ${MAX_CONNECTION_PAGES}-page safety limit`)
    }

    const cursor = connection.pageInfo.endCursor
    if (!cursor) {
      throw new Error("Linear pagination reported another page without an end cursor")
    }
    if (cursor === previousCursor) {
      throw new Error("Linear pagination cursor did not advance")
    }

    previousCursor = cursor
    connection = await connection.fetchNext()
    pages += 1
  }

  return connection.nodes
}
