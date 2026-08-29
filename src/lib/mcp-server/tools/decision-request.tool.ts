import { TOOL_METADATA } from '../config/tool-metadata'
import { DecisionRequestService } from '../lib/services/decision-request.service'
import { normalizeTaskInput } from '../utils/normalize-task-input'
import { executeWithService } from '../utils/executeWithService'
import {
  getDecisionRequestCrudBaseSchema,
  validateAndSanitizeDecisionRequestCrudInput,
} from '../validations/decision-request.validation'

const DecisionRequestCrudBaseSchema = getDecisionRequestCrudBaseSchema()

export const decisionRequestTool = {
  name: TOOL_METADATA.DECISION_REQUEST.name,
  description: TOOL_METADATA.DECISION_REQUEST.description,
  parameters: DecisionRequestCrudBaseSchema,
  execute: async (args: unknown, context: any) => {
    const rawArgs = args as Record<string, any>
    const action = rawArgs?.action ?? 'create'
    const normalizedArgs =
      action === 'create' || action === 'list' ? normalizeTaskInput(rawArgs) : rawArgs
    const validatedInput = validateAndSanitizeDecisionRequestCrudInput(normalizedArgs)

    return executeWithService(
      context,
      DecisionRequestService,
      async (service) => {
        if (validatedInput.action === 'create') {
          const result = await service.createDecisionRequest({
            task_id: validatedInput.task_id,
            ticket_number: validatedInput.ticket_number,
            project_id: validatedInput.project_id,
            unique_index: validatedInput.unique_index,
            question: validatedInput.question,
            options: validatedInput.options,
          })
          return {
            success: true,
            decision_request: result.decision_request,
            comment_id: result.comment_id,
          }
        }

        if (validatedInput.action === 'list') {
          const result = await service.listDecisionRequests({
            task_id: validatedInput.task_id,
            ticket_number: validatedInput.ticket_number,
            project_id: validatedInput.project_id,
            unique_index: validatedInput.unique_index,
            status: validatedInput.status,
          })
          return { success: true, decision_requests: result.decision_requests }
        }

        if (validatedInput.action === 'get') {
          const result = await service.getDecisionRequest(validatedInput.decision_request_id!)
          return { success: true, decision_request: result.decision_request }
        }

        if (validatedInput.action === 'answer') {
          const result = await service.answerDecisionRequest(
            validatedInput.decision_request_id!,
            validatedInput.selected_option!,
            validatedInput.note
          )
          return { success: true, decision_request: result.decision_request }
        }

        if (validatedInput.action === 'cancel') {
          const result = await service.cancelDecisionRequest(
            validatedInput.decision_request_id!
          )
          return { success: true, decision_request: result.decision_request }
        }

        throw new Error(`Unknown action: ${(validatedInput as any).action}`)
      },
      validatedInput
    )
  },
}
