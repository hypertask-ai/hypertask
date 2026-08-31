import type { Prisma, Status } from "@prisma/client";

import { PriorityConstants } from "@/lib/constants/constants";
import { slackAccessibleProjectWhere } from "@/lib/slack/projectScope";
import { taskMcpGetInclude, mapTaskToMcpGetResponse } from "@/lib/mcp/tasks/mappers";
import { resolveLabelIds, setTaskLabels } from "@/lib/mcp/tasks/services";
import prisma from "@/lib/prisma";
import {
  broadcastBoardChange,
  broadcastInboxChange,
  broadcastTaskChange,
  broadcastTaskComment,
} from "@/lib/realtime/server";
import {
  confirmBlock,
  errorBlock,
  inboxList,
  projectList,
  taskCard,
  taskList,
  type SlackBlock,
  type SlackInboxView,
  type SlackProjectView,
  type SlackTaskView,
} from "@/lib/slack/blocks";
import type { SlackActor } from "@/lib/slack/userLink";
import { cancelDueDateJob, scheduleDueDateJob } from "@/pages/api/queues/duedateQueue";
import scheduleTaskSummaryGeneration from "@/pages/api/queues/FAST/generateSummary";
import createArchiveActivity from "@/utils/controllers/activities/createArchiveActivity";
import createPriorityActivity from "@/utils/controllers/activities/CreatePriorityActivity";
import createTaskDueDateActivity from "@/utils/controllers/activities/createTaskDueDateActivity";
import assigneesAssign from "@/utils/controllers/assignees/assign";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { createFollowerService } from "@/utils/controllers/followers/createFollowerService";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { broadcastInboxForTask } from "@/utils/controllers/notifications/broadcastInboxForTask";
import notificationGetAll from "@/utils/controllers/notifications/getAll";
import { turbopufferSearchTaskIds } from "@/utils/controllers/search/document";
import { createTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { upsertTaskToTurbopuffer } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { persistUrlsForComment } from "@/utils/controllers/urls/extractUrlsFromContent";
import { markdownToHtml } from "@/utils/helperFunctions/markdownToHtml";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import generateRank from "@/utils/generateRank";
import type { IUser } from "@/models/model";

export type SlackAction =
  | { action: "create_task"; params: Record<string, unknown> }
  | { action: "get_task"; params: Record<string, unknown> }
  | { action: "list_tasks"; params: Record<string, unknown> }
  | { action: "search_tasks"; params: Record<string, unknown> }
  | { action: "move_task"; params: Record<string, unknown> }
  | { action: "add_comment"; params: Record<string, unknown> }
  | { action: "assign_user"; params: Record<string, unknown> }
  | { action: "add_follower"; params: Record<string, unknown> }
  | { action: "remove_follower"; params: Record<string, unknown> }
  | { action: "update_task"; params: Record<string, unknown> }
  | { action: "list_projects"; params: Record<string, unknown> }
  | { action: "list_sections"; params: Record<string, unknown> }
  | { action: "list_inbox"; params: Record<string, unknown> }
  | { action: "archive_inbox"; params: Record<string, unknown> };

export async function executeSlackAction(
  actor: SlackActor,
  command: SlackAction,
): Promise<SlackBlock[]> {
  switch (command.action) {
    case "create_task":
      return createTask(actor, command.params);
    case "get_task":
      return getTask(actor, requiredString(command.params.ticket, "Ticket number"));
    case "list_tasks":
      return listTasks(actor, command.params);
    case "search_tasks":
      return searchTasks(
        actor,
        requiredString(command.params.query, "Search query"),
        optionalString(command.params.project),
      );
    case "move_task":
      return moveTask(
        actor,
        requiredString(command.params.ticket, "Ticket number"),
        requiredString(command.params.section, "Section"),
      );
    case "add_comment":
      return addComment(
        actor,
        requiredString(command.params.ticket, "Ticket number"),
        requiredString(command.params.content, "Comment"),
      );
    case "assign_user":
      return assignUser(
        actor,
        requiredString(command.params.ticket, "Ticket number"),
        requiredString(command.params.username, "User"),
      );
    case "add_follower":
      return addFollower(actor, command.params, false);
    case "remove_follower":
      return addFollower(actor, command.params, true);
    case "update_task":
      return updateTask(actor, command.params);
    case "list_projects":
      return listProjects(actor);
    case "list_sections":
      return listSections(
        actor,
        requiredString(command.params.project, "Project"),
      );
    case "list_inbox":
      return listInbox(actor, optionalNumber(command.params.limit) ?? 20);
    case "archive_inbox":
      return archiveInbox(
        actor,
        requiredPositiveInt(command.params.notificationId, "Notification ID"),
      );
  }
}

async function createTask(
  actor: SlackActor,
  params: Record<string, unknown>,
): Promise<SlackBlock[]> {
  const title = requiredString(params.title, "Title");
  const projectRef = requiredString(params.project, "Project");
  const project = await resolveProject(actor, projectRef);
  if (!project) return errorBlock(`Project "${projectRef}" not found.`);
  if (!project.uniqueIdentifier) {
    return errorBlock(`Project "${projectRef}" cannot create numbered tasks.`);
  }

  const sectionRef = optionalString(params.section);
  const section = sectionRef
    ? await resolveSection(project.id, sectionRef)
    : await prisma.section.findFirst({
        where: { projectId: project.id, deleted: false, visibility: true },
        orderBy: { ranking: "asc" },
        select: { id: true, section_title: true },
      });
  if (!section) {
    return errorBlock(
      sectionRef
        ? `Section "${sectionRef}" not found in ${project.title}.`
        : `No active section is available in ${project.title}.`,
    );
  }

  const dueDate = parseOptionalDate(params.dueDate);
  const priorityIndex = priorityToIndex(optionalString(params.priority));
  const activityUser = toActivityUser(actor);
  const description = optionalString(params.description);
  const result = await createTaskCore({
    title,
    description: description ? toStoredHtml(description) : "",
    userId: actor.user.id,
    projectId: project.id,
    sectionId: section.id,
    sectionTitle: section.section_title,
    projectIdentifier: project.uniqueIdentifier,
    priorityIndex,
    dueDate,
  });

  const labels = optionalStringArray(params.labels);
  if (labels.length) await setTaskLabels(result.task.id, project.id, labels, actor.user);

  const assigneeRef = optionalString(params.assignee);
  if (assigneeRef) {
    const assignee = await resolveProjectUser(actor, project.id, assigneeRef);
    if (!assignee) {
      return errorBlock(
        `Task ${result.task.ticketNumber} was created, but assignee "${assigneeRef}" was not found in the project.`,
      );
    }
    await assigneesAssign(activityUser, assignee.id, result.task.id, undefined, undefined, {
      intent: "assign",
    });
  }

  if (dueDate) {
    await scheduleDueDateJob({ taskId: result.task.id, projectId: project.id }, dueDate);
  }
  void upsertTaskToTurbopuffer(result.task.id);
  void scheduleTaskSummaryGeneration({ taskId: result.task.id });
  void broadcastBoardChange(project.id, { originUserId: actor.user.id });

  const task = await findTaskById(actor, result.task.id);
  return task
    ? [...confirmBlock("Task created!"), ...taskCard(task)]
    : confirmBlock(`Task ${result.task.ticketNumber} created.`);
}

async function getTask(actor: SlackActor, ticket: string): Promise<SlackBlock[]> {
  const task = await findTask(actor, ticket);
  return task ? taskCard(task) : errorBlock(`Task "${ticket}" not found.`);
}

async function listTasks(
  actor: SlackActor,
  params: Record<string, unknown>,
): Promise<SlackBlock[]> {
  const projectRef = optionalString(params.project);
  const project = projectRef ? await resolveProject(actor, projectRef) : null;
  if (projectRef && !project) return errorBlock(`Project "${projectRef}" not found.`);

  const status = normalizeStatus(optionalString(params.status)) ?? "Normal";
  const assignee = optionalString(params.assignee);
  const priority = optionalString(params.priority);
  const where: Prisma.TaskWhereInput = {
    status,
    project: accessibleProjectWhere(actor),
    ...(project ? { projectId: project.id } : {}),
    ...(optionalString(params.section)
      ? { section: { equals: optionalString(params.section)!, mode: "insensitive" } }
      : {}),
    ...(assignee
      ? assignee.toLowerCase() === "me"
        ? { assignees: { some: { userId: actor.user.id, agentId: null } } }
        : /^\d+$/.test(assignee)
          ? { assignees: { some: { userId: Number(assignee), agentId: null } } }
          : { assignees: { some: { user: { displayName: { equals: assignee, mode: "insensitive" } } } } }
      : {}),
    ...(priority
      ? { priority: { Priority_Value: { equals: priorityTitle(priority), mode: "insensitive" } } }
      : {}),
  };
  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: taskMcpGetInclude,
      orderBy: { updatedAt: "desc" },
      take: clampLimit(params.limit, 20),
    }),
  ]);
  return [headerBlock(`*Tasks:* (${total} found)`), ...taskList(tasks.map(mapSlackTask))];
}

async function searchTasks(
  actor: SlackActor,
  query: string,
  projectRef?: string,
): Promise<SlackBlock[]> {
  const projects = await listAccessibleProjectIds(actor);
  const project = projectRef ? await resolveProject(actor, projectRef) : null;
  if (projectRef && !project) return errorBlock(`Project "${projectRef}" not found.`);
  const projectIds = project ? [project.id] : projects;
  if (!projectIds.length) return [headerBlock(`*Search: "${query}"* (0 found)`), ...taskList([])];

  const ids = await turbopufferSearchTaskIds({
    searchQuery: query,
    projectIds,
    status: "Normal",
    projectId: project?.id,
    perPage: 50,
  });
  const where: Prisma.TaskWhereInput = {
    projectId: { in: projectIds },
    status: "Normal",
    ...(ids.length
      ? { id: { in: ids } }
      : {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { ticketNumber: { contains: query, mode: "insensitive" } },
          ],
        }),
  };
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: taskMcpGetInclude,
      ...(ids.length ? {} : { orderBy: { updatedAt: "desc" as const } }),
      take: 20,
    }),
  ]);
  const tasks = ids.length
    ? ids.map((id) => rows.find((row) => row.id === id)).filter(Boolean).slice(0, 20)
    : rows;
  return [
    headerBlock(`*Search: "${query}"* (${total} found)`),
    ...taskList(tasks.map((task) => mapSlackTask(task!))),
  ];
}

async function moveTask(
  actor: SlackActor,
  ticket: string,
  sectionRef: string,
): Promise<SlackBlock[]> {
  const task = await findTaskRecord(actor, ticket);
  if (!task) return errorBlock(`Task "${ticket}" not found.`);
  const section = await resolveSection(task.projectId, sectionRef);
  if (!section) return errorBlock(`Section "${sectionRef}" not found in ${task.project.title}.`);
  if (task.sectionId === section.id) return confirmBlock(`${task.ticketNumber} is already in ${section.section_title}.`);

  const lastTask = await prisma.task.findFirst({
    where: { projectId: task.projectId, sectionId: section.id, status: "Normal" },
    orderBy: { ranking: "desc" },
    select: { ranking: true },
  });
  const activityUser = toActivityUser(actor);
  const result = await updateTaskSingle(
    {
      id: task.id,
      sectionId: section.id,
      section: section.section_title,
      ranking: generateRank(lastTask?.ranking, undefined),
    },
    activityUser,
    null,
    {
      taskMovedActivity: {
        sendNotification: () =>
          sendNotificationForTask(
            actor.user.id,
            "TaskMoved",
            task.id,
            task.projectId,
          ),
      },
    },
  );
  if (result.status !== 200) throw new Error("Task move failed");
  void broadcastBoardChange(task.projectId, { originUserId: actor.user.id });
  void broadcastTaskChange(task.id, { originUserId: actor.user.id });
  return confirmBlock(`Moved ${task.ticketNumber} to ${section.section_title}.`);
}

async function addComment(
  actor: SlackActor,
  ticket: string,
  content: string,
): Promise<SlackBlock[]> {
  const task = await findTaskRecord(actor, ticket);
  if (!task) return errorBlock(`Task "${ticket}" not found.`);
  const text = toStoredHtml(content);
  const comment = await createCommentService({
    text,
    creatorId: actor.user.id,
    taskId: task.id,
    ownerId: task.userId,
    currentUser: actor.user,
  });
  await persistUrlsForComment(text, task.id, comment.id, "POST");
  void broadcastTaskComment(task.id, { originUserId: actor.user.id });
  return confirmBlock(`Comment added to ${task.ticketNumber}.`);
}

async function assignUser(
  actor: SlackActor,
  ticket: string,
  userRef: string,
): Promise<SlackBlock[]> {
  const task = await findTaskRecord(actor, ticket);
  if (!task) return errorBlock(`Task "${ticket}" not found.`);
  const target = await resolveProjectUser(actor, task.projectId, userRef);
  if (!target) return errorBlock(`User "${userRef}" was not found in ${task.project.title}.`);
  const response = await assigneesAssign(
    toActivityUser(actor),
    target.id,
    task.id,
    undefined,
    undefined,
    { intent: "assign" },
  );
  if (response.status !== 200) {
    return errorBlock((response.json as { message?: string }).message || "Assignment failed.");
  }
  void broadcastBoardChange(task.projectId, { originUserId: actor.user.id });
  return confirmBlock(`Assigned ${target.displayName || target.email} to ${task.ticketNumber}.`);
}

async function addFollower(
  actor: SlackActor,
  params: Record<string, unknown>,
  remove: boolean,
): Promise<SlackBlock[]> {
  const ticket = requiredString(params.ticket, "Ticket number");
  const userRef = requiredString(params.username, "User");
  const task = await findTaskRecord(actor, ticket);
  if (!task) return errorBlock(`Task "${ticket}" not found.`);
  const target = await resolveProjectUser(actor, task.projectId, userRef);
  if (!target) return errorBlock(`User "${userRef}" was not found in ${task.project.title}.`);

  if (remove) {
    await prisma.follower.deleteMany({
      where: { taskId: task.id, userId: target.id, agentId: null },
    });
  } else {
    const result = await createFollowerService({
      userId: target.id,
      taskId: task.id,
      mentionById: actor.user.id,
    });
    if (result.status >= 400) {
      const body = result.body as { message?: string };
      return errorBlock(body.message || "Could not add the follower.");
    }
  }
  void broadcastTaskChange(task.id, { originUserId: actor.user.id });
  return confirmBlock(
    `${remove ? "Removed" : "Added"} ${target.displayName || target.email} ${remove ? "from" : "to"} ${task.ticketNumber} followers.`,
  );
}

async function updateTask(
  actor: SlackActor,
  params: Record<string, unknown>,
): Promise<SlackBlock[]> {
  const ticket = requiredString(params.ticket, "Ticket number");
  const task = await findTaskRecord(actor, ticket);
  if (!task) return errorBlock(`Task "${ticket}" not found.`);
  const activityUser = toActivityUser(actor);
  const patch: Record<string, unknown> = { id: task.id };
  const title = optionalString(params.title);
  const description = optionalString(params.description);
  const status = normalizeWritableStatus(optionalString(params.status));
  const dueDateProvided = params.dueDate !== undefined;
  const dueDate = dueDateProvided ? parseNullableDate(params.dueDate) : undefined;
  if (title) patch.title = title;
  if (description) patch.description = toStoredHtml(description);
  if (status) {
    patch.status = status;
    patch.archivedAt = status === "Archive" ? new Date() : null;
    if (status === "Archive") patch.dueDate = null;
  }
  if (dueDateProvided) patch.dueDate = dueDate;

  const priority = optionalString(params.priority);
  if (Object.keys(patch).length === 1 && priority === undefined) {
    return errorBlock("Provide at least one field to update.");
  }
  if (Object.keys(patch).length > 1) {
    const response = await updateTaskSingle(patch, activityUser);
    if (response.status !== 200) throw new Error("Task update failed");
  }

  if (priority !== undefined) {
    await setPriority(task.id, task.projectId, task.sectionId, priority, activityUser);
  }
  if (status && status !== task.status) {
    if (status === "Archive") await cancelDueDateJob(task.id, task.projectId);
    await createArchiveActivity({
      taskId: task.id,
      fromUserId: actor.user.id,
      fromUserDisplayName: actor.user.displayName ?? "",
      fromUser: activityUser,
      newStatus: status,
    });
    void broadcastInboxForTask(task.id);
    void sendNotificationForTask(actor.user.id, "TaskArchived", task.id, task.projectId);
  }
  if (dueDateProvided) {
    await cancelDueDateJob(task.id, task.projectId);
    if (dueDate) await scheduleDueDateJob({ taskId: task.id, projectId: task.projectId }, dueDate);
    await createTaskDueDateActivity({
      userObj: activityUser,
      taskId: task.id,
      toDueDate: dueDate ?? undefined,
      fromDueDate: task.dueDate ?? undefined,
    });
    void sendNotificationForTask(actor.user.id, "TaskDueDate", task.id, task.projectId);
  }
  void broadcastBoardChange(task.projectId, { originUserId: actor.user.id });
  void broadcastTaskChange(task.id, { originUserId: actor.user.id });
  return confirmBlock(`Updated ${task.ticketNumber}.`);
}

async function listProjects(actor: SlackActor): Promise<SlackBlock[]> {
  const projects = await prisma.project.findMany({
    where: accessibleProjectWhere(actor),
    orderBy: { title: "asc" },
    take: 50,
    select: {
      title: true,
      section: {
        where: { deleted: false, visibility: true },
        orderBy: { ranking: "asc" },
        select: { section_title: true },
      },
      _count: { select: { members: true, tasks: { where: { status: "Normal" } } } },
    },
  });
  const mapped: SlackProjectView[] = projects.map((project) => ({
    title: project.title,
    memberCount: project._count.members,
    taskCount: project._count.tasks,
    sections: project.section,
  }));
  return [headerBlock(`*Projects:* (${mapped.length} found)`), ...projectList(mapped)];
}

async function listSections(
  actor: SlackActor,
  projectRef: string,
): Promise<SlackBlock[]> {
  const project = await resolveProject(actor, projectRef);
  if (!project) return errorBlock(`Project "${projectRef}" not found.`);
  const sections = await prisma.section.findMany({
    where: { projectId: project.id, deleted: false, visibility: true },
    orderBy: { ranking: "asc" },
    select: { id: true, section_title: true },
  });
  const counts = await Promise.all(
    sections.map((section) =>
      prisma.task.count({
        where: { projectId: project.id, sectionId: section.id, status: "Normal" },
      }),
    ),
  );
  return [
    headerBlock(
      `*Sections in ${project.title}:*\n${sections
        .map((section, index) => `• ${section.section_title} (${counts[index]} tasks)`)
        .join("\n") || "No sections found."}`,
    ),
  ];
}

async function listInbox(actor: SlackActor, limit: number): Promise<SlackBlock[]> {
  const [result, accessibleProjectIds] = await Promise.all([
    notificationGetAll(String(actor.user.id)),
    listAccessibleProjectIds(actor),
  ]);
  const accessibleProjects = new Set(accessibleProjectIds);
  const notifications =
    result.status === 200 && result.json && "notifications" in result.json
      ? (result.json.notifications as SlackInboxView[])
          .filter(
            (notification) =>
              notification.task &&
              accessibleProjects.has(notification.task.projectId) &&
              notification.project &&
              "teamId" in notification.project &&
              notification.project.teamId === actor.teamId,
          )
          .slice(0, Math.min(limit, 20))
      : [];
  return [
    headerBlock(`*Inbox:* (${notifications.length} notifications)`),
    ...inboxList(notifications),
  ];
}

async function archiveInbox(actor: SlackActor, notificationId: number): Promise<SlackBlock[]> {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      userId: actor.user.id,
      project: accessibleProjectWhere(actor),
    },
    select: { id: true, taskId: true },
  });
  if (!notification) return errorBlock("Notification not found or access denied.");
  if (notification.taskId) {
    await prisma.notification.updateMany({
      where: {
        id: { not: notification.id },
        taskId: notification.taskId,
        userId: actor.user.id,
        status: { not: "Deleted" },
      },
      data: { status: "Deleted" },
    });
  }
  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: "Archive", archivedAt: new Date() },
  });
  void broadcastInboxChange(actor.user.id, { originUserId: actor.user.id });
  return confirmBlock("Notification archived.");
}

async function setPriority(
  taskId: number,
  projectId: number,
  sectionId: number | null,
  value: string,
  user: IUser,
): Promise<void> {
  const priorityIndex = priorityToIndex(value);
  const constant = PriorityConstants.find((item) => item.priority_index === priorityIndex)!;
  const previous = await prisma.priority.findUnique({ where: { taskId } });
  if (priorityIndex === 0) {
    await prisma.priority.deleteMany({ where: { taskId } });
  } else {
    await prisma.priority.upsert({
      where: { taskId },
      create: {
        taskId,
        projectId,
        sectionId: sectionId ?? -1,
        addedByUserId: user.id,
        priority_index: priorityIndex,
        Priority_Value: constant.Priority_Value,
      },
      update: {
        addedByUserId: user.id,
        priority_index: priorityIndex,
        Priority_Value: constant.Priority_Value,
      },
    });
  }
  await createPriorityActivity({
    userObj: user,
    taskId,
    toPriority: {
      priority_index: priorityIndex,
      Priority_Value: constant.Priority_Value,
    },
    ...(previous
      ? {
          fromPriority: {
            priority_index: previous.priority_index,
            Priority_Value: previous.Priority_Value,
          },
        }
      : {}),
  });
}

async function resolveProject(actor: SlackActor, reference: string) {
  const numericId = /^\d+$/.test(reference.trim()) ? Number(reference) : null;
  return prisma.project.findFirst({
    where: {
      ...accessibleProjectWhere(actor),
      ...(numericId
        ? { id: numericId }
        : {
            OR: [
              { title: { equals: reference, mode: "insensitive" } },
              { name: { equals: reference, mode: "insensitive" } },
            ],
          }),
    },
    select: { id: true, title: true, uniqueIdentifier: true },
  });
}

function accessibleProjectWhere(actor: SlackActor): Prisma.ProjectWhereInput {
  return slackAccessibleProjectWhere(actor.teamId, actor.user.id);
}

async function listAccessibleProjectIds(actor: SlackActor): Promise<number[]> {
  return (
    await prisma.project.findMany({
      where: accessibleProjectWhere(actor),
      select: { id: true },
    })
  ).map((project) => project.id);
}

async function resolveSection(projectId: number, reference: string) {
  const numericId = /^\d+$/.test(reference.trim()) ? Number(reference) : null;
  return prisma.section.findFirst({
    where: {
      projectId,
      deleted: false,
      ...(numericId
        ? { id: numericId }
        : { section_title: { equals: reference, mode: "insensitive" } }),
    },
    select: { id: true, section_title: true },
  });
}

async function findTask(actor: SlackActor, ticket: string): Promise<SlackTaskView | null> {
  const task = await findTaskRecord(actor, ticket, true);
  return task ? mapSlackTask(task) : null;
}

async function findTaskById(actor: SlackActor, taskId: number): Promise<SlackTaskView | null> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, project: accessibleProjectWhere(actor) },
    include: taskMcpGetInclude,
  });
  return task ? mapSlackTask(task) : null;
}

async function findTaskRecord(actor: SlackActor, ticket: string, full = false): Promise<any | null> {
  const reference = ticket.trim();
  const numericIndex = /^\d+$/.test(reference) ? Number(reference) : null;
  const where: Prisma.TaskWhereInput = {
    status: { not: "Deleted" },
    project: accessibleProjectWhere(actor),
    ...(numericIndex
      ? { uniqueIndex: numericIndex }
      : { ticketNumber: { equals: reference, mode: "insensitive" } }),
  };
  if (full) {
    return prisma.task.findFirst({ where, include: taskMcpGetInclude });
  }
  return prisma.task.findFirst({
    where,
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      userId: true,
      projectId: true,
      sectionId: true,
      section: true,
      status: true,
      dueDate: true,
      project: { select: { title: true } },
    },
  });
}

async function resolveProjectUser(
  actor: SlackActor,
  projectId: number,
  reference: string,
) {
  if (reference.toLowerCase() === "me") return actor.user;
  const slackMention = reference.match(/^<@([A-Z0-9]+)>$/i)?.[1];
  if (slackMention) {
    const linked = await prisma.slackUserLink.findUnique({
      where: {
        installId_slackUserId: { installId: actor.installId, slackUserId: slackMention },
      },
      select: { user: { select: { id: true, email: true, displayName: true, photoURL: true } } },
    });
    if (linked && (await isProjectMember(projectId, linked.user.id))) return linked.user;
    return null;
  }

  const memberIds = await projectMemberIds(projectId);
  const numericId = /^\d+$/.test(reference) ? Number(reference) : null;
  const users = await prisma.user.findMany({
    where: {
      id: numericId ? numericId : { in: memberIds },
      ...(numericId
        ? {}
        : {
            OR: [
              { email: { equals: reference, mode: "insensitive" } },
              { displayName: { equals: reference, mode: "insensitive" } },
            ],
          }),
    },
    select: { id: true, email: true, displayName: true, photoURL: true },
  });
  const allowed = users.filter((user) => memberIds.includes(user.id));
  return allowed.length === 1 ? allowed[0] : null;
}

async function projectMemberIds(projectId: number): Promise<number[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { where: { agentId: null }, select: { userId: true } } },
  });
  return project
    ? [...new Set([project.ownerId, ...project.members.map((member) => member.userId)])]
    : [];
}

async function isProjectMember(projectId: number, userId: number): Promise<boolean> {
  return (await projectMemberIds(projectId)).includes(userId);
}

function mapSlackTask(task: any): SlackTaskView {
  const mapped = mapTaskToMcpGetResponse(task);
  return {
    boardTitle: mapped.boardTitle,
    commentCount: mapped.totalComments,
    dueDate: mapped.dueDate,
    priority: mapped.priority,
    projectId: mapped.projectId,
    section: mapped.section,
    status: mapped.status,
    ticketNumber: mapped.ticketNumber,
    title: mapped.title,
    uniqueIndex: mapped.uniqueIndex,
  };
}

function toActivityUser(actor: SlackActor): IUser {
  return {
    ...actor.user,
    uid: "",
    joinedAt: new Date(),
    stripe_customer_id: "",
    UserSettingId: "",
    UserSetting: {} as IUser["UserSetting"],
    photoURL: actor.user.photoURL ?? undefined,
    displayName: actor.user.displayName ?? undefined,
  } as IUser;
}

function toStoredHtml(value: string): string {
  return sanitizeRichHtml(markdownToHtml(value));
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function optionalNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function requiredPositiveInt(value: unknown, label: string): number {
  const number = optionalNumber(value);
  if (!number || !Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function clampLimit(value: unknown, fallback: number): number {
  const number = optionalNumber(value);
  return Math.min(Math.max(Math.floor(number ?? fallback), 1), 20);
}

function priorityToIndex(value?: string): number {
  if (!value) return 0;
  const normalized = value.trim().toLowerCase();
  const match = PriorityConstants.find(
    (priority) => priority.Priority_Value.toLowerCase() === normalized,
  );
  if (!match) throw new Error("Priority must be low, medium, high, urgent, or no priority.");
  return match.priority_index;
}

function priorityTitle(value: string): string {
  const index = priorityToIndex(value);
  return PriorityConstants.find((priority) => priority.priority_index === index)!.Priority_Value;
}

function normalizeStatus(value?: string): Status | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "normal") return "Normal";
  if (normalized === "archive" || normalized === "archived") return "Archive";
  if (normalized === "deleted") return "Deleted";
  throw new Error("Status must be Normal, Archive, or Deleted.");
}

function normalizeWritableStatus(value?: string): Status | undefined {
  const status = normalizeStatus(value);
  if (status === "Deleted") {
    throw new Error("Slack can only set task status to Normal or Archive.");
  }
  return status;
}

function parseOptionalDate(value: unknown): Date | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid due date: "${raw}".`);
  return date;
}

function parseNullableDate(value: unknown): Date | null {
  if (value === null || value === "") return null;
  const raw = requiredString(value, "Due date");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid due date: "${raw}".`);
  return date;
}

function headerBlock(text: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}
