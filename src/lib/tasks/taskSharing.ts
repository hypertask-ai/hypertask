import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

const baseURL = process.env.NEXT_PUBLIC_BASEURL || "https://app.hypertask.ai";

export const shareLinkFor = (shareId: string) => `${baseURL}/share?id=${shareId}`;

const liveShareWhere = (taskId: number, userId?: number) => ({
  taskId,
  ...(userId == null ? {} : { userId }),
  expired: false,
  OR: [{ expiredAt: null }, { expiredAt: { gt: new Date() } }],
});

const loadTask = ({
  taskId,
  currentUser,
  agentId,
  teamScope,
}: {
  taskId: number;
  currentUser: { id: number };
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
}) =>
  prisma.task.findFirst({
    where: {
      id: taskId,
      project: agentId || teamScope
        ? { AND: [getProjectWhere(currentUser.id), getProjectWhere(currentUser.id, agentId, teamScope)] }
        : getProjectWhere(currentUser.id),
    },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      projectId: true,
      project: { select: { status: true } },
    },
  });

export async function shareTaskWithLink({
  taskId,
  currentUser,
  agentId,
  teamScope,
}: {
  taskId: number;
  currentUser: { id: number };
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
}) {
  const task = await loadTask({ taskId, currentUser, agentId, teamScope });
  if (!task) {
    return { status: 404, body: { message: "Task not found, or you cannot share it" } };
  }
  if (task.status === "Deleted" || task.project.status !== "Normal") {
    return { status: 403, body: { message: "This board does not allow sharing a ticket" } };
  }

  const live = await prisma.taskSharing.findFirst({
    where: liveShareWhere(task.id, currentUser.id),
    orderBy: { createdAt: "desc" },
    select: { id: true, shareType: true },
  });
  const share = live ?? await prisma.taskSharing.create({
    data: { taskId: task.id, userId: currentUser.id, projectId: task.projectId },
    select: { id: true, shareType: true },
  });

  return {
    status: 200,
    body: {
      taskId: task.id,
      ticketNumber: task.ticketNumber,
      isPublic: true,
      link: shareLinkFor(share.id),
      shareType: share.shareType,
    },
  };
}

export async function readTaskShare({
  taskId,
  currentUser,
  agentId,
  teamScope,
}: {
  taskId: number;
  currentUser: { id: number };
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
}) {
  const task = await loadTask({ taskId, currentUser, agentId, teamScope });
  if (!task) {
    return { status: 404, body: { message: "Task not found, or you cannot read its sharing" } };
  }

  const ownLive = await prisma.taskSharing.findFirst({
    where: liveShareWhere(task.id, currentUser.id),
    orderBy: { createdAt: "desc" },
    select: { id: true, shareType: true },
  });
  const live = ownLive ?? await prisma.taskSharing.findFirst({
    where: liveShareWhere(task.id),
    orderBy: { createdAt: "desc" },
    select: { id: true, shareType: true },
  });
  const share = live ?? await prisma.taskSharing.findFirst({
    where: { taskId: task.id, userId: currentUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, shareType: true },
  });
  const isPublic = Boolean(live && task.status !== "Deleted");

  return {
    status: 200,
    body: {
      taskId: task.id,
      ticketNumber: task.ticketNumber,
      isPublic,
      link: share ? shareLinkFor(share.id) : null,
      shareType: share?.shareType ?? null,
    },
  };
}
