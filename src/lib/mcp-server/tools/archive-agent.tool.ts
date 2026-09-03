import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { ArchiveAgentInputSchema } from "../validations/management.validation";

export const archiveAgentTool = {
  name: TOOL_METADATA.ARCHIVE_AGENT.name,
  description: TOOL_METADATA.ARCHIVE_AGENT.description,
  parameters: ArchiveAgentInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, "archiveAgent", args),
};
