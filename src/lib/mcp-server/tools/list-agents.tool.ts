import { TOOL_METADATA } from '../config/tool-metadata'
import { AgentService } from '../lib/services/agent.service'
import { executeWithService } from '../utils/executeWithService'
import {
  getListAgentsInputSchema,
  ListAgentsInputSchema,
} from '../validations/agent.validation'

export const listAgentsTool = {
  name: TOOL_METADATA.LIST_AGENTS.name,
  description: TOOL_METADATA.LIST_AGENTS.description,
  parameters: getListAgentsInputSchema(),
  execute: async (args: unknown, context: any) => {
    const input = ListAgentsInputSchema.parse(args)
    return executeWithService(context, AgentService, 'listAgents', input)
  },
}
