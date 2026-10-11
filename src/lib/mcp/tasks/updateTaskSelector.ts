import { isMcpV2Enabled } from '@/lib/mcp/mcpV2'
import { executeTaskUpdate as executeV1 } from './updateTask'
import { executeTaskUpdateV2 } from './updateTaskV2'
import type { ExecuteTaskUpdateOptions } from './fields/types'

export type { UpdateTaskResponse, UpdateTaskBody, TaskUpdateExecutionResult, TaskUpdateAssigneeHandler, TaskClearAssigneesHandler } from './fields/types'

export async function executeTaskUpdate(options: ExecuteTaskUpdateOptions) {
  const execute = await isMcpV2Enabled(options.ctx.user.id) ? executeTaskUpdateV2 : executeV1
  return execute(options)
}
