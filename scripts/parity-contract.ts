export const PARITY_STATUSES = [
  "needs-decision",
  "partial-needs-decision",
  "official",
  "native",
  "native+official"
] as const

export interface ParityEntry {
  readonly tool: string
  readonly status: string
  readonly commands: ReadonlyArray<string>
  readonly rationale?: string
}

const parityStatuses = new Set<string>(PARITY_STATUSES)

export const parityEntryError = (entry: ParityEntry): string | undefined => {
  if (!parityStatuses.has(entry.status)) return `${entry.tool} has unknown status ${entry.status}`
  if (entry.status === "needs-decision") {
    if (!entry.rationale) return `${entry.tool} needs a rationale`
    if (entry.commands.length > 0) return `${entry.tool} is needs-decision but maps commands`
    return undefined
  }
  if (entry.status === "partial-needs-decision" && !entry.rationale) return `${entry.tool} needs a rationale`
  if (entry.commands.length === 0) return `${entry.tool} has no command mapping`
  return undefined
}
