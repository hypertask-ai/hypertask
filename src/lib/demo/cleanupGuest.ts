import prisma from "@/lib/prisma";
import { deletePageFromTurbopuffer } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { googleCalendarDisconnectData } from "@/lib/googleCalendar/connection";

import { GUEST_UID_PREFIX } from "./guest";

export const GUEST_MAX_AGE_HOURS = 24;

async function deleteRemainingTaskChildren(taskIds: number[]): Promise<void> {
  const inTasks = { in: taskIds };
  await prisma.drafts.deleteMany({ where: { taskId: inTasks } });
  await prisma.task_Summary.deleteMany({ where: { taskId: inTasks } });
  await prisma.customFieldValue.deleteMany({ where: { taskId: inTasks } });
  await prisma.readStatus.deleteMany({ where: { taskId: inTasks } });
  await prisma.attachment.deleteMany({ where: { taskId: inTasks } });
  await prisma.taskRelations.deleteMany({
    where: { OR: [{ sourceTaskId: inTasks }, { targetTaskId: inTasks }] },
  });
}

export async function deleteGuestProjectCascade(
  projectId: number,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    relationLoadStrategy: "join",
    select: { owner: { select: { uid: true } } },
  });
  if (!project) return;

  if (!project.owner.uid?.startsWith(GUEST_UID_PREFIX)) {
    throw new Error(
      `refusing to cascade-delete non-guest project ${projectId}`,
    );
  }

  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { id: true },
  });
  const taskIds = tasks.map((task) => task.id);

  await deleteRemainingTaskChildren(taskIds);

  await prisma.reaction.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.savedContent.deleteMany({ where: { projectId } });
  await prisma.comment.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.description.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.assignees.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.taskLabel.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.notification.deleteMany({ where: { projectId } });
  await prisma.taskReadState.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.follower.deleteMany({ where: { taskId: { in: taskIds } } });

  await prisma.priority.deleteMany({
    where: { OR: [{ projectId }, { taskId: { in: taskIds } }] },
  });
  await prisma.estimate.deleteMany({
    where: { OR: [{ projectId }, { taskId: { in: taskIds } }] },
  });
  await prisma.reminder.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.timeEntry.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.taskSharing.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.taskMute.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.invite.deleteMany({ where: { projectId } });

  const pages = await prisma.page.findMany({ where: { projectId }, select: { id: true } });
  await prisma.page.deleteMany({ where: { projectId } });
  await Promise.all(pages.map(({ id }) => deletePageFromTurbopuffer(id).catch((error) => {
    console.error("Page index cleanup failed for guest board", error);
  })));
  await prisma.task.deleteMany({ where: { projectId } });
  await prisma.label.deleteMany({ where: { projectId } });

  await prisma.project_View.updateMany({
    where: { projectId },
    data: { default_view_id: null },
  });
  await prisma.view_Last_Used.deleteMany({
    where: { view: { project_view: { projectId } } },
  });
  await prisma.user_Project_View.deleteMany({
    where: { project_view: { projectId } },
  });
  await prisma.view.deleteMany({
    where: { project_view: { projectId } },
  });
  await prisma.project_View.deleteMany({ where: { projectId } });

  await prisma.section.deleteMany({ where: { projectId } });
  await prisma.member.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
}

export async function deleteGuestCascade(userId: number): Promise<void> {
  const guest = await prisma.user.findUnique({
    where: { id: userId },
    select: { uid: true },
  });
  if (!guest?.uid?.startsWith(GUEST_UID_PREFIX)) {
    throw new Error(`refusing to cascade-delete non-guest user ${userId}`);
  }

  const projects = await prisma.project.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  const teams = await prisma.team.findMany({
    where: { googleAccount: { userId } },
    select: { id: true },
  });
  const teamIds = teams.map((team) => team.id);

  for (const project of projects) {
    await deleteGuestProjectCascade(project.id);
  }

  const tasks = await prisma.task.findMany({
    where: { userId },
    select: { id: true },
  });
  const taskIds = tasks.map((task) => task.id);

  await deleteRemainingTaskChildren(taskIds);

  await prisma.reaction.deleteMany({
    where: { OR: [{ userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.savedContent.deleteMany({
    where: { userId },
  });
  await prisma.comment.deleteMany({
    where: { OR: [{ creatorId: userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.description.deleteMany({
    where: { OR: [{ creatorId: userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.assignees.deleteMany({
    where: {
      OR: [{ userId }, { assignerId: userId }, { taskId: { in: taskIds } }],
    },
  });
  await prisma.taskLabel.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.notification.deleteMany({
    where: { OR: [{ userId }, { fromUserId: userId }] },
  });
  await prisma.user_Notification_Invites.deleteMany({ where: { userId } });
  await prisma.taskReadState.deleteMany({
    where: { OR: [{ userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.readStatus.deleteMany({ where: { userId } });
  await prisma.follower.deleteMany({
    where: { OR: [{ userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.drafts.deleteMany({ where: { userId } });
  await prisma.chatSession.deleteMany({ where: { userId } });
  await prisma.logs.deleteMany({ where: { LoggedById: userId } });
  await prisma.subscribedDevices.deleteMany({ where: { userId } });
  await prisma.userAnnouncement.deleteMany({ where: { userId } });

  await prisma.priority.deleteMany({
    where: {
      OR: [{ addedByUserId: userId }, { taskId: { in: taskIds } }],
    },
  });
  await prisma.estimate.deleteMany({
    where: {
      OR: [{ addedByUserId: userId }, { taskId: { in: taskIds } }],
    },
  });
  await prisma.reminder.deleteMany({
    where: { OR: [{ userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.timeEntry.deleteMany({
    where: { OR: [{ userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.taskSharing.deleteMany({
    where: { OR: [{ userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.taskMute.deleteMany({
    where: { OR: [{ userId }, { taskId: { in: taskIds } }] },
  });
  await prisma.invite.deleteMany({
    where: { userId },
  });

  await prisma.task.deleteMany({ where: { userId } });

  await prisma.view_Last_Used.deleteMany({ where: { userId } });
  await prisma.user_Project_View.deleteMany({ where: { userId } });
  await prisma.view.deleteMany({ where: { userId } });
  await prisma.calendar_View.deleteMany({ where: { userId } });
  await prisma.member.deleteMany({ where: { userId } });

  await prisma.member_Team.deleteMany({
    where: { OR: [{ userId }, { teamId: { in: teamIds } }] },
  });
  await prisma.team_Activity.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });

  const agents = await prisma.agent.findMany({
    where: { userId },
    select: { id: true },
  });
  const agentIds = agents.map((agent) => agent.id);
  if (agentIds.length > 0) {
    await prisma.notification.deleteMany({
      where: {
        OR: [{ agentId: { in: agentIds } }, { fromAgentId: { in: agentIds } }],
      },
    });
    await prisma.chatSession.deleteMany({
      where: { agentId: { in: agentIds } },
    });
    await prisma.taskLease.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.aiUsage.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.member.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { UserSettingId: null, accountId: null },
  });
  await prisma.userSetting.deleteMany({ where: { userId } });
  await prisma.userPicture.deleteMany({ where: { userId } });
  await prisma.user_Activity.deleteMany({ where: { userId } });
  await prisma.googleAccount.deleteMany({ where: { userId } });

  await prisma.googleCalendarConnection.updateMany({
    where: { userId },
    data: googleCalendarDisconnectData(),
  });

  await prisma.user.delete({ where: { id: userId } });
}

export async function findStaleGuestIds(
  maxAgeHours: number = GUEST_MAX_AGE_HOURS,
  limit = 200,
): Promise<number[]> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const guests = await prisma.user.findMany({
    where: {
      uid: { startsWith: GUEST_UID_PREFIX },
      email: { endsWith: "@demo.hypertask.ai" },
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
    take: limit,
  });
  return guests.map((guest) => guest.id);
}
