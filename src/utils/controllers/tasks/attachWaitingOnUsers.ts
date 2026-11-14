import prisma from "@/lib/prisma";
import {
  presentWaitingAgent,
  type WaitingAgentRecord,
} from "@/lib/tasks/waitingAgentPrivacy";

export type WaitingOnUserSummary = {
  id: number;
  displayName: string | null;
  photoURL: string | null;
};

type TaskWithWaitingOnUserId = {
  waitingOnUserId?: number | null;
  waitingOnAgentId?: string | null;
  projectId?: number;
};

export const attachWaitingOnUsers = async <T extends TaskWithWaitingOnUserId>(
  tasks: T[],
  viewerUserId?: number,
): Promise<Array<T & { waitingOnUser: WaitingOnUserSummary | null }>> => {
  const userIds = [
    ...new Set(
      tasks.flatMap((task) =>
        task.waitingOnUserId == null ? [] : [task.waitingOnUserId],
      ),
    ),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, photoURL: true },
      })
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  const withUsers = tasks.map((task) => ({
    ...task,
    waitingOnUser:
      task.waitingOnUserId == null
        ? null
        : (usersById.get(task.waitingOnUserId) ?? null),
  }));
  if (viewerUserId == null) return withUsers;
  const agentIds = [
    ...new Set(
      withUsers.flatMap((task) => (task.waitingOnAgentId ? [task.waitingOnAgentId] : [])),
    ),
  ];
  if (agentIds.length === 0) return withUsers;
  const projectIds = [
    ...new Set(
      withUsers.flatMap((task) => (task.projectId == null ? [] : [task.projectId])),
    ),
  ];
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: {
      id: true,
      displayName: true,
      photoURL: true,
      userId: true,
      visibility: true,
      members: {
        where: { projectId: { in: projectIds }, status: "Accepted" },
        select: { projectId: true },
      },
    },
  });
  const agentsById = new Map(agents.map((agent) => [agent.id, agent as WaitingAgentRecord]));
  return withUsers.map((task) => presentWaitingAgent(task, agentsById, viewerUserId));
};
