import { LinearApiError } from "./errors"

export const officialMutationInspectionCommand = (
  tool: string,
  args: Readonly<Record<string, unknown>>
): string => {
  const id = shellQuote(String(args.id))
  if (tool === "save_issue") {
    if (nonEmptyString(args.id)) {
      const inclusions = [
        ...(ISSUE_RELATION_KEYS.some((key) => args[key] !== undefined) ? ["--relations"] : []),
        ...(ISSUE_RELEASE_KEYS.some((key) => args[key] !== undefined) ? ["--releases"] : [])
      ]
      return `linear-axi issues inspect --id ${id}${inclusions.length > 0 ? ` ${inclusions.join(" ")}` : ""} --full`
    }
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
  const inclusions = tool === "save_release_note" && args.releases !== undefined ? " --releases" : ""
  return `linear-axi ${noun} view --id ${id}${inclusions} --full`
}

export const indeterminateOfficialMutation = (
  tool: string,
  inspection: string
): LinearApiError => new LinearApiError({
  message: `${tool} was dispatched but its result could not be verified; mutation outcome is unknown`,
  help: `Run \`${inspection}\` to inspect the current state. Do not repeat the mutation until the outcome is known.`
})

const ISSUE_RELATION_KEYS = [
  "blocks", "blockedBy", "relatedTo", "removeBlocks", "removeBlockedBy", "removeRelatedTo", "duplicateOf"
] as const
const ISSUE_RELEASE_KEYS = ["setReleases", "addReleases", "removeReleases"] as const

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0
