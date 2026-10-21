import type { IApiClient } from '../../types/index';
import { generateCorrelationId } from '../../utils/correlation';
import { logger } from '../../utils/logger';

export interface HelloResponse {
  success: boolean;
  user: {
    id: number;
    displayName: string | null;
    email: string;
  };
  boards: Array<{
    id: number;
    name: string;
    title: string;
    boardUrl: string;
    taskUrlTemplate: string;
  }>;
  urlFormats: {
    ticket: string;
    comment: string;
    board: string;
    boardView: string;
    inboxSplit: string;
    page: string;
    rules: string;
  };
  boardsTotal: number;
  boardsTruncated: boolean;
  capabilities: Record<string, string>;
  conventions: Array<{
    projectId: number;
    boardTitle: string;
    playbook: unknown;
    instructions: string | null;
  }>;
  conventionsTruncated: boolean;
  agent?: { id: string; displayName: string } | null;
  startBoard?: { id: number; title: string; boardUrl: string } | null;
  nextSteps?: Array<{
    step: string;
    command: string;
    tool: string;
    arguments: Record<string, unknown>;
  }>;
}

export class HelloService {
  constructor(private readonly apiClient: IApiClient) {}

  async getHello(): Promise<HelloResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Fetching hello context', { correlationId });

      const response = await this.apiClient.makeRequest<HelloResponse>(
        '/mcp/hello',
        {
          method: 'GET',
        },
        correlationId
      );

      logger.debug('Hello API response', {
        correlationId,
        response: JSON.stringify(response),
        hasUser: !!response?.user,
        boardCount: response?.boards?.length ?? 0,
      });

      if (!response || !response.user) {
        logger.error('Invalid hello response', {
          correlationId,
          response: JSON.stringify(response),
          responseType: typeof response,
        });
        throw new Error(
          `Invalid hello response: missing user data. Response: ${JSON.stringify(response)}`
        );
      }

      return response;
    } catch (error) {
      logger.failure('Failed to fetch hello context', error, {
        correlationId,
      });
      throw error;
    }
  }
}
