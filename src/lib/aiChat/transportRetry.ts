/**
 * HTPR-7099: a reply request whose connection drops right after Send used to
 * end at once with "Connection lost", although the server keeps generating
 * and saves the reply. The same request is safe to send again: a finished
 * reply is replayed by assistant message id, and a reply still running is
 * refused with 409 until it ends.
 */
export const CHAT_TRANSPORT_RETRY_DELAYS_MS = [1500, 4000, 8000] as const;

export class ChatRequestRefusedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ChatRequestRefusedError";
  }
}

/** True when a failed attempt is worth sending again. */
export function shouldRetryChatTransport(error: unknown, attempt: number): boolean {
  if (attempt >= CHAT_TRANSPORT_RETRY_DELAYS_MS.length) return false;
  if (error instanceof ChatRequestRefusedError) {
    // Only "another reply in progress" after our own earlier attempt: that
    // reply is the one we are waiting for. A first-attempt refusal is real.
    return error.status === 409 && attempt > 0;
  }
  // No response, or the body died mid-read: a transport failure.
  return true;
}
