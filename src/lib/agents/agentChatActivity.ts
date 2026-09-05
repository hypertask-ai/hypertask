import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { serializeAgentRunActivity } from "@/lib/agentRuns/model";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  compareAgentChatFeedItems,
  type AgentChatActivity,
} from "./chatActivityFeed";

const MAX_AGENT_CHAT_ACTIVITY = 200;
const TIMELINE_OVERFETCH = 3;
const MAX_TIMELINE_TEXT = 500;

const taskSelect = {
  id: true,
  projectId: true,
  uniqueIndex: true,
  ticketNumber: true,
  title: true,
} as const;

type AgentChatActivityDatabase = Pick<
  PrismaClient,
  "agentRun" | "agentRunActivity" | "comment"
>;

type ActivityTask = {
  id: number;
  projectId: number;
  uniqueIndex: number;
  ticketNumber: string | null;
  title: string;
};

type TimelineTask = ActivityTask & {
  agentRuns: Array<{ createdAt: Date }>;
  taskSessions: Array<{ createdAt: Date }>;
  comments: Array<{ createdAt: Date }>;
};

type TimelineRow = {
  id: number;
  createdAt: Date;
  text: string;
  commentText: string;
  agentId: string | null;
  activity: Prisma.JsonValue | null;
  task: TimelineTask;
};

type PullRequestActivity = {
  state: "open" | "checks_red" | "green" | "merged";
  number: number;
  repository: string;
  link: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function prefixedCommentWhere(prefixes: string[]): Prisma.CommentWhereInput[] {
  return prefixes.flatMap((prefix) =>
    (["text", "commentText"] as const).flatMap((field) => [
      { [field]: { startsWith: prefix } },
      { [field]: { startsWith: `<p>${prefix}` } },
      { [field]: { startsWith: `<p><strong>${prefix}` } },
    ]),
  );
}

function normalizedTimelineText(text: string, commentText: string): string {
  const source = commentText.trim() || text;
  return source
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TIMELINE_TEXT);
}

function firstAgentInvolvement(task: TimelineTask): Date | null {
  const times = [
    task.agentRuns[0]?.createdAt,
    task.taskSessions[0]?.createdAt,
    task.comments[0]?.createdAt,
  ].filter((value): value is Date => value instanceof Date);
  if (times.length === 0) return null;
  return new Date(Math.min(...times.map((value) => value.getTime())));
}

function parsePullRequestActivity(activity: unknown): PullRequestActivity | null {
  if (!isRecord(activity) || activity.type !== "TaskPullRequest") return null;
  const data = activity.data;
  if (!isRecord(data) || !isRecord(data.pullRequest)) return null;
  const pullRequest = data.pullRequest;
  const { displayState, number, repository, url } = pullRequest;
  if (
    displayState !== "open" &&
    displayState !== "checks_red" &&
    displayState !== "green" &&
    displayState !== "merged"
  ) {
    return null;
  }
  if (!Number.isSafeInteger(number) || (number as number) <= 0) return null;
  if (typeof repository !== "string" || !repository.trim() || repository.length > 250) {
    return null;
  }
  const link = safeActivityLink(typeof url === "string" ? url : null);
  if (!link) return null;
  return {
    state: displayState,
    number: number as number,
    repository: repository.trim(),
    link,
  };
}

function taskMoveText(activity: unknown): string | null {
  if (!isRecord(activity) || activity.type !== "TaskMove") return null;
  const data = activity.data;
  if (!isRecord(data) || !isRecord(data.toSection)) return null;
  const rawTitle = data.toSection.sectionTitle;
  if (typeof rawTitle !== "string") return null;
  const title = rawTitle.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!title) return null;
  const normalized = title.toLowerCase();
  if (/\b(blocked|waiting)\b/.test(normalized)) return "Blocked";
  if (/\b(qa|review|design)\b/.test(normalized)) return `Handoff: ${title}`;
  return null;
}

function authoredCommentText(row: TimelineRow, selectedAgentId: string): string | null {
  if (!row.agentId) return null;
  const normalized = normalizedTimelineText(row.text, row.commentText);
  if (row.agentId === selectedAgentId) {
    const escalation =
      /^🚨 Agent escalation — needs a human\.\s+Reason:\s+(.+?)(?:\s+Already tried:|$)/.exec(
        normalized,
      );
    if (escalation) {
      const reasonEnd = escalation[1].search(/[.!?](?=\s|$)/);
      const reason =
        reasonEnd >= 0 ? escalation[1].slice(0, reasonEnd + 1) : escalation[1];
      return `Blocked: ${reason}`.slice(0, MAX_TIMELINE_TEXT);
    }
  }

  const headlineEnd = normalized.search(/[.!?](?=\s|$)/);
  const text =
    headlineEnd >= 0 ? normalized.slice(0, headlineEnd + 1) : normalized;
  if (!text) return null;

  if (row.agentId === selectedAgentId) {
    if (/^(?:Model|Switched|Live):(?:\s|$)/.test(text)) return text;
    if (/^AI review concerns(?:\s|:|$)/i.test(text)) {
      return `Review: ${text}`.slice(0, MAX_TIMELINE_TEXT);
    }
  }

  const qa = /^(PASS|FAIL):(?:\s*)(.*)$/i.exec(text);
  if (!qa) return null;
  const detail = qa[2].trim();
  return `QA: ${qa[1].toUpperCase()}${detail ? ` — ${detail}` : ""}`.slice(
    0,
    MAX_TIMELINE_TEXT,
  );
}

function timelineEvent(
  row: TimelineRow,
  input: { id?: string; text: string; link?: string | null },
): AgentChatActivity {
  return {
    id: input.id ?? `timeline-${row.id}`,
    kind: "event",
    type: "action",
    text: input.text,
    link: input.link ?? null,
    createdAt: row.createdAt.toISOString(),
    task: activityTask(row.task),
  };
}

function projectTimelineRows(
  rows: TimelineRow[],
  selectedAgentId: string,
): AgentChatActivity[] {
  const feed: AgentChatActivity[] = [];
  const approvedPullRequests = new Set<string>();
  const chronological = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
  );

  for (const row of chronological) {
    const involvedAt = firstAgentInvolvement(row.task);
    if (!involvedAt || row.createdAt < involvedAt) continue;

    const pullRequest = parsePullRequestActivity(row.activity);
    if (pullRequest) {
      const key = `${row.task.id}:${pullRequest.repository}:${pullRequest.number}`;
      if (pullRequest.state === "open") {
        approvedPullRequests.delete(key);
        feed.push(
          timelineEvent(row, {
            text: `PR opened #${pullRequest.number}`,
            link: pullRequest.link,
          }),
        );
      } else if (pullRequest.state === "checks_red") {
        approvedPullRequests.delete(key);
        feed.push(
          timelineEvent(row, {
            text: "Review: CONCERNS",
            link: pullRequest.link,
          }),
        );
      } else if (pullRequest.state === "green") {
        approvedPullRequests.add(key);
        feed.push(
          timelineEvent(row, {
            text: "Review: APPROVE",
            link: pullRequest.link,
          }),
        );
      } else {
        if (!approvedPullRequests.has(key)) {
          feed.push(
            timelineEvent(row, {
              id: `timeline-${row.id}-0-review`,
              text: "Review: APPROVE",
              link: pullRequest.link,
            }),
          );
        }
        approvedPullRequests.add(key);
        feed.push(
          timelineEvent(row, {
            id: `timeline-${row.id}-1-merged`,
            text: "Merged, deploying",
            link: pullRequest.link,
          }),
        );
      }
      continue;
    }

    const moveText = taskMoveText(row.activity);
    if (moveText) {
      feed.push(timelineEvent(row, { text: moveText }));
      continue;
    }

    const commentText = authoredCommentText(row, selectedAgentId);
    if (commentText) feed.push(timelineEvent(row, { text: commentText }));
  }

  return feed;
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
  const projectWhere = getProjectWhere(input.userId);
  const visibleTask = {
    is: { project: projectWhere },
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
  const selectedCommentWhere = prefixedCommentWhere([
    "Model:",
    "Switched:",
    "Live:",
    "AI review concerns",
    "🚨 Agent escalation — needs a human.",
  ]);
  const qaCommentWhere = prefixedCommentWhere(["PASS:", "FAIL:"]);
  const timelineTaskSelect = {
    ...taskSelect,
    agentRuns: {
      where: { agentId: input.agentId },
      orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
      take: 1,
      select: { createdAt: true },
    },
    taskSessions: {
      where: { agentId: input.agentId },
      orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
      take: 1,
      select: { createdAt: true },
    },
    comments: {
      where: { agentId: input.agentId },
      orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
      take: 1,
      select: { createdAt: true },
    },
  } satisfies Prisma.TaskSelect;

  const [runs, activities, timelineRows] = await Promise.all([
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
    db.comment.findMany({
      where: {
        task: {
          project: projectWhere,
          status: { not: "Deleted" },
          deletedAt: null,
          OR: [
            { agentRuns: { some: { agentId: input.agentId } } },
            { taskSessions: { some: { agentId: input.agentId } } },
            { comments: { some: { agentId: input.agentId } } },
          ],
        },
        OR: [
          { activity: { path: ["type"], equals: "TaskPullRequest" } },
          { activity: { path: ["type"], equals: "TaskMove" } },
          { agentId: input.agentId, OR: selectedCommentWhere },
          { agentId: { not: null }, OR: qaCommentWhere },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit * TIMELINE_OVERFETCH,
      select: {
        id: true,
        createdAt: true,
        text: true,
        commentText: true,
        agentId: true,
        activity: true,
        task: { select: timelineTaskSelect },
      },
    }),
  ]).catch((cause: unknown) => {
    throw new Error("Failed to load Agent Chat activity", { cause });
  });

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
  feed.push(
    ...projectTimelineRows(timelineRows as unknown as TimelineRow[], input.agentId),
  );

  return feed.sort(compareAgentChatFeedItems).slice(-limit);
}
