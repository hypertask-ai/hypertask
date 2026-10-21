import { aiFeedbackSchema, feedbackClient } from '@/lib/aiFeedback/input'
import { getFeedbackClient } from '@/lib/aiFeedback/clientInfo'
import { createInProcessMcpClient } from '@/lib/mcp/inProcessClient'
import { TOOL_METADATA } from '../config/tool-metadata'
import { TOOL_ANNOTATIONS } from '../config/tool-annotations'

export const reportFeedbackTool = {
  name: TOOL_METADATA.REPORT_FEEDBACK.name,
  description: TOOL_METADATA.REPORT_FEEDBACK.description,
  annotations: TOOL_ANNOTATIONS.hypertask_report_feedback,
  parameters: aiFeedbackSchema.omit({ surface: true, client: true }),
  execute: async (args: unknown, token: string, invocation?: { clientName?: string }) => {
    const { auth } = await createInProcessMcpClient(token)
    const { fileAiFeedback } = await import('@/lib/aiFeedback/report')
    return JSON.stringify(await fileAiFeedback({
      ...aiFeedbackSchema.omit({ surface: true, client: true }).parse(args),
      surface: 'mcp',
      client: feedbackClient(invocation?.clientName) ?? await getFeedbackClient(token),
    }, auth.user.id, { agentName: auth.agentDisplayName }))
  },
}
