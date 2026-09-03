import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { DeleteAgentInputSchema } from "../validations/management.validation";

export const deleteAgentTool = {
  name: TOOL_METADATA.DELETE_AGENT.name,
  description: TOOL_METADATA.DELETE_AGENT.description,
  parameters: DeleteAgentInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, "deleteAgent", args),
};
