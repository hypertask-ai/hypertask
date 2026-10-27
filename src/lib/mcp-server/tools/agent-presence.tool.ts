import { z } from 'zod';
import { TOOL_METADATA } from '../config/tool-metadata';
import { PresenceService } from '../lib/services/presence.service';
import { executeWithService } from '../utils/executeWithService';

const AgentPresenceParameters = z
  .object({
    team_id: z.string().min(1),
  })
  .strict();

export const agentPresenceTool = {
  name: TOOL_METADATA.AGENT_PRESENCE.name,
  description: TOOL_METADATA.AGENT_PRESENCE.description,
  parameters: AgentPresenceParameters,
  execute: async (args: unknown, context: any) => {
    const input = AgentPresenceParameters.parse(args);
    return executeWithService(
      context,
      PresenceService,
      (service, serviceArgs) => service.getPresence(serviceArgs),
      input
    );
  },
};
