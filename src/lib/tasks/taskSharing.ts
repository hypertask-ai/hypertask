import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8216_AGENT_TASK_SHARE_FLAG } from "@/lib/flags/definitions/htpr-8216-agent-task-share";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

const baseURL = process.env.NEXT_PUBLIC_BASEURL || "https://app.hypertask.ai";

export const shareLinkFor = (shareId: string) => `${baseURL}/share?id=${shareId}`;

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
  if (!(await isFeatureEnabled(HTPR_8216_AGENT_TASK_SHARE_FLAG, currentUser.id))) {
    return { status: 404, body: { message: "Ticket sharing is not enabled" } };
  }

  const task = await loadTask({ taskId, currentUser, agentId, teamScope });
  if (!task) {
    return { status: 404, body: { message: "Task not found, or you cannot share it" } };
  }
  if (task.status === "Deleted" || task.project.status !== "Normal") {
    return { status: 403, body: { message: "This board does not allow sharing a ticket" } };
  }

  const existing = await prisma.taskSharing.findFirst({
    where: { taskId: task.id, userId: currentUser.id },
    select: { id: true, shareType: true, expired: true, expiredAt: true },
  });
  const live = existing && !existing.expired && !(existing.expiredAt && existing.expiredAt <= new Date())
    ? existing
    : null;
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

  const share = await prisma.taskSharing.findFirst({
    where: { taskId: task.id, userId: currentUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, shareType: true, expired: true, expiredAt: true },
  });
  const isPublic = Boolean(
    share &&
      !share.expired &&
      !(share.expiredAt && share.expiredAt <= new Date()) &&
      task.status !== "Deleted"
  );

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
