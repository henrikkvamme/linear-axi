export const officialMutationInspectionCommand = (
  tool: string,
  args: Readonly<Record<string, unknown>>
): string => {
  const id = shellQuote(String(args.id))
  if (tool === "save_issue") {
    if (nonEmptyString(args.id)) return `linear-axi issues inspect --id ${id} --full`
    const selectors = [
      ...(nonEmptyString(args.team) ? [`--team ${shellQuote(args.team)}`] : []),
      ...(nonEmptyString(args.title) ? [`--query ${shellQuote(args.title)}`] : [])
    ]
    return `linear-axi issues search${selectors.length > 0 ? ` ${selectors.join(" ")}` : ""} --full`
  }
  if (tool === "save_project") return `linear-axi projects view --query ${id} --full`
  if (tool === "save_milestone") return `linear-axi milestones view --project ${shellQuote(String(args.project))} --query ${id} --full`
  if (tool === "save_status_update") return `linear-axi status-updates view --type ${shellQuote(String(args.type))} --id ${id} --full`
  const noun = tool === "save_document"
    ? "documents"
    : tool === "save_release_note"
      ? "release-notes"
      : "releases"
  return `linear-axi ${noun} view --id ${id} --full`
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0
