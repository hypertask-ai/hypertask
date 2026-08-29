import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { MintTokenInputSchema } from "../validations/management.validation";

export const mintTokenTool = {
  name: TOOL_METADATA.MINT_TOKEN.name,
  description: TOOL_METADATA.MINT_TOKEN.description,
  parameters: MintTokenInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, "mintToken", args),
};
