import { z } from 'zod';
import { isFeatureEnabled } from '@/lib/flags';
import { HTPR_7902_TEAM_ID_FLAG } from '@/lib/flags/definitions/htpr-7902-team-id';
import { TOOL_METADATA } from '../config/tool-metadata';
import { PresenceService } from '../lib/services/presence.service';
import { executeWithService } from '../utils/executeWithService';

const AgentPresenceParameters = z
  .object({
    team_id: z.string().min(1),
  })
  .strict();

const TEAM_ID_ERROR = 'team_id must be a positive integer number or UUID string';

const NumericTeamPresenceParameters = AgentPresenceParameters.extend({
  team_id: z.union([
    z.string().min(1, TEAM_ID_ERROR),
    z.number().int(TEAM_ID_ERROR).positive(TEAM_ID_ERROR),
  ], { error: TEAM_ID_ERROR }),
});

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

export async function getAgentPresenceTool(userId: number) {
  if (!await isFeatureEnabled(HTPR_7902_TEAM_ID_FLAG, userId)) return agentPresenceTool;

  return {
    ...agentPresenceTool,
    parameters: NumericTeamPresenceParameters,
    execute: async (args: unknown, context: any) => {
      const input = NumericTeamPresenceParameters.parse(args);
      return agentPresenceTool.execute({
        team_id: typeof input.team_id === 'number' ? String(input.team_id) : input.team_id,
      }, context);
    },
  };
}
