import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isFeatureEnabled, listFeatureFlagModes } from "@/lib/flags";
import { HTPR_7072_DECISION_INBOX_FLAG } from "@/lib/flags/keys";
import { isUnreleasedFeatureFlag } from "@/lib/flags/cluster";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export type DecisionRow = {
  kind: "question" | "review" | "flag";
  taskId: number | null;
  ticketKey: string | null;
  title: string;
  question: string;
  waitingSince: string;
  href: string;
};

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const QUESTION_PREFIX = /^question:\s*/i;

const taskSelect = {
  id: true,
  title: true,
  ticketNumber: true,
  uniqueIndex: true,
  projectId: true,
  section: true,
  sectionChangedAt: true,
} as const;

type TaskRow = {
  id: number;
  title: string;
  ticketNumber: string | null;
  uniqueIndex: number;
  projectId: number;
  section: string;
  sectionChangedAt: Date;
};

type CommentRow = {
  id: number;
  taskId: number;
  text: string;
  commentText: string;
  createdAt: Date;
};

const taskHref = (task: TaskRow, commentId?: number) =>
  `/detail/project-${task.projectId}/${task.uniqueIndex}${commentId ? `#comment-${commentId}` : ""}`;

/**
 * Everything waiting on this person's decision, derived from ticket state.
 * Nothing is stored: a reply on the ticket or a move out of the review column
 * makes the row disappear on the next read. The query count is fixed (at most
 * five) whatever the number of rows.
 */
export async function getDecisionInbox(
  userId: number,
  isFlagOwner: boolean,
): Promise<DecisionRow[]> {
  if (!(await isFeatureEnabled(HTPR_7072_DECISION_INBOX_FLAG, userId))) return [];

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true },
  });
  const displayName = user?.displayName?.trim();
  const access: Prisma.ProjectWhereInput = { status: "Normal", ...projectContentAccessWhere(userId) };

  const [reviewTasks, mentions, flags] = await Promise.all([
    displayName
      ? prisma.task.findMany({
          where: {
            status: "Normal",
            archivedAt: null,
            deletedAt: null,
            // Review columns use the full or the first name ("Valentin Review").
            OR: [...new Set([displayName, displayName.split(/\s+/)[0]])].map((name) => ({
              section: { equals: `${name} Review`, mode: "insensitive" as const },
            })),
            project: access,
          },
          select: taskSelect,
        })
      : Promise.resolve([] as TaskRow[]),
    prisma.notification.findMany({
      where: {
        userId,
        type: "Mentioned",
        status: "Normal",
        commentId: { not: null },
        task: { status: "Normal", archivedAt: null, deletedAt: null, project: access },
      },
      select: {
        comment: {
          select: { id: true, taskId: true, text: true, commentText: true, createdAt: true },
        },
        task: { select: taskSelect },
      },
    }),
    isFlagOwner ? listFeatureFlagModes() : Promise.resolve([]),
  ]);

  const questions = (mentions as { comment: CommentRow | null; task: TaskRow | null }[])
    .map((m) => ({
      comment: m.comment,
      task: m.task,
      text: stripHtml(m.comment?.commentText || m.comment?.text || ""),
    }))
    .filter(
      (m): m is { comment: CommentRow; task: TaskRow; text: string } =>
        !!m.comment && !!m.task && QUESTION_PREFIX.test(m.text),
    );

  const questionTaskIds = [...new Set(questions.map((m) => m.task.id))];
  const viewerComments = questionTaskIds.length
    ? await prisma.comment.findMany({
        where: { creatorId: userId, taskId: { in: questionTaskIds } },
        select: { taskId: true, createdAt: true },
      })
    : [];
  const lastReplyByTask = new Map<number, number>();
  for (const c of viewerComments as { taskId: number; createdAt: Date }[]) {
    lastReplyByTask.set(c.taskId, Math.max(lastReplyByTask.get(c.taskId) ?? 0, c.createdAt.getTime()));
  }

  const rows = new Map<string, DecisionRow & { at: number }>();
  const add = (key: string, row: DecisionRow, at: number) => {
    const existing = rows.get(key);
    if (!existing || at < existing.at) rows.set(key, { ...row, at });
  };

  for (const m of questions) {
    // A later comment by the viewer on the same ticket is their answer.
    if ((lastReplyByTask.get(m.task.id) ?? 0) > m.comment.createdAt.getTime()) continue;
    // The oldest unanswered question per ticket is the one still waiting.
    add(
      `task-${m.task.id}`,
      {
        kind: "question",
        taskId: m.task.id,
        ticketKey: m.task.ticketNumber,
        title: m.task.title,
        question: m.text.replace(QUESTION_PREFIX, "").trim(),
        waitingSince: m.comment.createdAt.toISOString(),
        href: taskHref(m.task, m.comment.id),
      },
      m.comment.createdAt.getTime(),
    );
  }

  for (const task of reviewTasks as TaskRow[]) {
    if (rows.has(`task-${task.id}`)) continue;
    add(
      `task-${task.id}`,
      {
        kind: "review",
        taskId: task.id,
        ticketKey: task.ticketNumber,
        title: task.title,
        question: `Waiting in ${task.section}`,
        waitingSince: task.sectionChangedAt.toISOString(),
        href: taskHref(task),
      },
      task.sectionChangedAt.getTime(),
    );
  }

  for (const flag of flags) {
    if (!isUnreleasedFeatureFlag(flag)) continue;
    const since = flag.updatedAt ?? (flag.shippedOn ? new Date(flag.shippedOn) : new Date());
    const label = (flag.description || flag.key).split(/(?<=[.!?])\s/)[0].slice(0, 140);
    add(
      `flag-${flag.key}`,
      {
        kind: "flag",
        taskId: null,
        ticketKey: null,
        title: flag.key,
        question: `Release ${label}?`,
        waitingSince: since.toISOString(),
        href: `/admin/flags/${flag.key}`,
      },
      since.getTime(),
    );
  }

  return [...rows.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ at: _at, ...row }) => row);
}
