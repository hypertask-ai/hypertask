import type { IApiClient } from "../../types/index";
import {
  CreateAgentInputSchema,
  ListConnectionsInputSchema,
  MintTokenInputSchema,
  RevokeAgentInputSchema,
  RevokeTokenInputSchema,
} from "../../validations/management.validation";
import { generateCorrelationId } from "../../utils/correlation";

export class ManagementService {
  constructor(private readonly apiClient: IApiClient) {}

  async createAgent(params: unknown) {
    const input = CreateAgentInputSchema.parse(params);
    return this.apiClient.makeRequest(
      "/mcp/admin/agents",
      { method: "POST", body: JSON.stringify(input) },
      generateCorrelationId(),
    );
  }

  async revokeAgent(params: unknown) {
    const input = RevokeAgentInputSchema.parse(params);
    return this.apiClient.makeRequest(
      "/mcp/admin/agents",
      { method: "DELETE", body: JSON.stringify(input) },
      generateCorrelationId(),
    );
  }

  async mintToken(params: unknown) {
    const input = MintTokenInputSchema.parse(params);
    return this.apiClient.makeRequest(
      "/mcp/admin/tokens",
      { method: "POST", body: JSON.stringify(input) },
      generateCorrelationId(),
    );
  }

  async revokeToken(params: unknown) {
    const input = RevokeTokenInputSchema.parse(params);
    return this.apiClient.makeRequest(
      "/mcp/admin/tokens",
      { method: "DELETE", body: JSON.stringify(input) },
      generateCorrelationId(),
    );
  }

  async listConnections(params: unknown) {
    ListConnectionsInputSchema.parse(params);
    return this.apiClient.makeRequest(
      "/mcp/admin/connections",
      { method: "GET" },
      generateCorrelationId(),
    );
  }
}
