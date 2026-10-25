export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const CALLER_ERROR_CODES = new Set([-32001, -32003, -32004, -32602]);

export function isValidationError(error: unknown): boolean {
  const candidate = error as { name?: unknown; issues?: unknown };
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    candidate.name === 'ZodError' &&
    Array.isArray(candidate.issues)
  );
}

export function isCallerError(error: unknown): boolean {
  if (isValidationError(error)) return true;
  if (!error || typeof error !== 'object') return false;
  const { code, httpStatus } = error as { code?: unknown; httpStatus?: unknown };
  if (typeof httpStatus === 'number') return httpStatus >= 400 && httpStatus < 500;
  return typeof code === 'number' && CALLER_ERROR_CODES.has(code);
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  [key: string]: unknown;
}

const consoleWriters: Record<LogLevel, (line: string) => void> = {
  error: (line) => console.error(line),
  warn: (line) => console.warn(line),
  info: (line) => console.info(line),
  debug: (line) => console.debug(line),
};

class Logger {
  private logLevel: LogLevel = 'info';
  private levels: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };

    consoleWriters[level](JSON.stringify(entry));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  failure(message: string, error: unknown, meta?: Record<string, unknown>): void {
    this.log(isCallerError(error) ? 'warn' : 'error', message, {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  logToolInvocation(
    toolName: string,
    correlationId: string,
    inputs: Record<string, unknown>,
    success: boolean,
    error?: string
  ): void {
    this.info('Tool invocation', {
      correlationId,
      toolName,
      inputs: this.sanitizeInputs(inputs),
      success,
      ...(error && { error }),
    });
  }

  logAuthEvent(event: 'auth_success' | 'auth_failure' | 'authz_denied', correlationId?: string, details?: Record<string, unknown>): void {
    this.warn(`Auth event: ${event}`, {
      correlationId,
      ...details,
    });
  }

  private sanitizeInputs(inputs: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['jwtToken', 'token', 'password', 'secret', 'authorization', 'apiKey'];

    for (const [key, value] of Object.entries(inputs)) {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

export const logger = new Logger();
