import type { IApiClient } from '../../types/index';
import { logger } from '../../utils/logger';
import { generateCorrelationId } from '../../utils/correlation';

export interface TimeTask {
  id: number;
  title: string;
  ticketId: string;
  uniqueIndex: number;
  projectId: number;
}

export interface TimeEntry {
  id: number;
  taskId: number;
  userId: number;
  userName?: string;
  task?: TimeTask;
  startedAt: string;
  endedAt: string | null;
  pausedAt: string | null;
  seconds: number;
}

export interface TimeSummary {
  enabled: boolean;
  runningEntry: TimeEntry | null;
  myTotalSeconds: number;
  taskTotalSeconds: number;
}

export interface RunningTimer {
  id: number;
  startedAt: string;
  pausedAt: string | null;
  elapsedSeconds: number;
  task: TimeTask;
}

export interface ReportEntry {
  id: number;
  taskId: number;
  userId: number;
  userName: string;
  task: TimeTask;
  startedAt: string;
  endedAt: string | null;
  pausedAt: string | null;
  seconds: number;
}

export interface TimeEntryResponse {
  success: boolean;
  entry: TimeEntry;
}

export interface TimeStatusResponse {
  success: boolean;
  summary: TimeSummary;
}

export interface RunningTimersResponse {
  success: boolean;
  timers: RunningTimer[];
}

export interface TimeReportResponse {
  success: boolean;
  entries: ReportEntry[];
}

export interface TimeReportInput {
  board?: string | number;
  task?: string;
  user?: string;
  from?: string;
  to?: string;
  running?: boolean;
}

/**
 * Service for time-tracking operations.
 */
export class TimeService {
  constructor(private readonly apiClient: IApiClient) {}

  async start(input: { task: string }): Promise<TimeEntryResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Starting time entry', { correlationId, task: input.task });

      return await this.apiClient.makeRequest<TimeEntryResponse>(
        '/mcp/time/start',
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to start time entry', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async stop(input: { task: string }): Promise<TimeEntryResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Stopping time entry', { correlationId, task: input.task });

      return await this.apiClient.makeRequest<TimeEntryResponse>(
        '/mcp/time/stop',
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to stop time entry', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async pause(input: { task: string }): Promise<TimeEntryResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Pausing time entry', { correlationId, task: input.task });

      return await this.apiClient.makeRequest<TimeEntryResponse>(
        '/mcp/time/pause',
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to pause time entry', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async resume(input: { task: string }): Promise<TimeEntryResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Resuming time entry', { correlationId, task: input.task });

      return await this.apiClient.makeRequest<TimeEntryResponse>(
        '/mcp/time/resume',
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to resume time entry', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async status(input: { task: string }): Promise<TimeStatusResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Getting time status', { correlationId, task: input.task });

      return await this.apiClient.makeRequest<TimeStatusResponse>(
        '/mcp/time/status',
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to get time status', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async log(input: { task: string; minutes: number }): Promise<TimeEntryResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Logging time entry', {
        correlationId,
        task: input.task,
        minutes: input.minutes,
      });

      return await this.apiClient.makeRequest<TimeEntryResponse>(
        '/mcp/time/log',
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to log time entry', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async running(): Promise<RunningTimersResponse> {
    const correlationId = generateCorrelationId();

    try {
      logger.debug('Listing running timers', { correlationId });

      return await this.apiClient.makeRequest<RunningTimersResponse>(
        '/mcp/time/running',
        { method: 'GET' },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to list running timers', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async report(input: TimeReportInput): Promise<TimeReportResponse> {
    const correlationId = generateCorrelationId();

    try {
      const queryParams = new URLSearchParams();
      if (input.board !== undefined) queryParams.append('board', String(input.board));
      if (input.task !== undefined) queryParams.append('task', input.task);
      if (input.user !== undefined) queryParams.append('user', input.user);
      if (input.from !== undefined) queryParams.append('from', input.from);
      if (input.to !== undefined) queryParams.append('to', input.to);
      if (input.running) queryParams.append('running', '1');

      const query = queryParams.toString();
      const reportPath = query ? `/mcp/time/report?${query}` : '/mcp/time/report';

      logger.debug('Getting time report', { correlationId, filters: input });

      return await this.apiClient.makeRequest<TimeReportResponse>(
        reportPath,
        { method: 'GET' },
        correlationId
      );
    } catch (error) {
      logger.error('Failed to get time report', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
