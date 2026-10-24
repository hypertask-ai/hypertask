import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7742_AGENT_CHAT_ALL_FLAG } from '@/lib/flags/definitions/htpr-7742-agent-chat-all'
import type { McpAuthContext } from '@/lib/mcp/auth/types'
import type { PortableTool } from '../stateless-http'
import { chatInboxTool } from './chat-inbox.tool'
import { chatReplyTool } from './chat-reply.tool'

export function isAgentChatTool(tool: PortableTool): boolean {
  return tool.name === chatInboxTool.name || tool.name === chatReplyTool.name
}

export async function agentChatTools(ctx: McpAuthContext): Promise<PortableTool[]> {
  return !ctx.management && await isFeatureEnabled(HTPR_7742_AGENT_CHAT_ALL_FLAG, ctx.user.id) ? [chatInboxTool, chatReplyTool] : []
}
