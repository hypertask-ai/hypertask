import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8777_ACTIVITY_BOARD_NUMBER_FLAG } from '@/lib/flags/definitions/htpr-8777-activity-board-number'
import { AgentRunInputError, type RuntimeAgentRunInput } from '@/lib/agentRuns/model'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'

type ActivityCaller = {
  userId: number
  agentId?: string | null
  teamScope?: AgentTokenTeamScope | null
}

export async function resolveRuntimeActivityTaskId(
  principal: ActivityCaller,
  input: RuntimeAgentRunInput,
): Promise<number | null> {
  if (input.projectId == null) return input.taskId
  let enabled = false
  try {
    enabled = await isFeatureEnabled(HTPR_8777_ACTIVITY_BOARD_NUMBER_FLAG, principal.userId)
  } catch {
    enabled = false
  }
  if (!enabled) return input.taskId
  const lookup = (options: {
    task_id?: number | null
    unique_index?: number | null
    project_id?: number | null
  }) => findTaskByIdentifier(
    { id: principal.userId },
    options,
    principal.agentId,
    undefined,
    principal.teamScope,
  )
  const byId = await lookup({ task_id: input.taskId, project_id: input.projectId })
  if (input.boardNumber != null) {
    if (byId) return byId.id
    const namedBoard = await lookup({ unique_index: input.boardNumber, project_id: input.projectId })
    return namedBoard?.id ?? null
  }
  const byBoardNumber = await lookup({ unique_index: input.taskId, project_id: input.projectId })
  if (byId && byBoardNumber && byBoardNumber.id !== byId.id) {
    throw new AgentRunInputError(
      'taskId matches a different task id and board number on this project; use ticket_number or unique_index',
    )
  }
  return (byId ?? byBoardNumber)?.id ?? null
}
