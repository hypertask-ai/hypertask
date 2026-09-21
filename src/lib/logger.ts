export type LogLevel = "error" | "warn" | "info" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: unknown[];
  correlationId?: string;
  [key: string]: unknown;
}

const sensitiveKey = /jwt|token|password|secret|authorization|api.?key/i;

function jsonReplacer() {
  const seen = new WeakSet<object>();
  return (key: string, value: unknown) => {
    if (sensitiveKey.test(key)) return "[REDACTED]";
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}

function messageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message, jsonReplacer());
  } catch {
    return String(message);
  }
}

export class Logger {
  private logLevel: LogLevel = "info";
  private readonly timers = new Map<string, number>();
  private readonly levels: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private log(level: LogLevel, message: unknown, details: unknown[]): void {
    if (this.levels[level] > this.levels[this.logLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: messageText(message),
      ...(details.length > 0 ? { details } : {}),
    };
    console.error(JSON.stringify(entry, jsonReplacer()));
  }

  error(message: unknown, ...details: unknown[]): void {
    this.log("error", message, details);
  }

  warn(message: unknown, ...details: unknown[]): void {
    this.log("warn", message, details);
  }

  info(message: unknown, ...details: unknown[]): void {
    this.log("info", message, details);
  }

  debug(message: unknown, ...details: unknown[]): void {
    this.log("debug", message, details);
  }

  time(label = "default"): void {
    this.timers.set(label, Date.now());
  }

  timeEnd(label = "default"): void {
    const startedAt = this.timers.get(label);
    this.timers.delete(label);
    this.info(label, startedAt === undefined ? undefined : `${Date.now() - startedAt}ms`);
  }

  logToolInvocation(
    toolName: string,
    correlationId: string,
    inputs: Record<string, unknown>,
    success: boolean,
    error?: string,
  ): void {
    this.info("Tool invocation", {
      correlationId,
      toolName,
      inputs,
      success,
      ...(error ? { error } : {}),
    });
  }

  logAuthEvent(
    event: "auth_success" | "auth_failure" | "authz_denied",
    correlationId?: string,
    details?: Record<string, unknown>,
  ): void {
    this.warn(`Auth event: ${event}`, { correlationId, ...details });
  }
}

export const logger = new Logger();
