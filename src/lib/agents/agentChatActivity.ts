import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { serializeAgentRunActivity } from "@/lib/agentRuns/model";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  compareAgentChatFeedItems,
  type AgentChatActivity,
} from "./chatActivityFeed";

const MAX_AGENT_CHAT_ACTIVITY = 200;

const taskSelect = {
  id: true,
  projectId: true,
  uniqueIndex: true,
  ticketNumber: true,
  title: true,
} as const;

type AgentChatActivityDatabase = Pick<
  PrismaClient,
  "agentRun" | "agentRunActivity"
>;

type ActivityTask = {
  id: number;
  projectId: number;
  uniqueIndex: number;
  ticketNumber: string | null;
  title: string;
};

function activityTask(task: ActivityTask | null): AgentChatActivity["task"] {
  if (!task) return null;
  return {
    id: task.id,
    ticketNumber: task.ticketNumber ?? `Task ${task.uniqueIndex}`,
    title: task.title,
    url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
  };
}

function safeActivityLink(link: string | null): string | null {
  if (!link || link.length > 2_048) return null;
  try {
    const parsed = new URL(link);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export async function listAgentChatActivity(
  input: {
    agentId: string;
    sessionId: string;
    userId: number;
    limit?: number;
  },
  db: AgentChatActivityDatabase = prisma,
): Promise<AgentChatActivity[]> {
  const requestedLimit = input.limit ?? MAX_AGENT_CHAT_ACTIVITY;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(
        Math.max(Math.trunc(requestedLimit), 1),
        MAX_AGENT_CHAT_ACTIVITY,
      )
    : MAX_AGENT_CHAT_ACTIVITY;
  const visibleTask = {
    is: { project: getProjectWhere(input.userId) },
  } satisfies Prisma.TaskNullableScalarRelationFilter;
  const visibleRunWhere = {
    agentId: input.agentId,
    OR: [
      {
        chatSessionId: input.sessionId,
        taskId: null,
        chatSession: {
          is: { userId: input.userId, agentId: input.agentId },
        },
      },
      { task: visibleTask },
    ],
  } satisfies Prisma.AgentRunWhereInput;

  const [runs, activities] = await Promise.all([
    db.agentRun.findMany({
      where: { agentId: input.agentId, task: visibleTask },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, createdAt: true, task: { select: taskSelect } },
    }),
    db.agentRunActivity.findMany({
      where: {
        type: { not: "RESPONSE" },
        run: { is: visibleRunWhere },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        runId: true,
        type: true,
        text: true,
        link: true,
        options: true,
        selectedValue: true,
        selectedLabel: true,
        selectedAt: true,
        selectedById: true,
        createdAt: true,
        run: { select: { task: { select: taskSelect } } },
      },
    }),
  ]);

  const feed: AgentChatActivity[] = runs.flatMap((run) => {
    const task = activityTask(run.task);
    return task
      ? [
          {
            id: `run-${run.id}`,
            kind: "event" as const,
            type: "action" as const,
            text: `Started ${task.ticketNumber}`,
            link: null,
            createdAt: run.createdAt.toISOString(),
            task,
          },
        ]
      : [];
  });
  for (const row of activities) {
    const serialized = serializeAgentRunActivity(row);
    if (serialized.type === "response") continue;
    feed.push({
      id: `activity-${serialized.id}`,
      kind: "event",
      type: serialized.type,
      text: serialized.text,
      link: safeActivityLink(serialized.link),
      createdAt: serialized.createdAt,
      task: activityTask(row.run.task),
    });
  }

  return feed.sort(compareAgentChatFeedItems).slice(-limit);
}
