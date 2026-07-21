import type { CommandSpec } from "./args"

export type OfficialCapabilityStatus =
  | "needs-decision"
  | "partial-needs-decision"
  | "official"
  | "native"
  | "native+official"

export interface OfficialToolCapability {
  readonly tool: string
  readonly status: OfficialCapabilityStatus
  readonly commands: ReadonlyArray<string>
}

const OFFICIAL_TOOL_STATUSES: ReadonlyArray<readonly [string, OfficialCapabilityStatus]> = [
  ["get_attachment", "needs-decision"],
  ["prepare_attachment_upload", "needs-decision"],
  ["create_attachment_from_upload", "needs-decision"],
  ["create_attachment", "needs-decision"],
  ["delete_attachment", "needs-decision"],
  ["list_agent_skills", "official"],
  ["get_agent_skill", "official"],
  ["list_comments", "native+official"],
  ["save_comment", "partial-needs-decision"],
  ["delete_comment", "needs-decision"],
  ["list_cycles", "official"],
  ["get_document", "official"],
  ["list_documents", "official"],
  ["save_document", "partial-needs-decision"],
  ["extract_images", "needs-decision"],
  ["get_issue", "native+official"],
  ["list_issues", "native+official"],
  ["save_issue", "native+official"],
  ["list_issue_statuses", "native"],
  ["get_issue_status", "native"],
  ["list_issue_labels", "native"],
  ["create_issue_label", "native"],
  ["list_projects", "official"],
  ["get_project", "official"],
  ["save_project", "partial-needs-decision"],
  ["list_project_labels", "official"],
  ["list_release_pipelines", "official"],
  ["list_releases", "official"],
  ["get_release", "official"],
  ["save_release", "partial-needs-decision"],
  ["list_release_notes", "official"],
  ["get_release_note", "official"],
  ["save_release_note", "partial-needs-decision"],
  ["get_diff", "official"],
  ["list_diffs", "official"],
  ["get_diff_threads", "official"],
  ["list_milestones", "official"],
  ["get_milestone", "official"],
  ["save_milestone", "partial-needs-decision"],
  ["list_teams", "native+official"],
  ["get_team", "official"],
  ["list_users", "official"],
  ["get_user", "official"],
  ["search_documentation", "official"],
  ["get_status_updates", "official"],
  ["save_status_update", "partial-needs-decision"],
  ["delete_status_update", "needs-decision"]
]

export const buildOfficialToolCapabilities = (
  specs: ReadonlyArray<CommandSpec>
): ReadonlyArray<OfficialToolCapability> => {
  const knownTools = new Set(OFFICIAL_TOOL_STATUSES.map(([tool]) => tool))
  const commandsByTool = new Map<string, Array<string>>()
  for (const spec of specs) {
    for (const tool of spec.officialTools ?? []) {
      if (!knownTools.has(tool)) throw new Error(`Command ${spec.path.join(" ")} declares unknown official tool ${tool}`)
      const commands = commandsByTool.get(tool) ?? []
      commands.push(spec.path.join(" "))
      commandsByTool.set(tool, commands)
    }
  }
  return OFFICIAL_TOOL_STATUSES.map(([tool, status]) => ({
    tool,
    status,
    commands: commandsByTool.get(tool) ?? []
  }))
}
