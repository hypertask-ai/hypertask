import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { RevokeTokenInputSchema } from "../validations/management.validation";

export const revokeTokenTool = {
  name: TOOL_METADATA.REVOKE_TOKEN.name,
  description: TOOL_METADATA.REVOKE_TOKEN.description,
  parameters: RevokeTokenInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, "revokeToken", args),
};
