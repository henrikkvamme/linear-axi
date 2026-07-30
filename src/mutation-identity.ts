import { LinearDomainError } from "./errors"
import type { MutationIdentity, WorkspaceIdentity } from "./linear"

export const workspaceIdentityMatches = (
  actual: WorkspaceIdentity,
  expected: string
): boolean => {
  const normalized = expected.toLowerCase()
  return actual.id.toLowerCase() === normalized || actual.urlKey.toLowerCase() === normalized
}

export const workspaceMismatchError = (
  actual: WorkspaceIdentity,
  expected: string
): LinearDomainError => new LinearDomainError({
  message: "Authenticated Linear workspace does not match the mutation expectation",
  code: "workspace_mismatch",
  expected: { idOrUrlKey: expected },
  actual,
  help: "Re-run with the intended workspace credential; do not repeat the mutation."
})

export const mutationIdentityMismatch = (
  actual: MutationIdentity,
  expectedWorkspace: string,
  expectedTeam?: string
): LinearDomainError | undefined => {
  if (!workspaceIdentityMatches(actual.workspace, expectedWorkspace)) {
    return workspaceMismatchError(actual.workspace, expectedWorkspace)
  }
  if (!expectedTeam) return undefined
  if (!actual.team) {
    return new LinearDomainError({
      message: "Resolved Linear mutation target did not provide a verifiable team identity",
      code: "team_mismatch",
      expected: { idOrKey: expectedTeam },
      actual: null,
      help: "Resolve the intended target team and credential; do not repeat the mutation."
    })
  }
  const normalized = expectedTeam.toLowerCase()
  if (actual.team.id.toLowerCase() === normalized || actual.team.key.toLowerCase() === normalized) {
    return undefined
  }
  return new LinearDomainError({
    message: "Resolved Linear target team does not match the mutation expectation",
    code: "team_mismatch",
    expected: { idOrKey: expectedTeam },
    actual: actual.team,
    help: "Resolve the intended target team and credential; do not repeat the mutation."
  })
}
