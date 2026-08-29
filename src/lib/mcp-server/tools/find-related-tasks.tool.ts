import { getFindRelatedTasksInputSchema } from '../validations/task.validation'
import { RelatedTasksService } from '../lib/services/related-tasks.service'
import { executeWithService } from '../utils/executeWithService'
import { TOOL_METADATA } from '../config/tool-metadata'

export const findRelatedTasksTool = {
  name: TOOL_METADATA.FIND_RELATED_TASKS.name,
  description: TOOL_METADATA.FIND_RELATED_TASKS.description,
  parameters: getFindRelatedTasksInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(
      context,
      RelatedTasksService,
      'findRelatedTasks',
      args
    )
  },
}
