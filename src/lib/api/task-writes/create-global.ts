import { taskWriterDueDateForSave } from "@/lib/ai/taskWriterDueDate";
import { HTPR_7054_CTRLJ_DUE_DATE_FLAG } from "@/lib/flags/keys";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseCookies } from "better-auth/cookies";
import { Prisma } from "@prisma/client";
import { isEmptyComposeTarget } from "@/lib/ai/composeTaskTarget";
import { isFeatureEnabled, HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG } from "@/lib/flags";
import type { IAgent, ILabel, IUser } from "@/models/model";
import prisma from "@/lib/prisma";
import { getNextUniqueTaskIndex } from "@/utils/controllers/tasks/getNextUniqueTaskIndex";
import { createTaskWithBoardWebhookOutbox } from "@/lib/mcp/webhooks/taskEvents";
import { publishBoardWebhookDeliveries } from "@/lib/mcp/webhooks/outbox";
import { persistAgentTaskCreatedPending } from "@/lib/agentWebhooks/outbox";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { schedulePostCreateWork, persistAssignee, createAssigneeActivityAndNotification, createPriorityActivity, createEstimateAndActivity, getActiveAgentOwnerId, isAgentAssignee, type TaskCreatedGlobally, type NormalizedTaskAssignee } from "./create-global-effects";
import { taskWriteRoute, type TaskWriteRoute } from "./route";

const TASK_UNIQUE_INDEX_ADVISORY_LOCK_CLASS = 9428471;
class TaskSectionValidationError extends Error {}

const route = (requestStartedAt: number) => taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  operation: async (body, session, request) => {
    const responseHeaders = new Headers();
    const {
      title,
      userId: requestedUserId,
      projectId: requestedProjectId,
      ranking,
      section_title,
      sectionId,
      priority,
      estimate,
      dueDate: requestedDueDate,
      startDate,
      tags,
      parentTask,
      parentTaskId,
      description,
      relationsToAdd,
      urlsToAdd,
      assignees,
      createTaskFromComment,
      agentId: requestedAgentId, //Determines if task is created by an agent. If task created by an agent then everything in here is created by an agent
    } = body;
    console.log("🤔 ~ creating task ~ body:", body);
    if (
      requestedUserId != null &&
      Number(requestedUserId) !== session.userId
    ) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: responseHeaders });
    }
    if (body.requestKind === "compose-task" &&
        !(await isFeatureEnabled(HTPR_6929_COMPOSE_TASK_WRITER_FLAG, session.userId))) {
      return NextResponse.json({ message: "Compose task writer is turned off" }, { status: 403, headers: responseHeaders });
    }
    if (body.existingTaskId != null && (body.requestKind !== "compose-task" ||
        !(await isFeatureEnabled(HTPR_6937_NEW_TASK_WINDOW_FLAG, session.userId)))) {
      return NextResponse.json({ message: "New Task window is turned off" }, { status: 403, headers: responseHeaders });
    }
    const projectId = Number(requestedProjectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ message: "Invalid project id" }, { status: 400, headers: responseHeaders });
    }
    const userId = session.userId;
    const currentUserRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, photoURL: true, email: true },
    });
    if (!currentUserRecord) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: responseHeaders });
    }
    const currentUser = currentUserRecord as IUser;
    const signedSession = verifySession(request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));
    const actingAgent = resolveActingAgent({
      sessionAgentId: signedSession?.agentId ?? null,
      bodyAgentId: requestedAgentId,
    });
    if (!actingAgent.ok) {
      return NextResponse.json({ message: actingAgent.message }, { status: actingAgent.status });
    }
    const agentId = actingAgent.agentId;
    if (agentId) {
      const agentOwnerId = await getActiveAgentOwnerId(agentId);
      if (agentOwnerId !== session.userId) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: responseHeaders });
      }
      const { isAgentOnBoard } = await import(
        "@/utils/controllers/agents/boardMembers"
      );
      if (!(await isAgentOnBoard(Number(projectId), agentId))) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: responseHeaders });
      }
    }
    const authorizedProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: "Normal",
        ...taskWriteAccessWhere(userId, agentId),
      },
      select: { id: true },
    });
    if (!authorizedProject) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: responseHeaders });
    }
    const dueDateEnabled = body.requestKind === "compose-task" && body.writerDueDate != null &&
      await isFeatureEnabled(HTPR_7054_CTRLJ_DUE_DATE_FLAG, userId);
    const writerDueDate = dueDateEnabled ? taskWriterDueDateForSave(body.writerDueDate, body.writerTimeZone) : undefined;
    const dueDate = writerDueDate ?? requestedDueDate;
    if (body.existingTaskId != null) {
      const taskId = Number(body.existingTaskId);
      if (!Number.isSafeInteger(taskId) || taskId <= 0) {
        return NextResponse.json({ message: "Invalid task id" }, { status: 400, headers: responseHeaders });
      }
      const target = await prisma.task.findFirst({
        where: { id: taskId, projectId, status: "Normal", project: taskWriteAccessWhere(userId, agentId) },
        include: { description_: { select: { content: true } } },
      });
      if (!target) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: responseHeaders });
      if (!isEmptyComposeTarget(target)) return NextResponse.json({ message: "This task is no longer empty. Your note is still here." }, { status: 409, headers: responseHeaders });
      const { updateTaskSingle } = await import("@/utils/controllers/tasks/single");
      const result = await updateTaskSingle({ id: taskId, title, description,
        ...(writerDueDate ? { dueDate: writerDueDate, dueDateNotifiedAt: null } : {}),
      }, currentUser, agentId, {
        expectedTitle: target.title,
        expectedDescription: target.description_?.content ?? "",
        expectedProjectId: target.projectId,
        expectedStatus: target.status,
      });
      if (result.status !== 200) return NextResponse.json(result.json, { status: result.status, headers: responseHeaders });
      if (writerDueDate) {
        const { cancelDueDateJob, scheduleDueDateJob } = await import("@/pages/api/queues/duedateQueue");
        await cancelDueDateJob(taskId, projectId);
        await scheduleDueDateJob({ taskId, projectId }, writerDueDate);
      }
      const { broadcastBoardChange, broadcastTaskChange } = await import("@/lib/realtime/server");
      await Promise.all([broadcastBoardChange(projectId, { originUserId: userId }), broadcastTaskChange(taskId)]);
      return NextResponse.json({ newTask: result.json }, { status: 200, headers: responseHeaders });
    }
    let tagIds: string[] = [];
    if (tags != null && !Array.isArray(tags)) {
      return NextResponse.json({ message: "Invalid labels" }, { status: 400, headers: responseHeaders });
    }
    if (Array.isArray(tags) && tags.length > 0) {
      const rawTagIds = (tags as ILabel[]).map((tag) => tag?.id);
      if (rawTagIds.some((id) => typeof id !== "string")) {
        return NextResponse.json({ message: "Invalid labels" }, { status: 400, headers: responseHeaders });
      }
      const uniqueTagIds = [...new Set(rawTagIds as string[])];
      tagIds = uniqueTagIds;
      const projectLabels = await prisma.label.findMany({
        where: { id: { in: uniqueTagIds }, projectId },
        select: { id: true },
      });
      const projectLabelIds = new Set(projectLabels.map((label) => label.id));
      const invalidTagIds = uniqueTagIds.filter((id) => !projectLabelIds.has(id));
      if (invalidTagIds.length > 0) {
        return NextResponse.json({
          message: "One or more labels do not belong to this project",
        }, { status: 400, headers: responseHeaders });
      }
    }
    let priorityCreated: any = undefined;
    let estimateCreated: any = undefined;
    let relatedTasks: any = { status: 200, json: [] };
    const normalizedAssignees: NormalizedTaskAssignee[] = [];
    if (assignees && assignees.length > 0) {
      const [{ validateProjectMemberIds }, { isAgentOnBoard }] =
        await Promise.all([
          import("@/lib/mcp/tasks/services"),
          import("@/utils/controllers/agents/boardMembers"),
        ]);
      const assigneeUserIds: number[] = [];
      const agentAssigneeIds: string[] = [];
      let hasInvalidAssignee = false;
      for (const assignee of assignees as (IUser | IAgent)[]) {
        if (isAgentAssignee(assignee)) {
          agentAssigneeIds.push(assignee.id);
          const agentOwnerId = await getActiveAgentOwnerId(assignee.id);
          if (agentOwnerId != null) {
            assigneeUserIds.push(agentOwnerId);
            normalizedAssignees.push({
              userId: agentOwnerId,
              agentId: assignee.id,
            });
          } else {
            hasInvalidAssignee = true;
          }
        } else if (typeof assignee.id === "number") {
          assigneeUserIds.push(assignee.id);
          normalizedAssignees.push({ userId: assignee.id });
        } else {
          hasInvalidAssignee = true;
        }
      }
      if (hasInvalidAssignee) {
        return NextResponse.json({ message: "Invalid assignee payload" }, { status: 400, headers: responseHeaders });
      }
      const memberCheck = await validateProjectMemberIds(
        projectId,
        assigneeUserIds
      );
      if (memberCheck.error) {
        return NextResponse.json({ message: memberCheck.error.message }, { status: memberCheck.error.status });
      }
      if (memberCheck.invalidIds.length > 0) {
        return NextResponse.json({
          message: `User(s) ${memberCheck.invalidIds.join(", ")} are not members of this project and cannot be assigned.`,
        }, { status: 400, headers: responseHeaders });
      }
      for (const assigneeAgentId of agentAssigneeIds) {
        const onBoard = await isAgentOnBoard(projectId, assigneeAgentId);
        if (!onBoard) {
          return NextResponse.json({
            message:
              "Agent is not a member of this board. Add the agent to the board before assigning.",
          }, { status: 400, headers: responseHeaders });
        }
      }
    }
    let normalizedSectionId: number | null = null;
    if (sectionId != null) {
      const isCanonicalSectionId =
        (typeof sectionId === "number" && Number.isSafeInteger(sectionId)) ||
        (typeof sectionId === "string" && /^(?:0|[1-9]\d*)$/.test(sectionId));
      normalizedSectionId = isCanonicalSectionId ? Number(sectionId) : NaN;
    }
    if (
      normalizedSectionId !== null &&
      (!Number.isSafeInteger(normalizedSectionId) || normalizedSectionId <= 0)
    ) {
      return NextResponse.json({ message: "Invalid section" }, { status: 400, headers: responseHeaders });
    }
    let parsedStartDate: Date | null | undefined;
    if (startDate != null) {
      if (startDate instanceof Date) {
        if (Number.isNaN(startDate.getTime())) {
          return NextResponse.json({ message: "Invalid start date" }, { status: 400, headers: responseHeaders });
        }
        parsedStartDate = startDate;
      } else if (typeof startDate === "string") {
        const normalizedStartDate = startDate.trim();
        const dateParts = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(
          normalizedStartDate,
        );
        const calendarDate = dateParts
          ? new Date(
              `${dateParts[1]}-${dateParts[2]}-${dateParts[3]}T00:00:00.000Z`,
            )
          : null;
        const hasValidCalendarDate =
          calendarDate !== null &&
          !Number.isNaN(calendarDate.getTime()) &&
          calendarDate.getUTCFullYear() === Number(dateParts?.[1]) &&
          calendarDate.getUTCMonth() + 1 === Number(dateParts?.[2]) &&
          calendarDate.getUTCDate() === Number(dateParts?.[3]);
        const parsed = new Date(normalizedStartDate);
        if (!hasValidCalendarDate || Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ message: "Invalid start date" }, { status: 400, headers: responseHeaders });
        }
        parsedStartDate = parsed;
      } else {
        return NextResponse.json({ message: "Invalid start date" }, { status: 400, headers: responseHeaders });
      }
    }
    const requestedSectionTitle =
      typeof section_title === "string" ? section_title.trim() : "";
    const sectionWhere: Prisma.SectionWhereInput = {
      projectId,
      visibility: true,
      deleted: false,
    };
    if (normalizedSectionId !== null) {
      sectionWhere.id = normalizedSectionId;
    } else if (requestedSectionTitle) {
      sectionWhere.section_title = requestedSectionTitle;
    }
    const sectionOrderBy =
      normalizedSectionId === null && !requestedSectionTitle
        ? { ranking: "asc" as const }
        : undefined;
    const sectionErrorMessage =
      normalizedSectionId === null && !requestedSectionTitle
        ? "No active section found"
        : "Section does not belong to this project";
    const validationFinishedAt = performance.now();
    let newTask: TaskCreatedGlobally;
    let boardWebhookDeliveryIds: string[] = [];
    let tagsCreated: any = null;
    let assignmentsCreated: Awaited<ReturnType<typeof persistAssignee>>[] = [];
    const taskCreatedActor = {
      userId: currentUser.id,
      agentId: agentId ?? null,
    };
    try {
      const created = await createTaskWithBoardWebhookOutbox(prisma, taskCreatedActor, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TASK_UNIQUE_INDEX_ADVISORY_LOCK_CLASS}::int, ${projectId}::int)`;
        const sectionRow = await tx.section.findFirst({
          where: sectionWhere,
          ...(sectionOrderBy ? { orderBy: sectionOrderBy } : {}),
          select: { id: true, section_title: true },
        });
        if (!sectionRow) throw new TaskSectionValidationError(sectionErrorMessage);
        const currentProject = await tx.project.findUnique({ where: { id: projectId }, select: { uniqueIdentifier: true } });
        const nextUniqueIndex = await getNextUniqueTaskIndex(projectId, tx);
        const currentDate = new Date();
        const body = {
          title: title,
          description: "",
          section: sectionRow.section_title,
          userId,
          uniqueIndex: nextUniqueIndex,
          ticketNumber: currentProject?.uniqueIdentifier + "-" + nextUniqueIndex.toString(),
          ranking,
          projectId,
          sectionId: sectionRow.id,
          dueDate,
          startDate: parsedStartDate,
          dueDateNotifiedAt: null,
          updatedAt: currentDate,
          parentTaskId: parentTaskId || parentTask?.id || undefined,
          agentId,
        };
        const task = await tx.task.create({
          data: {
            ...body,
            description_: {
              create: {
                content: description ?? "",
                creatorId: userId,
                agentId,
              },
            },
          },
          include: {
            project: true,
            parentTask: true,
            description_: true,
          },
        });
        const createdPriority = priority
          ? await tx.priority.create({
              data: {
                taskId: task.id,
                sectionId: task.sectionId ?? -1,
                projectId: task.projectId,
                addedByUserId: currentUser.id,
                priority_index: priority.priority_index,
                Priority_Value: priority.Priority_Value,
                addedByAgentId: agentId,
              },
              include: { addedByAgent: true },
            })
          : undefined;
        if (tagIds.length > 0) {
          await tx.taskLabel.createMany({
            data: tagIds.map((labelId) => ({
              taskId: task.id,
              labelId,
            })),
          });
        }
        const createdTaskLabels = tagIds.length
          ? await tx.taskLabel.findMany({
              where: { taskId: task.id },
              include: { label: true },
            })
          : null;
        const createdAssignments: Awaited<
          ReturnType<typeof persistAssignee>
        >[] = [];
        for (const assignee of normalizedAssignees) {
          createdAssignments.push(
            await persistAssignee(
              tx,
              currentUser,
              task.id,
              assignee,
              agentId,
            ),
          );
        }
        await persistAgentTaskCreatedPending(tx, task.id);
        return {
          taskId: task.id,
          result: {
            task,
            priority: createdPriority,
            taskLabels: createdTaskLabels,
            assignments: createdAssignments,
          },
          webhookTask: {
            id: task.id,
            ticketNumber: task.ticketNumber,
            projectId: task.projectId,
            title: task.title,
            status: task.status,
            dueDate: task.dueDate,
            startDate: task.startDate,
            sectionId: task.sectionId,
            section: sectionRow?.section_title ?? task.section,
            priority: createdPriority
              ? {
                  id: createdPriority.id,
                  priority_index: createdPriority.priority_index,
                  Priority_Value: createdPriority.Priority_Value,
                }
              : null,
          },
        };
      });
      newTask = created.result.task as TaskCreatedGlobally;
      boardWebhookDeliveryIds = created.boardWebhookDeliveryIds;
      priorityCreated = created.result.priority;
      tagsCreated = created.result.taskLabels;
      assignmentsCreated = created.result.assignments;
    } catch (e) {
      if (e instanceof TaskSectionValidationError) {
        return NextResponse.json({ message: e.message }, { status: 400, headers: responseHeaders });
      }
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return NextResponse.json({
          message:
            "Could not allocate a unique task index for this project. Please retry.",
        }, { status: 409, headers: responseHeaders });
      }
      throw e;
    }
    if (!newTask) {
      return NextResponse.json({ message: "Failed to create task" }, { status: 400, headers: responseHeaders });
    }
    const taskCreatedAt = performance.now();
    const description_ = newTask.description_;
    if (priorityCreated) {
      await createPriorityActivity(newTask, currentUser, priorityCreated);
    }
    if (estimate) {
      const { estimate: newEstimate } =
        await createEstimateAndActivity(newTask, currentUser, estimate, agentId);
      estimateCreated = newEstimate;
    }
    if (dueDate) {
      const { scheduleDueDateJob } = await import("@/pages/api/queues/duedateQueue");
      await scheduleDueDateJob(
        { taskId: newTask.id, projectId: newTask.projectId },
        new Date(dueDate),
      );
    }
    if (Array.isArray(relationsToAdd) && relationsToAdd.length > 0) {
      const { addRelatedTasks } = await import(
        "@/utils/controllers/tasks/addRelatedTasks"
      );
      relatedTasks = await addRelatedTasks(
        {
          relatedTasks: relationsToAdd,
          currentTaskId: newTask.id,
        },
        currentUser.id
      );
    }
    if (Array.isArray(urlsToAdd) && urlsToAdd.length > 0) {
      const { default: addIntoTaskDesc } = await import(
        "@/utils/controllers/urls/addIntoTaskDesc"
      );
      await addIntoTaskDesc(urlsToAdd, newTask.id, "PUT");
    }
    for (const assignment of assignmentsCreated) {
      await createAssigneeActivityAndNotification(
        currentUser,
        newTask.id,
        newTask.projectId,
        assignment,
        agentId,
      );
    }
    console.log(
      "🚀 ~ consthandler:NextApiHandler= ~ tagsCreated:",
      tagsCreated
    );
    console.log(
      "🚀 ~ consthandler:NextApiHandler= ~ description:",
      description
    );
    await publishBoardWebhookDeliveries(boardWebhookDeliveryIds);
    schedulePostCreateWork({
      task: newTask,
      userId,
      projectId,
      originUserId: currentUser.id,
      createTaskFromComment,
      agentId,
    });
    const responseReadyAt = performance.now();
    responseHeaders.set(
      "Server-Timing",
      [
        `validate;dur=${(validationFinishedAt - requestStartedAt).toFixed(1)}`,
        `task-create;dur=${(taskCreatedAt - validationFinishedAt).toFixed(1)}`,
        `enrich;dur=${(responseReadyAt - taskCreatedAt).toFixed(1)}`,
        `total;dur=${(responseReadyAt - requestStartedAt).toFixed(1)}`,
      ].join(", "),
    );
    return NextResponse.json({
      message: "Created a new task",
      newTask: {
        ...newTask,
        description_,
        priority: priorityCreated,
        estimate: estimateCreated,
        taskLabels: tagsCreated,
        relatedTasks,
      },
      error: false,
    }, { status: 200, headers: responseHeaders });
  },
});

export const POST: TaskWriteRoute = async (request, session) => {
  const requestStartedAt = performance.now();
  const body = await request.json();
  // Preserve the legacy pre-auth exception, including its req.body error text.
  const req = { body };
  const { title } = req.body;
  void title;
  return route(requestStartedAt)({ ...request, headers: request.headers, json: async () => body }, session);
};
