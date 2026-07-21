import { LinearDomainError } from "./errors"

interface GroupedLabelIdentity {
  readonly id: string
  readonly parentId: string | null | undefined
}

export const labelGroupSelectionError = (
  labels: ReadonlyArray<GroupedLabelIdentity>
): LinearDomainError | undefined => {
  const labelsById = new Map<string, GroupedLabelIdentity>()
  for (const label of labels) labelsById.set(label.id.toLowerCase(), label)

  const labelByGroup = new Map<string, GroupedLabelIdentity>()
  for (const label of labelsById.values()) {
    if (label.parentId === null || label.parentId === undefined) continue
    const groupId = label.parentId.toLowerCase()
    const existingLabel = labelByGroup.get(groupId)
    if (existingLabel && existingLabel.id.toLowerCase() !== label.id.toLowerCase()) {
      return new LinearDomainError({
        message: `Labels ${existingLabel.id} and ${label.id} belong to the same label group ${label.parentId}`,
        help: "Choose at most one label from each label group."
      })
    }
    labelByGroup.set(groupId, label)
  }
  return undefined
}
