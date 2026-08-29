import type { IApiClient } from '../../types/index';
import { ReportCrudInputSchema } from '../../validations/report.validation';
import { generateCorrelationId } from '../../utils/correlation';
import { logger } from '../../utils/logger';

type ReportApiResponse = Record<string, unknown>;

/**
 * Service for creating, reading, updating, listing, and deleting reports.
 * Validates input and makes API requests.
 */
export class ReportService {
  constructor(private readonly apiClient: IApiClient) {}

  async manageReport(params: unknown): Promise<ReportApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ReportCrudInputSchema.parse(params);
      const { action, ...reportInput } = validatedInput;

      logger.debug('Managing report', {
        correlationId,
        action,
        projectId: validatedInput.project_id,
        slug: validatedInput.slug,
        bodyLength: validatedInput.body_html?.length,
      });

      if (action === 'list' || action === 'get') {
        const queryParams = new URLSearchParams({
          project_id: String(validatedInput.project_id),
        });
        if (validatedInput.slug !== undefined) {
          queryParams.set('slug', validatedInput.slug);
        }

        return await this.apiClient.makeRequest<ReportApiResponse>(
          `/mcp/reports/${action}?${queryParams.toString()}`,
          { method: 'GET' },
          correlationId
        );
      }

      return await this.apiClient.makeRequest<ReportApiResponse>(
        `/mcp/reports/${action}`,
        {
          method: 'POST',
          body: JSON.stringify(reportInput),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to manage report', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
