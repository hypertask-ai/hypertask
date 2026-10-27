import type { IApiClient } from "../../types/index";
import {
  AgentWebhookExecutionSchema,
  type AgentWebhookInput,
} from "../../validations/webhook.validation";
import { generateCorrelationId } from "../../utils/correlation";

export class WebhookService {
  constructor(private readonly apiClient: IApiClient) {}

  async manageAgentWebhook(params: unknown) {
    const input = AgentWebhookExecutionSchema.parse(params) as AgentWebhookInput;
    const agentId = encodeURIComponent(input.agent_id);
    const correlationId = generateCorrelationId();

    if (input.action === "get") {
      return this.apiClient.makeRequest(
        `/mcp/webhooks?agent_id=${agentId}`,
        { method: "GET" },
        correlationId,
      );
    }

    if (input.action === "delete") {
      return this.apiClient.makeRequest(
        `/mcp/webhooks?agent_id=${agentId}`,
        { method: "DELETE" },
        correlationId,
      );
    }

    return this.apiClient.makeRequest(
      "/mcp/webhooks",
      {
        method: "POST",
        body: JSON.stringify({
          action: input.action,
          agent_id: input.agent_id,
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.project_id !== undefined
            ? { project_id: input.project_id }
            : {}),
          ...(input.events !== undefined ? { events: input.events } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.delivery_id !== undefined
            ? { delivery_id: input.delivery_id }
            : {}),
        }),
      },
      correlationId,
    );
  }
}
