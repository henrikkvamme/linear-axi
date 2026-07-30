import { LinearDomainError } from "./errors"
import type { WorkspaceIdentity } from "./linear"

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
