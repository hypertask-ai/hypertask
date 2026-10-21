export const CHAT_TRANSPORT_RETRY_DELAYS_MS = [1500, 4000, 8000] as const;

export class ChatRequestRefusedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ChatRequestRefusedError";
  }
}

export function shouldRetryChatTransport(error: unknown, attempt: number): boolean {
  if (attempt >= CHAT_TRANSPORT_RETRY_DELAYS_MS.length) return false;
  if (error instanceof ChatRequestRefusedError) {
    return error.status === 409 && attempt > 0;
  }
  return true;
}
