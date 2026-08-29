import { TOOL_METADATA } from "../config/tool-metadata";
import { WebhookService } from "../lib/services/webhook.service";
import { executeWithService } from "../utils/executeWithService";
import {
  AgentWebhookInputSchema,
  getAgentWebhookInputSchema,
} from "../validations/webhook.validation";

export const agentWebhookTool = {
  name: TOOL_METADATA.AGENT_WEBHOOK.name,
  description: TOOL_METADATA.AGENT_WEBHOOK.description,
  parameters: getAgentWebhookInputSchema(),
  execute: async (args: unknown, context: unknown) => {
    const input = AgentWebhookInputSchema.parse(args);
    return executeWithService(
      context,
      WebhookService,
      "manageAgentWebhook",
      input,
    );
  },
};
