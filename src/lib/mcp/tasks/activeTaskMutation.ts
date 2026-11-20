export const ACTIVE_TASK_MUTATION_STATUS = 'Normal' as const

interface ActiveTaskMutationInput {
  sectionId?: number
  assignee?: readonly number[]
  remove_agents?: readonly string[]
}

export function isActiveTaskMutationTarget(status: string): boolean {
  return status === ACTIVE_TASK_MUTATION_STATUS
}

export function hasActiveTaskOnlyMutation(input: ActiveTaskMutationInput): boolean {
  return input.sectionId !== undefined || input.assignee !== undefined || input.remove_agents !== undefined
}

export function assigneeLookupStatusFilter(
  intent: 'assign' | 'unassign',
): typeof ACTIVE_TASK_MUTATION_STATUS | undefined {
  return intent === 'unassign' ? undefined : ACTIVE_TASK_MUTATION_STATUS
}
