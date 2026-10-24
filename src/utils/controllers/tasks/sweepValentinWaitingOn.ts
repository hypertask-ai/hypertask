import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isQuestionComment } from "@/lib/inboxDecisions";
import { broadcastBoardChange, broadcastInboxChange, broadcastTaskChange } from "@/lib/realtime/server";

const VALENTIN_USER_ID = 6;
const WAITING_COLUMNS = ["Valentin Review", "UX Sign-off", "Flags"];

export async function sweepValentinWaitingOn(): Promise<number> {
  const changed = await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({
      where: {
        projectId: { in: [15, 4060] },
        OR: [
          { status: "Normal", section: { in: WAITING_COLUMNS } },
          { waitingOnUserId: VALENTIN_USER_ID },
        ],
      },
      select: {
        id: true,
        projectId: true,
        section: true,
        status: true,
        waitingOnUserId: true,
        waitingOnSetById: true,
        waitingOnSetAt: true,
        sectionEvents: {
          where: { from: { in: WAITING_COLUMNS } },
          orderBy: [{ timestamp: "desc" }, { id: "desc" }],
          take: 1,
          select: { timestamp: true },
        },
        comments: {
          where: {
            activity: { equals: Prisma.DbNull },
            OR: [
              { creatorId: VALENTIN_USER_ID, agentId: null, agentDisplayName: null },
              {
                AND: [
                  { OR: [{ agentId: { not: null } }, { agentDisplayName: { not: null } }] },
                  { OR: [
                    { text: { contains: "question", mode: "insensitive" } },
                    { commentText: { contains: "question:", mode: "insensitive" } },
                  ] },
                ],
              },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            text: true,
            commentText: true,
            creatorId: true,
            agentId: true,
            agentDisplayName: true,
            createdAt: true,
            reactions: {
              where: {
                userId: VALENTIN_USER_ID,
                agentId: null,
                agentDisplayName: null,
                isDeleted: false,
              },
              select: { emoji: true, createdAt: true, updatedAt: true },
            },
          },
        },
      },
    });
    const updated: { id: number; projectId: number }[] = [];
    for (const task of tasks) {
      if (task.waitingOnUserId !== null && task.waitingOnUserId !== VALENTIN_USER_ID) continue;
      const inWaitingColumn = task.status === "Normal" && WAITING_COLUMNS.includes(task.section);
      const question = task.comments.find((comment) =>
        (comment.agentId || comment.agentDisplayName) &&
        [comment.text, comment.commentText].some((text) =>
          isQuestionComment(text) || isQuestionComment((text ?? "")
            .replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, "\n")
            .replace(/<[^<>]*>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/^\s*@?Valentin(?:\s+Yeo)?\s+(?=Question:)/gim, "")),
        ),
      );
      const explicitWaitSetAt = task.waitingOnSetById !== null ? task.waitingOnSetAt : null;
      const answered = question && (
        task.comments.some((comment) =>
          comment.creatorId === VALENTIN_USER_ID && !comment.agentId && !comment.agentDisplayName &&
          (!explicitWaitSetAt || comment.createdAt >= explicitWaitSetAt) &&
          (comment.createdAt > question.createdAt ||
            (comment.createdAt.getTime() === question.createdAt.getTime() && comment.id > question.id)),
        ) || question.reactions.some((reaction) =>
          /^👍[\u{1f3fb}-\u{1f3ff}]?$/u.test(reaction.emoji) &&
          (!explicitWaitSetAt || (reaction.updatedAt ?? reaction.createdAt) >= explicitWaitSetAt) &&
          (reaction.updatedAt ?? reaction.createdAt) > question.createdAt,
        )
      );
      const shouldWait = inWaitingColumn && !answered;
      if (shouldWait === (task.waitingOnUserId === VALENTIN_USER_ID)) continue;
      const departure = task.sectionEvents[0];
      if (!inWaitingColumn && !answered && task.waitingOnSetById !== null &&
        (!departure || (explicitWaitSetAt && departure.timestamp < explicitWaitSetAt))) continue;
      await tx.task.update({
        where: { id: task.id },
        data: shouldWait
          ? { waitingOnUserId: VALENTIN_USER_ID, waitingOnSetById: null, waitingOnSetAt: new Date() }
          : { waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null },
      });
      updated.push({ id: task.id, projectId: task.projectId });
    }
    return updated;
  }, { isolationLevel: "Serializable", timeout: 20_000 });

  for (const projectId of new Set(changed.map((task) => task.projectId))) {
    void broadcastBoardChange(projectId);
  }
  for (const task of changed) {
    void broadcastTaskChange(task.id);
  }
  if (changed.length) {
    void broadcastInboxChange(VALENTIN_USER_ID);
  }
  return changed.length;
}
