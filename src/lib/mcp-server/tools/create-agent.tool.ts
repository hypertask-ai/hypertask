import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { CreateAgentInputSchema } from "../validations/management.validation";

export const createAgentTool = {
  name: TOOL_METADATA.CREATE_AGENT.name,
  description: TOOL_METADATA.CREATE_AGENT.description,
  parameters: CreateAgentInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, "createAgent", args),
};
