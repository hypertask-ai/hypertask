import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { schedulePostCreateWork, persistAssignee, createAssigneeActivityAndNotification, createPriorityActivity, createEstimateAndActivity, getActiveAgentOwnerId, isAgentAssignee, type TaskCreatedGlobally, type NormalizedTaskAssignee } from "@/lib/api/task-writes/create-global-effects";
import { isEmptyComposeTarget } from "@/lib/ai/composeTaskTarget";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { isFeatureEnabled, HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG } from "@/lib/flags";
import generateRank from "@/utils/generateRank";
import { IAgent, ILabel, IUser } from "@/models/model";
import prisma from "@/lib/prisma";
import { getNextUniqueTaskIndex } from "@/utils/controllers/tasks/getNextUniqueTaskIndex";
import { createTaskWithBoardWebhookOutbox } from "@/lib/mcp/webhooks/taskEvents";
import { publishBoardWebhookDeliveries } from "@/lib/mcp/webhooks/outbox";
import { persistAgentTaskCreatedPending } from "@/lib/agentWebhooks/outbox";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

/** First argument to `pg_advisory_xact_lock`; pairs with `projectId` for uniqueIndex allocation. */
const TASK_UNIQUE_INDEX_ADVISORY_LOCK_CLASS = 9428471;

class TaskSectionValidationError extends Error {}

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  // ========== we also get some relevant info in the GET request.
  if (req.method === "GET") {
    const requestStartedAt = performance.now();
    try {
      const { sectionId, projectId, position } = req.query;

      if (!projectId)
        return res.status(400).json({ message: "Missing project Id!" });
      let ranking;
      const project_id = Number(projectId);
      if (!Number.isInteger(project_id) || project_id <= 0) {
        return res.status(400).json({ message: "Invalid project id" });
      }
      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>)
      );
      if (!session) return res.status(401).json({ message: "Unauthorized" });

      const authorizedProject = await prisma.project.findFirst({
        where: {
          id: project_id,
          status: "Normal",
          ...taskWriteAccessWhere(session.userId, null),
        },
        select: { id: true },
      });
      if (!authorizedProject) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const requestedSectionId = Number(sectionId);
      const requestedSection = Number.isInteger(requestedSectionId)
        ? await prisma.section.findFirst({
            where: {
              id: requestedSectionId,
              projectId: project_id,
              visibility: true,
              deleted: false,
            },
          })
        : null;
      const section =
        requestedSection ??
        (await prisma.section.findFirst({
          where: {
            visibility: true,
            deleted: false,
            projectId: project_id,
          },
          orderBy: { ranking: "asc" },
        }));
      if (!section) {
        return res.status(404).json({ message: "No active section found" });
      }
      console.log("🚀 ~ consthandler:NextApiHandler= ~ section:", section);
      const task = await prisma.task.findFirst({
        where: {
          sectionId: section.id,
          projectId: project_id,
          status: "Normal",
        },
        orderBy: {
          ranking: position === "top" ? "asc" : "desc",
        },
      });
      console.log("🚀 ~ consthandler:NextApiHandler= ~ task:", task);

      if (position === "bottom") {
        ranking = generateRank(task ? task.ranking : undefined, undefined);
      } else {
        ranking = generateRank(undefined, task ? task.ranking : undefined);
      }
      console.log("🚀 ~ consthandler:NextApiHandler= ~ ranking:", ranking);
      const body = {
        section: section.section_title,
        ranking,
        sectionId: section.id,
      };
      console.log("🚀 ~ consthandler:NextApiHandler= ~ body:", body);
      res.setHeader(
        "Server-Timing",
        `total;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
      );
      res.status(200).json(body);
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error);
      res.status(500).json({ message: "Could not load task defaults" });
    }
  }

  if (req.method === "POST") {
    const requestStartedAt = performance.now();
    const {
      title,
      userId: requestedUserId,
      projectId: requestedProjectId,
      ranking,
      section_title,
      sectionId,
      priority,
      estimate,
      dueDate,
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
    } = req.body;
    console.log("🤔 ~ creating task ~ req.body:", req.body);

    // let priorityLocal: Promise<any> = Promise.resolve(null); // Initialize to a resolved promise
    // let estimateLocal: Promise<any> = Promise.resolve(null); // Initialize to a resolved promise
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (
      requestedUserId != null &&
      Number(requestedUserId) !== session.userId
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (req.body.requestKind === "compose-task" &&
        !(await isFeatureEnabled(HTPR_6929_COMPOSE_TASK_WRITER_FLAG, session.userId))) {
      return res.status(403).json({ message: "Compose task writer is turned off" });
    }
    if (req.body.existingTaskId != null && (req.body.requestKind !== "compose-task" ||
        !(await isFeatureEnabled(HTPR_6937_NEW_TASK_WINDOW_FLAG, session.userId)))) {
      return res.status(403).json({ message: "New Task window is turned off" });
    }
    const projectId = Number(requestedProjectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ message: "Invalid project id" });
    }
    const userId = session.userId;
    const currentUserRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, photoURL: true, email: true },
    });
    if (!currentUserRecord) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const currentUser = currentUserRecord as IUser;
    // HTPR-6362: acting agent comes from the signed session claim. Body agentId
    // may confirm that claim but cannot forge one (same rule as archive).
    const signedSession = verifySession(req.cookies?.[SESSION_COOKIE]);
    const actingAgent = resolveActingAgent({
      sessionAgentId: signedSession?.agentId ?? null,
      bodyAgentId: requestedAgentId,
    });
    if (!actingAgent.ok) {
      return res
        .status(actingAgent.status)
        .json({ message: actingAgent.message });
    }
    const agentId = actingAgent.agentId;
    if (agentId) {
      const agentOwnerId = await getActiveAgentOwnerId(agentId);
      if (agentOwnerId !== session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { isAgentOnBoard } = await import(
        "@/utils/controllers/agents/boardMembers"
      );
      if (!(await isAgentOnBoard(Number(projectId), agentId))) {
        return res.status(403).json({ message: "Forbidden" });
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
      return res.status(403).json({ message: "Forbidden" });
    }
    if (req.body.existingTaskId != null) {
      const taskId = Number(req.body.existingTaskId);
      if (!Number.isSafeInteger(taskId) || taskId <= 0) {
        return res.status(400).json({ message: "Invalid task id" });
      }
      const target = await prisma.task.findFirst({
        where: { id: taskId, projectId, status: "Normal", project: taskWriteAccessWhere(userId, agentId) },
        include: { description_: { select: { content: true } } },
      });
      if (!target) return res.status(403).json({ message: "Forbidden" });
      if (!isEmptyComposeTarget(target)) return res.status(409).json({ message: "This task is no longer empty. Your note is still here." });
      const { updateTaskSingle } = await import("@/utils/controllers/tasks/single");
      const result = await updateTaskSingle({ id: taskId, title, description }, currentUser, agentId, {
        expectedTitle: target.title,
        expectedDescription: target.description_?.content ?? "",
        expectedProjectId: target.projectId,
        expectedStatus: target.status,
      });
      if (result.status !== 200) return res.status(result.status).json(result.json);
      const { broadcastBoardChange, broadcastTaskChange } = await import("@/lib/realtime/server");
      await Promise.all([broadcastBoardChange(projectId, { originUserId: userId }), broadcastTaskChange(taskId)]);
      return res.status(200).json({ newTask: result.json });
    }
    // Task creation receives existing, persisted project-label records. New
    // labels use the label creation route before this request.
    let tagIds: string[] = [];
    if (tags != null && !Array.isArray(tags)) {
      return res.status(400).json({ message: "Invalid labels" });
    }
    if (Array.isArray(tags) && tags.length > 0) {
      const rawTagIds = (tags as ILabel[]).map((tag) => tag?.id);
      if (rawTagIds.some((id) => typeof id !== "string")) {
        return res.status(400).json({ message: "Invalid labels" });
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
        // Reject the request rather than silently dropping a label the caller
        // asked to attach. This also prevents a cross-board label reference
        // from entering the task transaction.
        return res.status(400).json({
          message: "One or more labels do not belong to this project",
        });
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
        return res.status(400).json({ message: "Invalid assignee payload" });
      }

      const memberCheck = await validateProjectMemberIds(
        projectId,
        assigneeUserIds
      );
      if (memberCheck.error) {
        return res
          .status(memberCheck.error.status)
          .json({ message: memberCheck.error.message });
      }

      if (memberCheck.invalidIds.length > 0) {
        return res.status(400).json({
          message: `User(s) ${memberCheck.invalidIds.join(", ")} are not members of this project and cannot be assigned.`,
        });
      }

      for (const assigneeAgentId of agentAssigneeIds) {
        const onBoard = await isAgentOnBoard(projectId, assigneeAgentId);
        if (!onBoard) {
          return res.status(400).json({
            message:
              "Agent is not a member of this board. Add the agent to the board before assigning.",
          });
        }
      }
    }

    // HTPR-5922: validate the final section against the selected board. The
    // writer may suggest a section, but a stale or foreign section must never
    // be written into a task on the current board.
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
      return res.status(400).json({ message: "Invalid section" });
    }

    let parsedStartDate: Date | null | undefined;
    if (startDate != null) {
      if (startDate instanceof Date) {
        if (Number.isNaN(startDate.getTime())) {
          return res.status(400).json({ message: "Invalid start date" });
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
          return res.status(400).json({ message: "Invalid start date" });
        }
        parsedStartDate = parsed;
      } else {
        return res.status(400).json({ message: "Invalid start date" });
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
          // Explicit for parity with setDueDate.ts's reset-on-change (see invokeDueDate.ts).
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
        // The requested priority is part of the created state the webhook
        // contract exposes, so it is written here rather than after commit;
        // otherwise task.created would report priority: null for a task that
        // was created with one (HTPR-4530).
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
        // The recovery marker becomes visible only when the task's requested
        // labels and explicit assignees commit. A concurrent sweep can no
        // longer freeze a partial task.created snapshot.
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
        return res.status(400).json({ message: e.message });
      }
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return res.status(409).json({
          message:
            "Could not allocate a unique task index for this project. Please retry.",
        });
      }
      throw e;
    }

    if (!newTask) {
      return res.status(400).json({ message: "Failed to create task" });
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
      const { scheduleDueDateJob } = await import("../queues/duedateQueue");
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
    res.setHeader(
      "Server-Timing",
      [
        `validate;dur=${(validationFinishedAt - requestStartedAt).toFixed(1)}`,
        `task-create;dur=${(taskCreatedAt - validationFinishedAt).toFixed(1)}`,
        `enrich;dur=${(responseReadyAt - taskCreatedAt).toFixed(1)}`,
        `total;dur=${(responseReadyAt - requestStartedAt).toFixed(1)}`,
      ].join(", "),
    );

    return res.status(200).json({
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
    });
  }
};


export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/task-writes/create-global")).POST,
);
