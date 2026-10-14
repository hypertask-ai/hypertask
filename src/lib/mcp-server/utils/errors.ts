
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

export class AuthenticationError extends McpError {
  public readonly requiresReauth: boolean = true;

  constructor(
    message: string = 'Authentication failed',
    correlationId?: string,
    options?: {
      includeOAuthMetadata?: boolean;
      resourceMetadataUrl?: string;
    }
  ) {
    const data: Record<string, unknown> = {
      requiresReauth: true,
      errorCategory: 'authentication',
    };

    if (correlationId) {
      data.correlationId = correlationId;
    }

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

export class AuthorizationError extends McpError {
  constructor(message: string = 'Authorization failed', correlationId?: string) {
    super(
      -32003,
      message,
      correlationId ? { correlationId } : undefined
    );
  }
}

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

export class NotFoundError extends McpError {
  constructor(message: string = 'Resource not found', correlationId?: string) {
    super(
      -32004,
      message,
      correlationId ? { correlationId } : undefined
    );
  }
}

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
      data._internal = { httpResponse };
    }
    super(
      -32603,
      message,
      Object.keys(data).length > 0 ? data : undefined
    );
  }
}

export function mapHttpErrorToMcpError(
  status: number,
  message: string,
  correlationId?: string,
  responseBody?: unknown
): McpError {
  switch (status) {
    case 401:
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
