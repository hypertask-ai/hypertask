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
  const preparing = new Map<string, QueuedAiChatMessage[]>();
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
      return (preparing.get(sessionId)?.length ?? 0) > 0;
    },
    enqueue(sessionId: string, message: QueuedAiChatMessage, prepare: () => Promise<AiChatProcessedAttachment[]>): Promise<boolean> {
      const submissions = preparing.get(sessionId) ?? [];
      if (submissions.some((item) => item.content === message.content && item.html === message.html &&
          item.files.length === message.files.length && item.files.every((file, index) => file === message.files[index]))) {
        return Promise.resolve(false);
      }
      preparing.set(sessionId, [...submissions, message]);
      const addition = pending.then(async () => {
        try {
          const attachments = await prepare();
          queue.set(sessionId, [...queue.get(sessionId), { ...message, attachments }]);
          return true;
        } finally {
          preparing.set(sessionId, (preparing.get(sessionId) ?? []).filter((item) => item !== message));
        }
      });
      pending = addition.then(() => {}, () => {});
      return addition;
    },
  };
  return queue;
}

export type SessionMessageQueue = ReturnType<typeof createSessionMessageQueue>;
