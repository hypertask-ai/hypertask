import { MCP_ATTACHMENT_MAX_REQUEST_BYTES } from './constants';

export class McpAttachmentRequestBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'McpAttachmentRequestBodyError';
  }
}

/** Read request bytes without allowing an unbounded body into memory. */
export async function readRequestBytesWithCap(
  request: Pick<Request, 'headers' | 'body'>,
  maxBytes = MCP_ATTACHMENT_MAX_REQUEST_BYTES
): Promise<Buffer> {
  const declaredRaw = request.headers.get('content-length');
  if (declaredRaw !== null) {
    if (!/^\d+$/.test(declaredRaw.trim())) {
      throw new McpAttachmentRequestBodyError('Invalid Content-Length header', 400);
    }
    if (Number(declaredRaw) > maxBytes) {
      throw new McpAttachmentRequestBodyError(
        `Request body exceeds ${maxBytes} bytes`,
        413
      );
    }
  }

  if (!request.body) {
    throw new McpAttachmentRequestBodyError('Request body must be valid JSON', 400);
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new McpAttachmentRequestBodyError(
          `Request body exceeds ${maxBytes} bytes`,
          413
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

/** Read and parse JSON without allowing an unbounded request body into memory. */
export async function readMcpAttachmentJsonBody(
  request: Pick<Request, 'headers' | 'body'>
): Promise<unknown> {
  const bytes = await readRequestBytesWithCap(request);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new McpAttachmentRequestBodyError('Request body must be valid JSON', 400);
  }
}
