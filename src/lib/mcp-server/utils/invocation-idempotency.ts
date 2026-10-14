import crypto from 'crypto';

export interface McpInvocationIdentity {
  requestId: string;
  clientFingerprint: string;
  sessionId?: string;
}

export function idempotencyKeyForInvocation(
  operation: 'create_task' | 'update_task' | 'create_comment',
  invocation?: McpInvocationIdentity,
  requestPayload?: unknown
): string | undefined {
  if (!invocation || invocation.requestId.trim() === '') return undefined;

  const digest = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        operation,
        clientFingerprint: invocation.clientFingerprint,
        sessionId: invocation.sessionId ?? null,
        requestId: invocation.requestId,
        requestPayload,
      })
    )
    .digest('hex');
  return `mcp-invocation-${digest}`;
}
