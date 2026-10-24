import { z } from 'zod'
import { TOOL_METADATA } from '../config/tool-metadata'
import type { PortableTool } from '../stateless-http'
import { AgentService } from '../lib/services/agent.service'
import { executeWithService } from '../utils/executeWithService'

const replyParameters = z.object({
  session_id: z.string().min(1).describe('The sessionId returned by the chat inbox.'),
  reply_to_message_id: z.string().min(1).describe('The human message id returned by the chat inbox.'),
  text: z.string().trim().min(1).max(8000).describe('Your reply to the person in this chat.'),
}).strict()

export const chatReplyTool: PortableTool = {
  name: TOOL_METADATA.CHAT_REPLY.name,
  description: TOOL_METADATA.CHAT_REPLY.description,
  parameters: replyParameters,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  execute: async (args, token) => executeWithService(token, AgentService, (service, input) => service.chatReply(input), replyParameters.parse(args)),
}
