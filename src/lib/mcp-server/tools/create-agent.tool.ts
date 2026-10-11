import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7118_MCP_AGENT_CREATE_FLAG } from "@/lib/flags/keys";
import { getMcpExecutionContext } from "@/lib/mcp/operationContext";
import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { CreateAgentInputSchema } from "../validations/management.validation";

export const createAgentTool = {
  name: TOOL_METADATA.CREATE_AGENT.name,
  description: TOOL_METADATA.CREATE_AGENT.description,
  parameters: CreateAgentInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, async (service, input) => {
      const userId =
        typeof context === "string" ? getMcpExecutionContext(context)?.user.id : undefined;
      const useBearerRoute = userId
        ? await isFeatureEnabled(HTPR_7118_MCP_AGENT_CREATE_FLAG, userId).catch(() => false)
        : false;
      return service.createAgent(input, { useBearerRoute });
    }, args),
};
