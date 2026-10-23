import { agentScopeEnforced, withAgentScopeRequest } from "@/lib/auth/agentScope";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export const runtime = "nodejs";


const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

type FeedItem = {
  id: string;
  at: string;
  kind: "comment" | "evidence" | "question" | "session" | "model";
  did: string;
  detail: string | null;
  task: { id: number; title: string; url: string } | null;
  tokens: number | null;
};

const taskRef = (
  task: { id: number; uniqueIndex: number; title: string; projectId: number } | null,
) =>
  task
    ? {
        id: task.id,
        title: task.title,
        url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
      }
    : null;

const taskSelect = {
  select: { id: true, uniqueIndex: true, title: true, projectId: true },
} as const;

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  return withAgentScopeRequest(request, () => getAgentActivity(request, props));
}

async function getAgentActivity(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const params = await props.params;

  const session = await getSessionUser(request.headers);
  const userId = session?.userId;
  const actingAgentId = session?.agentId;
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const agent = await prisma.agent.findFirst({
    where: { id: params.agentId, userId },
    select: { id: true },
  });
  if (!agent) {
    return NextResponse.json(
      { success: false, error: "Agent does not exist" },
      { status: 404 },
    );
  }

  const requested = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.trunc(requested), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const visibleTask = { task: { project: getProjectWhere(userId) } };
  const visibleUsageProjects =
    actingAgentId && agentScopeEnforced()
      ? await prisma.project.findMany({
          where: {
            ...getProjectWhere(userId),
            AND: [getProjectWhere(userId, actingAgentId)],
          },
          select: { id: true },
        })
      : null;

  const [comments, evidence, questions, sessions, usage] = await Promise.all([
    prisma.comment.findMany({
      where: {
        agentId: agent.id,
        ...visibleTask,
        AND: [{ task: { project: getProjectWhere(userId, actingAgentId) } }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        commentText: true,
        task: taskSelect,
      },
    }),
    prisma.taskEvidence.findMany({
      where: {
        agentId: agent.id,
        ...visibleTask,
        AND: [{ task: { project: getProjectWhere(userId, actingAgentId) } }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        type: true,
        title: true,
        task: taskSelect,
      },
    }),
    prisma.decisionRequest.findMany({
      where: {
        agentId: agent.id,
        ...visibleTask,
        AND: [{ task: { project: getProjectWhere(userId, actingAgentId) } }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        question: true,
        status: true,
        task: taskSelect,
      },
    }),
    prisma.taskSession.findMany({
      where: {
        agentId: agent.id,
        ...visibleTask,
        AND: [{ task: { project: getProjectWhere(userId, actingAgentId) } }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        status: true,
        task: taskSelect,
      },
    }),
    prisma.aiUsage.findMany({
      where: {
        agentId: agent.id,
        ...(visibleUsageProjects
          ? { projectId: { in: visibleUsageProjects.map((project) => project.id) } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        model: true,
        feature: true,
        totalTokens: true,
      },
    }),
  ]);

  const items: FeedItem[] = [
    ...comments.map((row) => ({
      id: `comment-${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "comment" as const,
      did: "Commented",
      detail: row.commentText.trim().slice(0, 160) || null,
      task: taskRef(row.task),
      tokens: null,
    })),
    ...evidence.map((row) => ({
      id: `evidence-${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "evidence" as const,
      did: "Attached evidence",
      detail: row.title ?? row.type,
      task: taskRef(row.task),
      tokens: null,
    })),
    ...questions.map((row) => ({
      id: `question-${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "question" as const,
      did: "Asked a question",
      detail: row.question.trim().slice(0, 160) || null,
      task: taskRef(row.task),
      tokens: null,
    })),
    ...sessions.map((row) => ({
      id: `session-${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "session" as const,
      did: "Started work",
      detail: row.status,
      task: taskRef(row.task),
      tokens: null,
    })),
    ...usage.map((row) => ({
      id: `model-${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "model" as const,
      did: "Thought about the work",
      detail: row.model,
      task: null,
      tokens: row.totalTokens,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  return NextResponse.json({ success: true, items });
}
