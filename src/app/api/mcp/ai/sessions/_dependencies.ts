import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { checkMcpRateLimit, validateMcpAuth, type McpAuthContext } from '@/lib/mcp/auth';
import { requireRole } from '@/lib/mcp/agents/scopes';
import { validateProjectAccess } from '@/lib/mcp/tasks/services';
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';
import { deleteTaskAttachmentFromS3 } from '@/lib/storage/uploadTaskAttachmentToS3';
import type { AiSessionHandlerDependencies } from '@/lib/mcp/ai/sessionHandler';

const sessionSelect = {
  id: true,
  projectId: true,
  taskId: true,
  title: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChatSessionSelect;

type SessionRecord = Prisma.ChatSessionGetPayload<{ select: typeof sessionSelect }>;

function serializeSession(session: SessionRecord) {
  return {
    id: session.id,
    project_id: session.projectId,
    task_id: session.taskId,
    title: session.title,
    created_at: session.createdAt.toISOString(),
    updated_at: session.updatedAt.toISOString(),
  };
}

const messageSelect = {
  id: true,
  role: true,
  content: true,
  createdAt: true,
  attachments: {
    select: { id: true, fileName: true, fileType: true, fileSize: true },
  },
} satisfies Prisma.ChatMessageSelect;

type MessageRecord = Prisma.ChatMessageGetPayload<{ select: typeof messageSelect }>;

function serializeMessage(message: MessageRecord) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    created_at: message.createdAt.toISOString(),
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      file_name: attachment.fileName,
      file_type: attachment.fileType,
      file_size: attachment.fileSize,
    })),
  };
}

async function accessibleSessionWhere(ctx: McpAuthContext): Promise<Prisma.ChatSessionWhereInput> {
  if (!ctx.agentId) return { userId: ctx.user.id };
  const projects = await prisma.project.findMany({
    where: { status: 'Normal', ...getProjectWhere(ctx.user.id, ctx.agentId) },
    select: { id: true },
  });
  return {
    userId: ctx.user.id,
    OR: [
      { projectId: { in: projects.map((project) => project.id) } },
      { projectId: null, agentId: ctx.agentId },
    ],
  };
}

export const aiSessionDependencies: AiSessionHandlerDependencies<McpAuthContext> = {
  checkRateLimit: checkMcpRateLimit,
  validateAuth: validateMcpAuth,
  authorizeRead: async (ctx) => ctx.agentId ? requireRole(ctx, 'read') : null,
  authorizeWrite: async (ctx) => ctx.agentId ? requireRole(ctx, 'write') : null,
  actorUserId: (ctx) => ctx.user.id,
  actorAgentId: (ctx) => ctx.agentId,
  validateProject: async (userId, agentId, projectId) => {
    const result = await validateProjectAccess(projectId, userId, agentId);
    return result.error
      ? NextResponse.json({ success: false, error: result.error.message }, { status: result.error.status })
      : null;
  },
  list: async (ctx, limit, offset) => {
    const where = await accessibleSessionWhere(ctx);
    const [sessions, total] = await Promise.all([
      prisma.chatSession.findMany({
        where,
        select: sessionSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.chatSession.count({ where }),
    ]);
    return { sessions: sessions.map(serializeSession), total };
  },
  messages: async (ctx, id, limit, offset) => {
    const where = { ...(await accessibleSessionWhere(ctx)), id };
    const [session, messages, total] = await Promise.all([
      prisma.chatSession.findFirst({ where, select: sessionSelect }),
      prisma.chatMessage.findMany({
        where: { sessionId: id, session: where },
        select: messageSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.chatMessage.count({ where: { sessionId: id, session: where } }),
    ]);
    return session ? { session: { ...serializeSession(session), messages: messages.map(serializeMessage) }, total } : null;
  },
  create: async ({ context, userId, agentId, id, projectId, title }) => {
    await prisma.chatSession.createMany({
      data: [{ id, userId, projectId, agentId: projectId === null ? agentId : null, title }],
      skipDuplicates: true,
    });
    const session = await prisma.chatSession.findFirst({
      where: { ...(await accessibleSessionWhere(context)), id },
      select: sessionSelect,
    });
    if (!session) return null;
    return serializeSession(session);
  },
  rename: async (ctx, id, title) => {
    const where = { ...(await accessibleSessionWhere(ctx)), id };
    const updated = await prisma.chatSession.updateMany({
      where,
      data: { title, updatedAt: new Date() },
    });
    if (updated.count === 0) return null;
    const session = await prisma.chatSession.findFirst({
      where,
      select: sessionSelect,
    });
    if (!session) return null;
    return serializeSession(session);
  },
  remove: async (ctx, id) => {
    const where = { ...(await accessibleSessionWhere(ctx)), id };
    const deleted = await prisma.$transaction(async (tx) => {
      const session = await tx.chatSession.findFirst({
        where,
        select: {
          messages: {
            select: {
              attachments: { select: { id: true, fileSource: true } },
            },
          },
        },
      });
      if (!session) return { removed: false, fileSources: [] as string[] };
      const attachments = session.messages.flatMap((message) => message.attachments);
      if (attachments.length > 0) {
        await tx.attachment.deleteMany({ where: { id: { in: attachments.map((item) => item.id) } } });
      }
      await tx.chatSession.deleteMany({ where });
      return { removed: true, fileSources: attachments.map((item) => item.fileSource) };
    });
    if (!deleted.removed) return;
    await Promise.allSettled(deleted.fileSources.map((fileSource) => deleteTaskAttachmentFromS3(fileSource)));
  },
};
