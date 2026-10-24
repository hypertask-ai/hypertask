import { z } from 'zod'
import { TOOL_METADATA } from '../config/tool-metadata'
import type { PortableTool } from '../stateless-http'
import { AgentService } from '../lib/services/agent.service'
import { executeWithService } from '../utils/executeWithService'

export const chatInboxTool: PortableTool = {
  name: TOOL_METADATA.CHAT_INBOX.name,
  description: TOOL_METADATA.CHAT_INBOX.description,
  parameters: z.object({}).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  execute: async (_args, token) => executeWithService(token, AgentService, (service) => service.chatInbox(), undefined),
}
