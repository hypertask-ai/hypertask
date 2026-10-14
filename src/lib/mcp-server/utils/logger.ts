
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  [key: string]: unknown;
}

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

    const logLine = JSON.stringify(entry);
    console.error(logLine);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
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
