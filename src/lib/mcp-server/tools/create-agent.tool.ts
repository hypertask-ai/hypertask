import { HTPR_7529_MCP_ACT_AS_AGENT_FLAG, isFeatureEnabled } from "@/lib/flags";
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
      const enabled = (flag: string) =>
        userId ? isFeatureEnabled(flag, userId).catch(() => false) : Promise.resolve(false);
      const useBearerRoute = await enabled(HTPR_7118_MCP_AGENT_CREATE_FLAG);
      if (!CreateAgentInputSchema.parse(input).ensure) return service.createAgent(input, { useBearerRoute });
      if (!(await enabled(HTPR_7529_MCP_ACT_AS_AGENT_FLAG))) {
        throw new Error("agents ensure is not switched on for this account yet; use agents list and create.");
      }
      return service.ensureAgent(input, { useBearerRoute });
    }, args),
};
