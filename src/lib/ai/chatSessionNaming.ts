// HTPR-7052: a new AI chat is named from its first message, else the ticket it
// was opened on, else the board. "New AI Chat" stays only as the last resort.
export const DEFAULT_CHAT_TITLE = "New AI Chat";
export const MAX_CHAT_NAME_LENGTH = 50;

type NamingPrisma = {
  task: { findUnique: (args: { where: { id: number }; select: { title: true } }) => Promise<{ title: string | null } | null> };
  project: { findFirst: (args: { where: Record<string, unknown>; select: { title: true; name: true } }) => Promise<{ title: string | null; name: string } | null> };
  chatSession: { findFirst?: (args: { where: Record<string, unknown>; select: { title: true } }) => Promise<{ title: string } | null>; updateMany: (args: { where: Record<string, unknown>; data: { title: string } }) => Promise<unknown> };
};

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function shorten(text: string): string {
  if (text.length <= MAX_CHAT_NAME_LENGTH) return text;
  const cut = text.slice(0, MAX_CHAT_NAME_LENGTH + 1);
  const space = cut.lastIndexOf(" ");
  const base = space > 15 ? cut.slice(0, space) : cut.slice(0, MAX_CHAT_NAME_LENGTH);
  return `${base.replace(/[\s.!?;:,]+$/g, "")}...`;
}

/** Short name from a first message: first sentence, cut at a word boundary. */
export function nameFromMessage(message: string | null | undefined): string {
  const text = clean(message);
  if (!text) return "";
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text;
  return shorten(sentence.replace(/^["']|["']$/g, "").replace(/[.!?;:,]+$/g, "").trim());
}

/** Content name, else ticket title, else board name, else the old default. */
export function chooseChatName(parts: {
  message?: string | null;
  taskTitle?: string | null;
  boardName?: string | null;
}): string {
  return nameFromMessage(parts.message)
    || shorten(clean(parts.taskTitle))
    || shorten(clean(parts.boardName))
    || DEFAULT_CHAT_TITLE;
}

type Scope = { taskId?: number | null; projectId?: number | null; projectAccess?: Record<string, unknown> };

async function lookupNames(prisma: NamingPrisma, scope: Scope) {
  const taskId = scope.taskId ?? null;
  const projectId = scope.projectId ?? null;
  const task = taskId ? await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } }) : null;
  const project = !task?.title && projectId
    ? await prisma.project.findFirst({ where: { id: projectId, ...scope.projectAccess }, select: { title: true, name: true } })
    : null;
  return { taskTitle: task?.title ?? null, boardName: project ? project.title || project.name : null };
}

/**
 * Names a chat that still carries the default title. The caller has already
 * checked flag and access (taskId comes from resolveAiUsageTaskId). Never
 * renames a chat that has a title of its own.
 */
export async function nameNewChatSession(prisma: NamingPrisma, args: {
  sessionId: string;
  userId: number;
  message?: string | null;
  taskId?: number | null;
  projectId?: number | null;
  projectAccess?: Record<string, unknown>;
}): Promise<string> {
  const names = await lookupNames(prisma, args);
  const title = chooseChatName({ message: args.message, ...names });
  if (title === DEFAULT_CHAT_TITLE) return title;
  await prisma.chatSession.updateMany({
    where: { id: args.sessionId, userId: args.userId, title: DEFAULT_CHAT_TITLE },
    data: { title },
  });
  return title;
}

/** True when the chat still carries the name of the ticket it was opened on. */
export async function sessionKeepsTicketName(prisma: NamingPrisma, args: {
  sessionId: string;
  userId: number;
  taskId: number;
}): Promise<boolean> {
  if (!prisma.chatSession.findFirst) return false;
  const [session, task] = await Promise.all([
    prisma.chatSession.findFirst({ where: { id: args.sessionId, userId: args.userId }, select: { title: true } }),
    prisma.task.findUnique({ where: { id: args.taskId }, select: { title: true } }),
  ]);
  const ticketName = shorten(clean(task?.title));
  return Boolean(ticketName) && session?.title === ticketName;
}

/** Title for a session created with no message yet (Ctrl+J on a ticket). */
export async function titleForEmptySession(prisma: NamingPrisma, args: {
  taskId?: number | null;
  projectId?: number | null;
  projectAccess?: Record<string, unknown>;
}): Promise<string> {
  const names = await lookupNames(prisma, args);
  return chooseChatName(names);
}
