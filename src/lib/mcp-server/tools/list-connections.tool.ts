import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { ListConnectionsInputSchema } from "../validations/management.validation";

export const listConnectionsTool = {
  name: TOOL_METADATA.LIST_CONNECTIONS.name,
  description: TOOL_METADATA.LIST_CONNECTIONS.description,
  parameters: ListConnectionsInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, "listConnections", args),
};
