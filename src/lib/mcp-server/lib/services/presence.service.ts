import type { IApiClient } from '../../types/index';
import { generateCorrelationId } from '../../utils/correlation';
import { logger } from '../../utils/logger';

export interface PresenceResponse {
  success: boolean;
  agents: Array<{
    agent: {
      id: string;
      displayName: string | null;
      photoURL: string | null;
    };
    status: 'active' | 'idle' | 'offline';
    lastSeenAt: string;
    currentTask?: {
      ticketNumber: string;
      title: string;
      url: string;
    };
  }>;
}

export class PresenceService {
  constructor(private readonly apiClient: IApiClient) {}

  async getPresence(input: { team_id: string }): Promise<PresenceResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Fetching team agent presence', {
        correlationId,
        teamId: input.team_id,
      });

      const response = await this.apiClient.makeRequest<PresenceResponse>(
        `/mcp/agents/presence?team_id=${encodeURIComponent(input.team_id)}`,
        { method: 'GET' },
        correlationId
      );

      logger.debug('Team agent presence API response', {
        correlationId,
        agentCount: response?.agents?.length ?? 0,
      });

      return response;
    } catch (error) {
      logger.error('Failed to fetch team agent presence', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
