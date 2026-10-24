import { z } from 'zod'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7742_AGENT_CHAT_ALL_FLAG } from '@/lib/flags/definitions/htpr-7742-agent-chat-all'
import type { McpAuthContext } from '@/lib/mcp/auth/types'
import type { PortableTool } from '../stateless-http'
import { AgentService } from '../lib/services/agent.service'
import { executeWithService } from '../utils/executeWithService'

const inbox: PortableTool = {
  name: 'hypertask_chat_inbox',
  description: 'Lists up to 50 oldest unanswered chat messages for the authenticated agent, including previously delivered messages. Requires that agent’s token. Returns id, sessionId, text and userName; does not claim messages. Refreshes your online heartbeat at most every 30 seconds. Call again after replying for the next batch.',
  parameters: z.object({}).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  execute: async (_args, token) => executeWithService(token, AgentService, (service) => service.chatInbox(), undefined),
}

const replyParameters = z.object({
  session_id: z.string().min(1).describe('The sessionId returned by the chat inbox.'),
  reply_to_message_id: z.string().min(1).describe('The human message id returned by the chat inbox.'),
  text: z.string().trim().min(1).max(8000).describe('Your reply to the person in this chat.'),
}).strict()

const reply: PortableTool = {
  name: 'hypertask_chat_reply',
  description: 'Replies to a human message in the same agent chat session. Use sessionId and id from hypertask_chat_inbox as session_id and reply_to_message_id. Requires that agent’s token; retries return the existing reply.',
  parameters: replyParameters,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  execute: async (args, token) => executeWithService(token, AgentService, (service, input) => service.chatReply(input), replyParameters.parse(args)),
}

export async function agentChatTools(ctx: McpAuthContext): Promise<PortableTool[]> {
  return !ctx.management && await isFeatureEnabled(HTPR_7742_AGENT_CHAT_ALL_FLAG, ctx.user.id) ? [inbox, reply] : []
}

