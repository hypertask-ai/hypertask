import crypto from 'crypto';

export interface McpInvocationIdentity {
  requestId: string;
  clientFingerprint: string;
  sessionId?: string;
}

/**
 * Bind a primary write to the MCP transport request that caused it. Replaying
 * that request then reaches the API idempotency cache before deterministic
 * attachment persistence resumes.
 *
 * The bearer-token fingerprint namespaces JSON-RPC request IDs for the live
 * stateless transport without retaining or forwarding the credential itself.
 */
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
        // JSON-RPC IDs may be reused after reconnecting. Binding the complete
        // validated tool input prevents a different mutation from replaying a
        // prior response, including when only its inline attachments changed.
        requestPayload,
      })
    )
    .digest('hex');
  return `mcp-invocation-${digest}`;
}
