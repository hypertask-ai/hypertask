import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7052_CHAT_NAMES_FLAG } from "@/lib/flags/keys";
import { firstMessageChatTitle } from "@/lib/ai/chatNames";

/**
 * HTPR-7052: name a new chat from its first user message, before the reply starts.
 * Returns the guard for the later generated title (see StreamOptions.chatNameGuardTitle):
 * undefined when the flag is off or this is not a first user turn, null when the chat
 * keeps a title the user chose, else the title just written.
 */
export async function nameChatFromFirstMessage(input: {
  enabled: boolean;
  sessionId?: string | null;
  userId: number;
  message: string;
}): Promise<string | null | undefined> {
  if (!input.enabled || !input.sessionId) return undefined;
  try {
    if (!(await isFeatureEnabled(HTPR_7052_CHAT_NAMES_FLAG, input.userId))) return undefined;
    const session = await prisma.chatSession.findFirst({
      where: { id: input.sessionId, userId: input.userId },
      select: { title: true, taskId: true, projectId: true },
    });
    if (!session) return undefined;
    const [task, project] = await Promise.all([
      session.taskId ? prisma.task.findFirst({ where: { id: session.taskId }, select: { title: true } }) : null,
      session.projectId ? prisma.project.findFirst({ where: { id: session.projectId }, select: { name: true, title: true } }) : null,
    ]);
    const context = { taskTitle: task?.title, boardName: project?.title || project?.name };
    const next = firstMessageChatTitle(true, session.title, input.message, context);
    if (!next) return null;
    const written = await prisma.chatSession.updateMany({
      where: { id: input.sessionId, userId: input.userId, title: session.title },
      data: { title: next },
    });
    return written.count > 0 ? next : null;
  } catch (error) {
    console.error("[ai/chat/stream] first-message chat name failed", error);
    return undefined;
  }
}
