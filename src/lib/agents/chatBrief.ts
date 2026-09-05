import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { doneColumnTitles, isDoneColumn } from "@/lib/doneColumns";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import type {
  AgentWebhookChatBrief,
  AgentWebhookChatBriefTicket,
  AgentWebhookChatBriefTicketRef,
} from "@/lib/agentWebhooks/events";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const RECENT_TICKET_LIMIT = 10;
const OPEN_PULL_REQUEST_LIMIT = 10;
const RECENT_COMMENT_LIMIT = 5;
const MAX_BRIEF_LENGTH = 12000;

const TASK_TITLE_LIMIT = 120;
const SECTION_LIMIT = 50;
const ASSIGNEE_LIMIT = 3;
const ASSIGNEE_NAME_LIMIT = 40;
const COMMENT_LIMIT = 160;
const URL_LIMIT = 160;
const REPOSITORY_LIMIT = 120;

const taskSelect = {
  id: true,
  uniqueIndex: true,
  ticketNumber: true,
  title: true,
  section: true,
  status: true,
  projectId: true,
  project: {
    select: {
      section: {
        where: { deleted: false },
        select: { section_title: true, isDone: true },
      },
    },
  },
  assignees: {
    orderBy: { id: "asc" as const },
    take: ASSIGNEE_LIMIT,
    select: {
      agent: { select: { displayName: true } },
      user: { select: { displayName: true } },
    },
  },
} satisfies Prisma.TaskSelect;

type BriefTask = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
type BriefDatabase = Pick<
  typeof prisma,
  "assignees" | "comment" | "taskPullRequest"
>;

const clipped = (value: string | null | undefined, limit: number): string =>
  (value ?? "").trim().slice(0, limit);

const plainComment = (commentText: string, html: string): string => {
  const text = commentText.trim() || html.replace(/<[^>]*>/g, " ");
  return clipped(
    text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " "),
    COMMENT_LIMIT,
  );
};

const taskOutcome = (
  task: BriefTask,
): AgentWebhookChatBriefTicket["outcome"] => {
  if (task.status === "Archive") return "archived";
  const doneTitles = doneColumnTitles(task.project.section);
  return isDoneColumn(task.section, doneTitles) ? "completed" : "open";
};

const taskRef = (task: BriefTask): AgentWebhookChatBriefTicketRef => ({
  ticketNumber: clipped(task.ticketNumber, 40) || null,
  title: clipped(task.title, TASK_TITLE_LIMIT),
  url: clipped(buildMcpTaskUrl(task.projectId, task.uniqueIndex), URL_LIMIT),
});

const taskBrief = (task: BriefTask): AgentWebhookChatBriefTicket => ({
  ...taskRef(task),
  section: clipped(task.section, SECTION_LIMIT),
  outcome: taskOutcome(task),
  assignees: [
    ...new Set(
      task.assignees.map((assignment) =>
        clipped(
          assignment.agent?.displayName ||
            assignment.user.displayName ||
            "Unnamed user",
          ASSIGNEE_NAME_LIMIT,
        ),
      ),
    ),
  ],
});

export async function buildAgentChatBrief({
  userId,
  agentId,
  db = prisma,
}: {
  userId: number;
  agentId: string;
  db?: BriefDatabase;
}): Promise<AgentWebhookChatBrief> {
  const currentAssignment = await db.assignees.findFirst({
    where: {
      agentId,
      task: {
        status: "Normal",
        deletedAt: null,
        section: "In Progress",
        project: getProjectWhere(userId),
      },
    },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    select: { task: { select: taskSelect } },
  });
  const currentTaskId = currentAssignment?.task.id;
  const visibleTask = {
    status: { not: "Deleted" as const },
    project: getProjectWhere(userId),
  };

  const [recentTicketComments, pullRequests, recentComments] = await Promise.all([
    db.comment.findMany({
      where: {
        agentId,
        ...(currentTaskId ? { taskId: { not: currentTaskId } } : {}),
        task: visibleTask,
      },
      distinct: ["taskId"],
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_TICKET_LIMIT,
      select: {
        id: true,
        createdAt: true,
        task: { select: taskSelect },
      },
    }),
    db.taskPullRequest.findMany({
      where: {
        lifecycle: "open",
        task: {
          ...visibleTask,
          assignees: { some: { agentId } },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: OPEN_PULL_REQUEST_LIMIT,
      select: {
        id: true,
        number: true,
        title: true,
        url: true,
        repositoryOwner: true,
        repositoryName: true,
        checkState: true,
        updatedAt: true,
        task: { select: taskSelect },
      },
    }),
    db.comment.findMany({
      where: { agentId, task: visibleTask },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_COMMENT_LIMIT,
      select: {
        id: true,
        text: true,
        commentText: true,
        createdAt: true,
        task: { select: taskSelect },
      },
    }),
  ]);

  const brief: AgentWebhookChatBrief = {
    currentTicket: currentAssignment ? taskBrief(currentAssignment.task) : null,
    recentTickets: recentTicketComments.map(({ task }) => taskBrief(task)),
    openPullRequests: pullRequests.map((pullRequest) => ({
      number: pullRequest.number,
      title: clipped(pullRequest.title, TASK_TITLE_LIMIT),
      url: clipped(pullRequest.url, URL_LIMIT),
      repository: clipped(
        `${pullRequest.repositoryOwner}/${pullRequest.repositoryName}`,
        REPOSITORY_LIMIT,
      ),
      checkState: clipped(pullRequest.checkState, 30),
      ticket: taskRef(pullRequest.task),
    })),
    recentComments: recentComments.map((comment) => ({
      text: plainComment(comment.commentText, comment.text),
      createdAt: comment.createdAt.toISOString(),
      ticket: taskRef(comment.task),
    })),
  };

  while (
    brief.openPullRequests.length > 0 &&
    JSON.stringify(brief).length > MAX_BRIEF_LENGTH
  ) {
    brief.openPullRequests.pop();
  }

  return brief;
}
