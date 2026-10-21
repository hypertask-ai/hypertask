import type { IApiClient } from "../../types/index";
import {
  ArchiveAgentInputSchema,
  CreateAgentInputSchema,
  DeleteAgentInputSchema,
  EnsureAgentInputSchema,
  ListConnectionsInputSchema,
  MintTokenInputSchema,
  RevokeAgentInputSchema,
  RevokeTokenInputSchema,
} from "../../validations/management.validation";
import { generateCorrelationId } from "../../utils/correlation";
import type { ListAgentsResponse, OwnedAgentListItem } from "./agent.service";

type CreatedAgentResponse = {
  success: boolean;
  agent: { id: string; display_name: string; photo_url?: string | null };
  token?: string;
  message?: string;
};

const sameName = (left: string, right: string) =>
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

function pickEnsuredAgent(agents: OwnedAgentListItem[], displayName: string, projectIds: number[]) {
  const named = agents.filter((agent) => !agent.revoked && sameName(agent.display_name, displayName));
  const onEveryBoard = named.find((agent) =>
    projectIds.every((projectId) => agent.boards.some((board) => board.id === projectId)),
  );
  return onEveryBoard ?? named.at(-1);
}

export class ManagementService {
  constructor(private readonly apiClient: IApiClient) {}

  async createAgent(params: unknown, options: { useBearerRoute?: boolean } = {}) {
    const input = CreateAgentInputSchema.parse(params);
    return this.apiClient.makeRequest(
      options.useBearerRoute ? "/mcp/agents/create" : "/mcp/admin/agents",
      { method: "POST", body: JSON.stringify(input) },
      generateCorrelationId(),
    );
  }

  async ensureAgent(params: unknown, options: { useBearerRoute?: boolean } = {}) {
    const input = EnsureAgentInputSchema.parse(params);
    const listed = await this.apiClient.makeRequest<ListAgentsResponse>(
      "/mcp/agents",
      { method: "GET" },
      generateCorrelationId(),
    );
    const existing = pickEnsuredAgent(listed.agents ?? [], input.display_name, input.project_ids);
    if (!existing) {
      const created = await this.apiClient.makeRequest<CreatedAgentResponse>(
        options.useBearerRoute ? "/mcp/agents/create" : "/mcp/admin/agents",
        { method: "POST", body: JSON.stringify(input) },
        generateCorrelationId(),
      );
      return {
        success: true,
        created: true,
        agent: { id: created.agent.id, display_name: created.agent.display_name, project_ids: input.project_ids },
        next_step: "Pass this agent id as as_agent on comments, tasks, decisions and inbox; no token is needed.",
      };
    }
    const boardIds = existing.boards.map((board) => board.id);
    const missing = input.project_ids.filter((projectId) => !boardIds.includes(projectId));
    if (missing.length > 0) {
      await this.apiClient.makeRequest(
        `/mcp/agents/${encodeURIComponent(existing.id)}`,
        { method: "PATCH", body: JSON.stringify({ add_project_ids: missing }) },
        generateCorrelationId(),
      );
    }
    return {
      success: true,
      created: false,
      agent: { id: existing.id, display_name: existing.display_name, project_ids: [...boardIds, ...missing] },
      added_project_ids: missing,
      next_step: "Pass this agent id as as_agent on comments, tasks, decisions and inbox; no token is needed.",
    };
  }

  async revokeAgent(params: unknown) {
    const input = RevokeAgentInputSchema.parse(params);
    return this.apiClient.makeRequest(
      "/mcp/admin/agents",
      { method: "DELETE", body: JSON.stringify(input) },
      generateCorrelationId(),
    );
  }

  async archiveAgent(params: unknown) {
    const input = ArchiveAgentInputSchema.parse(params);
    return this.apiClient.makeRequest(
      `/mcp/agents/${encodeURIComponent(input.agent_id)}/archive`,
      { method: "POST" },
      generateCorrelationId(),
    );
  }

  async deleteAgent(params: unknown) {
    const input = DeleteAgentInputSchema.parse(params);
    return this.apiClient.makeRequest(
      `/mcp/agents/${encodeURIComponent(input.agent_id)}`,
      { method: "DELETE" },
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
