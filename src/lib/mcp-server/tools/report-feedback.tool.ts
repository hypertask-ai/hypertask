import { NextRequest } from 'next/server'
import { z } from 'zod'
import { aiFeedbackSchema, feedbackClient } from '@/lib/aiFeedback/input'
import { withFeedbackToolSlug } from '@/lib/aiFeedback/repeatAccess'
import { getFeedbackClient } from '@/lib/aiFeedback/clientInfo'
import { validateMcpAuth } from '@/lib/mcp/auth'
import { getMcpExecutionContext } from '@/lib/mcp/operationContext'
import { TOOL_METADATA } from '../config/tool-metadata'
import { TOOL_ANNOTATIONS } from '../config/tool-annotations'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8275_AGENT_FEEDBACK_NOTE_FLAG } from '@/lib/flags/definitions/htpr-8275-agent-feedback-note'

const OPERATION_ORIGIN = 'http://mcp.internal'

function parseFeedbackArgs(args: unknown) {
  return aiFeedbackSchema.omit({ surface: true, client: true }).parse(args)
}

export async function feedbackInput(args: unknown, userId: number) {
  const input = parseFeedbackArgs(args)
  const noteEnabled = await isFeatureEnabled(HTPR_8275_AGENT_FEEDBACK_NOTE_FLAG, userId)
  if (noteEnabled) return input
  return { ...input, kind: undefined }
}

export const reportFeedbackTool = {
  name: TOOL_METADATA.REPORT_FEEDBACK.name,
  description: TOOL_METADATA.REPORT_FEEDBACK.description,
  annotations: TOOL_ANNOTATIONS.hypertask_report_feedback,
  parameters: aiFeedbackSchema.omit({ surface: true, client: true }).extend({
    tool: z.string().max(80).optional(),
  }),
  execute: async (args: unknown, token: string, invocation?: { clientName?: string }) => {
    const auth = getMcpExecutionContext(token) ?? await validateMcpAuth(
      new NextRequest(`${OPERATION_ORIGIN}/mcp`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { deferManagementPermissionCheck: true },
    )
    if (!auth) throw new Error('Unauthorized. Invalid or missing authentication token.')

    const { fileAiFeedback } = await import('@/lib/aiFeedback/report')
    const prepared = await withFeedbackToolSlug(args, auth.user.id)
    const input = await feedbackInput(prepared, auth.user.id).catch(() => parseFeedbackArgs(prepared))
    return JSON.stringify(await fileAiFeedback({
      ...input,
      surface: 'mcp',
      client: feedbackClient(invocation?.clientName) ?? await getFeedbackClient(token),
    }, auth.user.id, { origin: 'agent', agentName: auth.agentDisplayName }))
  },
}
