import type { FileItem } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import type { AiChatProcessedAttachment } from "@/hooks/MultiPages/AIChat/aiChatShared";

export type QueuedAiChatMessage = {
  id: string;
  assistantMessageId?: string;
  content: string;
  html: string;
  files: FileItem[];
  attachments?: AiChatProcessedAttachment[];
};

export function createSessionMessageQueue(userId: number, storage: Storage | null, onChange: () => void) {
  const queues = new Map<string, QueuedAiChatMessage[]>();
  const preparing = new Map<string, number>();
  const key = (sessionId: string) => `ht:aiChatQueue:${userId}:${sessionId}`;
  let pending = Promise.resolve();
  const queue = {
    sessionId: undefined as string | undefined,
    get(sessionId: string): QueuedAiChatMessage[] {
      if (!queues.has(sessionId)) {
        try {
          const saved: unknown = JSON.parse(storage?.getItem(key(sessionId)) ?? "[]");
          queues.set(sessionId, Array.isArray(saved) ? saved.map((item) => ({ ...item, files: [] })) : []);
        } catch {
          queues.set(sessionId, []);
        }
      }
      return queues.get(sessionId)!;
    },
    set(sessionId: string, messages: QueuedAiChatMessage[]): void {
      if (!storage) throw new Error("Session storage is unavailable");
      if (messages.length) storage.setItem(key(sessionId), JSON.stringify(messages.map(({ id, assistantMessageId, content, html, attachments }) => ({ id, assistantMessageId, content, html, attachments }))));
      else storage.removeItem(key(sessionId));
      queues.set(sessionId, messages);
      onChange();
    },
    hasPending(sessionId: string): boolean {
      return (preparing.get(sessionId) ?? 0) > 0;
    },
    enqueue(sessionId: string, message: QueuedAiChatMessage, prepare: () => Promise<AiChatProcessedAttachment[]>): Promise<void> {
      preparing.set(sessionId, (preparing.get(sessionId) ?? 0) + 1);
      const addition = pending.then(async () => {
        try {
          const attachments = await prepare();
          queue.set(sessionId, [...queue.get(sessionId), { ...message, attachments }]);
        } finally {
          preparing.set(sessionId, (preparing.get(sessionId) ?? 1) - 1);
        }
      });
      pending = addition.catch(() => {});
      return addition;
    },
  };
  return queue;
}

export type SessionMessageQueue = ReturnType<typeof createSessionMessageQueue>;
