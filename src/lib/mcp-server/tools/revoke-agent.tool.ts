import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { RevokeAgentInputSchema } from "../validations/management.validation";

export const revokeAgentTool = {
  name: TOOL_METADATA.REVOKE_AGENT.name,
  description: TOOL_METADATA.REVOKE_AGENT.description,
  parameters: RevokeAgentInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, "revokeAgent", args),
};
