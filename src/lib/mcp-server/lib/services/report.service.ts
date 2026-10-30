import type { IApiClient } from '../../types/index';
import { ReportCrudInputSchema } from '../../validations/report.validation';
import { generateCorrelationId } from '../../utils/correlation';
import { logger } from '../../utils/logger';

type ReportApiResponse = Record<string, unknown>;

export class ReportService {
  constructor(private readonly apiClient: IApiClient) {}

  async manageReport(params: unknown): Promise<ReportApiResponse> {
    const correlationId = generateCorrelationId();

    try {
      const validatedInput = ReportCrudInputSchema.parse(params);
      const { action, range, ...reportInput } = validatedInput;

      logger.debug('Managing report', {
        correlationId,
        action,
        projectId: validatedInput.project_id,
        slug: validatedInput.slug,
        bodyLength: validatedInput.body_html?.length,
      });

      if (action === 'status_update') {
        return await this.apiClient.makeRequest<ReportApiResponse>(
          '/mcp/reports/status-update',
          {
            method: 'POST',
            body: JSON.stringify({
              project_id: validatedInput.project_id,
              ...(range === undefined ? {} : { range }),
            }),
          },
          correlationId
        );
      }

      if (action === 'list' || action === 'get' || action === 'velocity') {
        const queryParams = new URLSearchParams({
          project_id: String(validatedInput.project_id),
        });
        if (validatedInput.slug !== undefined) {
          queryParams.set('slug', validatedInput.slug);
        }
        if (validatedInput.range !== undefined) {
          queryParams.set('range', validatedInput.range);
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
      logger.failure('Failed to manage report', error, {
        correlationId,
      });
      throw error;
    }
  }
}
