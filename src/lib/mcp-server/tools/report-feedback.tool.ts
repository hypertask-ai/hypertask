import { NextRequest } from 'next/server'
import { aiFeedbackSchema, feedbackClient } from '@/lib/aiFeedback/input'
import { getFeedbackClient } from '@/lib/aiFeedback/clientInfo'
import { validateMcpAuth } from '@/lib/mcp/auth'
import { getMcpExecutionContext } from '@/lib/mcp/operationContext'
import { TOOL_METADATA } from '../config/tool-metadata'
import { TOOL_ANNOTATIONS } from '../config/tool-annotations'

const OPERATION_ORIGIN = 'http://mcp.internal'

export const reportFeedbackTool = {
  name: TOOL_METADATA.REPORT_FEEDBACK.name,
  description: TOOL_METADATA.REPORT_FEEDBACK.description,
  annotations: TOOL_ANNOTATIONS.hypertask_report_feedback,
  parameters: aiFeedbackSchema.omit({ surface: true, client: true }),
  execute: async (args: unknown, token: string, invocation?: { clientName?: string }) => {
    const auth = getMcpExecutionContext(token) ?? await validateMcpAuth(
      new NextRequest(`${OPERATION_ORIGIN}/mcp`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { deferManagementPermissionCheck: true },
    )
    if (!auth) throw new Error('Unauthorized. Invalid or missing authentication token.')

    const { fileAiFeedback } = await import('@/lib/aiFeedback/report')
    return JSON.stringify(await fileAiFeedback({
      ...aiFeedbackSchema.omit({ surface: true, client: true }).parse(args),
      surface: 'mcp',
      client: feedbackClient(invocation?.clientName) ?? await getFeedbackClient(token),
    }, auth.user.id, { origin: 'agent', agentName: auth.agentDisplayName }))
  },
}
