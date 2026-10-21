import { HTPR_7118_MCP_AGENT_CREATE_FLAG, HTPR_7529_MCP_ACT_AS_AGENT_FLAG, isFeatureEnabled } from "@/lib/flags";
import { getMcpExecutionContext } from "@/lib/mcp/operationContext";
import { TOOL_METADATA } from "../config/tool-metadata";
import { ManagementService } from "../lib/services/management.service";
import { executeWithService } from "../utils/executeWithService";
import { EnsureAgentInputSchema } from "../validations/management.validation";

export const ensureAgentTool = {
  name: TOOL_METADATA.ENSURE_AGENT.name,
  description: TOOL_METADATA.ENSURE_AGENT.description,
  parameters: EnsureAgentInputSchema,
  execute: (args: unknown, context: unknown) =>
    executeWithService(context, ManagementService, async (service, input) => {
      const userId =
        typeof context === "string" ? getMcpExecutionContext(context)?.user.id : undefined;
      const enabled = (flag: string) =>
        userId ? isFeatureEnabled(flag, userId).catch(() => false) : Promise.resolve(false);
      if (!(await enabled(HTPR_7529_MCP_ACT_AS_AGENT_FLAG))) {
        throw new Error("agents ensure is not switched on for this account yet; use agents list and create.");
      }
      return service.ensureAgent(input, { useBearerRoute: await enabled(HTPR_7118_MCP_AGENT_CREATE_FLAG) });
    }, args),
};
