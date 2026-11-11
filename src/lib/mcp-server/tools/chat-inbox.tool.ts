import { z } from 'zod'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7742_AGENT_CHAT_ALL_FLAG } from '@/lib/flags/definitions/htpr-7742-agent-chat-all'
import type { McpAuthContext } from '@/lib/mcp/auth/types'
import { TOOL_METADATA } from '../config/tool-metadata'
import { AgentService } from '../lib/services/agent.service'
import type { PortableTool } from '../stateless-http'
import { executeWithService } from '../utils/executeWithService'
import { chatReplyTool } from './chat-reply.tool'

export const chatInboxTool: PortableTool = {
  name: TOOL_METADATA.CHAT_INBOX.name,
  description: TOOL_METADATA.CHAT_INBOX.description,
  parameters: z.object({}).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  execute: async (_args, token) => executeWithService(token, AgentService, (service) => service.chatInbox(), undefined),
}

const chatToolNames = new Set([chatInboxTool.name, chatReplyTool.name])

export async function appendAgentChatTools(
  tools: readonly PortableTool[],
  ctx: McpAuthContext | undefined,
): Promise<PortableTool[]> {
  if (!ctx || ctx.management) return [...tools]
  const enabled = await isFeatureEnabled(HTPR_7742_AGENT_CHAT_ALL_FLAG, ctx.user.id).catch(() => false)
  if (!enabled) return [...tools]
  return [...tools.filter((tool) => !chatToolNames.has(tool.name)), chatInboxTool, chatReplyTool]
}
