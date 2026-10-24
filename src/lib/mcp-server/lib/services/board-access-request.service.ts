import type { IApiClient } from "../../types/index";
import { generateCorrelationId } from "../../utils/correlation";

export class BoardAccessRequestService {
  constructor(private readonly apiClient: IApiClient) {}

  create(input: { project_id: number; reason: string }) {
    return this.apiClient.makeRequest("/mcp/agents/board-access-requests", { method: "POST", body: JSON.stringify(input) }, generateCorrelationId());
  }

  get(input: { request_id: string }) {
    return this.apiClient.makeRequest(`/mcp/agents/board-access-requests/${input.request_id}`, { method: "GET" }, generateCorrelationId());
  }
}
