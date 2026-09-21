/**
 * Custom error classes that map to JSON-RPC 2.0 error codes
 * Following MCP best practices for error handling
 */

export class McpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJsonRpcError(): { code: number; message: string; data?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.data && { data: this.data }),
    };
  }
}

/**
 * Authentication error - Invalid or missing API key
 * JSON-RPC code: -32001 (custom auth error)
 * HTTP equivalent: 401
 *
 * Includes OAuth re-authentication metadata to signal MCP clients
 * that they need to show the Connect button again.
 */
export class AuthenticationError extends McpError {
  /** Indicates the client should re-authenticate */
  public readonly requiresReauth: boolean = true;

  constructor(
    message: string = 'Authentication failed',
    correlationId?: string,
    options?: {
      /** Include OAuth metadata for re-auth flow */
      includeOAuthMetadata?: boolean;
      /** Custom resource metadata URL */
      resourceMetadataUrl?: string;
    }
  ) {
    const data: Record<string, unknown> = {
      // Signal to clients that re-authentication is required
      requiresReauth: true,
      // Error category for client-side handling
      errorCategory: 'authentication',
    };

    if (correlationId) {
      data.correlationId = correlationId;
    }

    // Include OAuth metadata if requested (default: true for backend 401s)
    if (options?.includeOAuthMetadata !== false) {
      const resourceUrl = process.env.MCP_RESOURCE_URL || 'https://mcp.hypertask.ai';
      data.oauth = {
        resourceMetadataUrl: options?.resourceMetadataUrl || `${resourceUrl}/.well-known/oauth-protected-resource`,
        hint: 'Token expired or invalid. Please reconnect to re-authenticate.',
      };
    }

    super(-32001, message, data);
  }
}

/**
 * Authorization error - User lacks permission
 * JSON-RPC code: -32003 (custom permission error)
 * HTTP equivalent: 403
 */
export class AuthorizationError extends McpError {
  constructor(message: string = 'Authorization failed', correlationId?: string) {
    super(
      -32003,
      message,
      correlationId ? { correlationId } : undefined
    );
  }
}

/**
 * Validation error - Invalid input
 * JSON-RPC code: -32602 (Invalid params - standard JSON-RPC)
 * HTTP equivalent: 400
 */
export class ValidationError extends McpError {
  constructor(
    message: string = 'Invalid parameters',
    public readonly details?: Record<string, unknown>,
    correlationId?: string
  ) {
    const data: Record<string, unknown> = {};
    if (correlationId) {
      data.correlationId = correlationId;
    }
    if (details) {
      data.details = details;
    }
    super(
      -32602,
      message,
      Object.keys(data).length > 0 ? data : undefined
    );
  }
}

/**
 * Not found error - Resource not found
 * JSON-RPC code: -32004 (custom not found error)
 * HTTP equivalent: 404
 */
export class NotFoundError extends McpError {
  constructor(message: string = 'Resource not found', correlationId?: string) {
    super(
      -32004,
      message,
      correlationId ? { correlationId } : undefined
    );
  }
}

/**
 * API error - Generic API error
 * JSON-RPC code: -32603 (Internal error - standard JSON-RPC)
 * HTTP equivalent: 500
 */
export class ApiError extends McpError {
  constructor(
    message: string = 'Internal server error',
    public readonly httpStatus?: number,
    public readonly httpResponse?: unknown,
    correlationId?: string
  ) {
    const data: Record<string, unknown> = {};
    if (correlationId) {
      data.correlationId = correlationId;
    }
    if (httpStatus) {
      data.httpStatus = httpStatus;
    }
    if (httpResponse) {
      // Only include response details for server-side logging, not exposed to client
      data._internal = { httpResponse };
    }
    super(
      -32603,
      message,
      Object.keys(data).length > 0 ? data : undefined
    );
  }
}

/**
 * Maps HTTP status codes to appropriate error types
 */
export function mapHttpErrorToMcpError(
  status: number,
  message: string,
  correlationId?: string,
  responseBody?: unknown
): McpError {
  switch (status) {
    case 401:
      // Include OAuth metadata to help clients know they need to re-authenticate
      return new AuthenticationError(
        message || 'Token expired or invalid. Please reconnect to re-authenticate.',
        correlationId,
        { includeOAuthMetadata: true }
      );
    case 403:
      return new AuthorizationError(message || 'Access denied', correlationId);
    case 404:
      return new NotFoundError(message || 'Resource not found', correlationId);
    case 400:
      return new ValidationError(message || 'Invalid request', undefined, correlationId);
    case 429:
      return new ApiError(message || 'Rate limit exceeded', status, responseBody, correlationId);
    default:
      return new ApiError(message || 'API request failed', status, responseBody, correlationId);
  }
}
