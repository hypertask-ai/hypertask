export const ACTIVE_TASK_MUTATION_STATUS = 'Normal' as const

interface ActiveTaskMutationInput {
  sectionId?: number
  assignee?: readonly number[]
}

export function isActiveTaskMutationTarget(status: string): boolean {
  return status === ACTIVE_TASK_MUTATION_STATUS
}

export function hasActiveTaskOnlyMutation(input: ActiveTaskMutationInput): boolean {
  return input.sectionId !== undefined || input.assignee !== undefined
}

/** Unassign may reach Archive/Deleted; assign stays Normal-only (HTPR-6428). */
export function assigneeLookupStatusFilter(
  intent: 'assign' | 'unassign',
): typeof ACTIVE_TASK_MUTATION_STATUS | undefined {
  return intent === 'unassign' ? undefined : ACTIVE_TASK_MUTATION_STATUS
}
