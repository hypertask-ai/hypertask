import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import generateRank from "@/utils/generateRank";
import { IAgent, IEstimate, ILabel, IPriority, ITask, IUser } from "@/models/model";
import { waitUntil } from "@vercel/functions";
import {
  ITaskAssignedActivity,
  ITaskEstimateActivity,
  ITaskPriorityActivity,
} from "@/models/ActivityModels.ts";
import prisma from "@/lib/prisma";
import { getNextUniqueTaskIndex } from "@/utils/controllers/tasks/getNextUniqueTaskIndex";
import { createTaskWithBoardWebhookOutbox } from "@/lib/mcp/webhooks/taskEvents";
import { publishBoardWebhookDeliveries } from "@/lib/mcp/webhooks/outbox";
import { persistAgentTaskCreatedPending } from "@/lib/agentWebhooks/outbox";
import { assignmentActivityUserSelect } from "@/utils/controllers/activities/createAssignedActivity";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

/** First argument to `pg_advisory_xact_lock`; pairs with `projectId` for uniqueIndex allocation. */
const TASK_UNIQUE_INDEX_ADVISORY_LOCK_CLASS = 9428471;

type TaskCreatedGlobally = Prisma.TaskGetPayload<{
  include: { project: true; parentTask: true; description_: true };
}>;

type NormalizedTaskAssignee = {
  userId: number;
  agentId?: string;
};

const isAgentAssignee = (assignee: IUser | IAgent): assignee is IAgent =>
  typeof assignee.id === "string";

async function getActiveAgentOwnerId(agentId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, revokedAt: null },
    select: { userId: true },
  });
  return agent?.userId ?? null;
}

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  // ========== we also get some relevant info in the GET request.
  if (req.method === "GET") {
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
      projectIdentifier,
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
    const agentId =
      typeof requestedAgentId === "string" && requestedAgentId.length > 0
        ? requestedAgentId
        : null;
    if (requestedAgentId != null && !agentId) {
      return res.status(400).json({ message: "Invalid agent id" });
    }
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
    const normalizedSectionId = sectionId == null ? null : Number(sectionId);
    if (
      normalizedSectionId !== null &&
      (!Number.isInteger(normalizedSectionId) || normalizedSectionId <= 0)
    ) {
      return res.status(400).json({ message: "Invalid section" });
    }
    const sectionRow =
      normalizedSectionId === null
        ? null
        : await prisma.section.findFirst({
            where: {
              id: normalizedSectionId,
              projectId,
              visibility: true,
              deleted: false,
            },
            select: { section_title: true },
          });
    if (normalizedSectionId !== null && !sectionRow) {
      return res.status(400).json({
        message: "Section does not belong to this project",
      });
    }

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
        const nextUniqueIndex = await getNextUniqueTaskIndex(projectId, tx);
        const currentDate = new Date();
        const body = {
          title: title,
          description: "",
          section: sectionRow?.section_title ?? section_title,
          userId,
          uniqueIndex: nextUniqueIndex,
          ticketNumber: projectIdentifier + "-" + nextUniqueIndex.toString(),
          ranking,
          projectId,
          sectionId: normalizedSectionId,
          dueDate,
          startDate,
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

function schedulePostCreateWork({
  task,
  userId,
  projectId,
  originUserId,
  createTaskFromComment,
  agentId,
}: {
  task: TaskCreatedGlobally;
  userId: number;
  projectId: number;
  originUserId: number;
  createTaskFromComment?: { task: ITask; commentIndex: number };
  agentId?: string | null;
}) {
  // autoAssignForSection coalesces concurrent calls for the same task and
  // section. The board broadcast stays separate, so it cannot suppress
  // task.created.
  const autoAssignWork = import("@/utils/controllers/assignees/autoAssignForSection")
    .then(({ autoAssignForSection }) =>
      autoAssignForSection({
        taskId: task.id,
        projectId,
        sectionId: task.sectionId,
        currentUserId: userId,
        agentAssignerId: agentId,
      }),
    )
    .then((autoAssigned) => {
      if (autoAssigned === "ready") return "ready" as const;

      // Retry assignment before either the board broadcast or task.created
      // emission proceeds. A final retry leaves the durable marker pending.
      return import("@/lib/agentWebhooks/taskCreatedRecovery").then(
        async ({ recoverPendingAgentTaskCreatedWebhook }) => {
          const result = await recoverPendingAgentTaskCreatedWebhook(task.id, {
            userId,
            agentId: agentId ?? null,
          });
          return result === "pending" ? "pending" as const : "ready" as const;
        },
      );
    })
    .catch((error) => {
      console.error("[task-create-global] agent task.created recovery failed", {
        taskId: task.id,
        error,
      });
      return import("@/lib/agentWebhooks/outbox").then(
        async ({ ensurePendingAgentTaskCreatedWebhook }) => {
          await ensurePendingAgentTaskCreatedWebhook(task.id);
          return "pending" as const;
        },
      );
    });
  const agentWebhookWork = autoAssignWork.then(async (autoAssigned) => {
    if (autoAssigned === "pending") {
      // The creation transaction wrote the marker. Leave it untouched so the
      // minute sweep at /api/queues/sweep can retry this handoff.
      console.warn(
        "[task-create-global] task.created handoff remains pending for the recovery sweep",
        { taskId: task.id },
      );
      return;
    }
    const { emitAgentTaskCreatedWebhook, markAgentTaskCreatedReady } =
      await import("@/lib/agentWebhooks/outbox");
    await markAgentTaskCreatedReady(task.id);
    await emitAgentTaskCreatedWebhook({
      taskId: task.id,
      actor: { userId: originUserId, agentId: agentId ?? null },
    });
  }).catch((error) => {
    console.error("[task-create-global] agent task.created webhook failed", {
      taskId: task.id,
      error,
    });
    // Keep the creation marker pending when emission fails. A direct fallback
    // could publish task.created without final assignees.
    return import("@/lib/agentWebhooks/outbox").then(
      async ({ ensurePendingAgentTaskCreatedWebhook }) => {
        await ensurePendingAgentTaskCreatedWebhook(task.id);
      },
    );
  });

  const work = Promise.allSettled([
    task.project.teamId
      ? prisma.team_Activity.update({
          where: { teamId: task.project.teamId },
          data: { total_tasks: { increment: 1 } },
        })
      : Promise.resolve(),
    prisma.drafts.createMany({
      data: [
        {
          taskId: task.id,
          userId,
          type: "Comment",
          projectId,
          saved: false,
        },
        {
          taskId: task.id,
          userId,
          type: "Description",
          projectId,
          saved: false,
          content: "",
        },
      ],
    }),
    import("@/utils/controllers/turbopuffer/turbopufferHelper").then(
      ({ upsertTaskToTurbopuffer }) => upsertTaskToTurbopuffer(task.id),
    ),
    import("../queues/FAST/generateSummary").then(
      ({ default: scheduleTaskSummaryGeneration }) =>
        scheduleTaskSummaryGeneration({ taskId: task.id, agentId: agentId ?? null }),
    ),
    import("@/lib/ai/labelClassifier").then(({ classifyTaskAiLabels }) =>
      classifyTaskAiLabels(task.id, task.projectId),
    ),
    // A column rule applies to every ticket that lands in the column, not only
    // to tickets dragged in later (HTPR-5488). The board broadcast waits for it
    // so other viewers get the task with its auto-assignee already attached.
    autoAssignWork.then(async () => {
      // autoAssignWork resolves only after its assignment or recovery
      // transaction commits, so this broadcast reads committed assignees.
      const { broadcastBoardChange } = await import("@/lib/realtime/server");
      await broadcastBoardChange(task.projectId, { originUserId });
    }),
    createTaskFromComment
      ? createNewTaskFromComment(createTaskFromComment, task, userId, agentId)
      : Promise.resolve(),
    agentWebhookWork,
  ]).then((results) => {
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      console.error(
        "[task-create] post-response work failed",
        failures.map(({ reason }) => reason),
      );
    }
  });

  // These operations must finish, but none is required to make the newly
  // created task usable. Keeping them out of the response path removes search,
  // AI, queue, and realtime module startup from the user's save latency.
  waitUntil(work);
}

async function persistAssignee(
  tx: Prisma.TransactionClient,
  currentUser: IUser,
  taskId: number,
  assignee: NormalizedTaskAssignee,
  agentAssignerId?: string | null //This is agentAssignerId.
) {
  const assign = await tx.assignees.create({
    data: {
      assignerId: currentUser.id,
      taskId,
      userId: assignee.userId,
      agentId: assignee.agentId,
      agentAssignerId,
    },
    include: {
      assigner: true,
      agent: {
        select: {
          id: true,
          userId: true,
          photoURL: true,
          displayName: true,
          revokedAt: true,
        },
      },
      agentAssigner: {
        select: {
          id: true,
          userId: true,
          photoURL: true,
          displayName: true,
        },
      },
      user: {
        select: assignmentActivityUserSelect,
      },
    }
  });

  await tx.follower.deleteMany({
    where: { userId: assignee.userId, taskId },
  });

  return assign;
}

async function createAssigneeActivityAndNotification(
  currentUser: IUser,
  taskId: number,
  projectId: number,
  assign: Awaited<ReturnType<typeof persistAssignee>>,
  agentAssignerId?: string | null,
) {
  let commentId: number | undefined = undefined;
  const agentId = assign.agentId ?? undefined;

  // ======================= create activity of task assignment
  if (assign.assigner && assign.assignerId) {
    const activityBody: ITaskAssignedActivity = {
      type: "TaskAssigned",
      data: {
        fromUser: {
          userId: currentUser.id,
          displayName: currentUser.displayName ?? "",
          user: currentUser,
        },
        updatedStatus: "Assigned",
        fromUserId: currentUser.id,
        toUser: {
          userId: assign.user.id,
          displayName: assign.user.displayName ?? "",
          user: assign.user,
        },
        fromAgent: assign.agentAssigner ?? undefined,
        toAgent: assign.agent ?? undefined,
      },
    };

    commentId = await createCommentActivity(taskId, activityBody);
  }

  // Send assignment notification
  if (agentId && assign.agentId && assign.agent && !assign.agent.revokedAt) {
    // User → Agent (or Agent → Agent): agent is the assignee — create directly, no reminder check
    await prisma.notification.create({
      data: {
        assignId: assign.id,
        agentId: assign.agentId,
        userId: assign.agent.userId, // required non-nullable; set to agent's owner
        taskId,
        projectId,
        type: "Assigned",
        fromUserId: currentUser.id,
        ...(agentAssignerId ? { fromAgentId: agentAssignerId } : {}),
      },
    });
  } else if (!agentId && assign.userId !== currentUser.id) {
    // User → User (or Agent → User): user is the assignee, skip self-assignment
    const { default: checkReminderAndCreateNotification } = await import(
      "@/utils/controllers/notifications/creation-service/check-reminder_create-notification"
    );
    await checkReminderAndCreateNotification(
      assign.userId,
      projectId,
      taskId,
      {
        assignId: assign.id,
        userId: assign.userId,
        taskId,
        projectId,
        type: "Assigned",
        fromUserId: currentUser.id,
        ...(agentAssignerId ? { fromAgentId: agentAssignerId } : {}),
      }
    );
  }

  return commentId;
}

// The priority row itself is created inside the task transaction (see above);
// this only writes the activity entry that follows it.
async function createPriorityActivity(
  task: any,
  currentUser: IUser,
  priority: any
) {
  // ============= create priority activity element
  const activityBody: ITaskPriorityActivity = {
    type: "TaskPriority",
    data: {
      fromUserId: currentUser.id,
      fromUserDisplayName: currentUser.displayName ?? "",
      fromUser: currentUser,
      toPriority: {
        priority_index: priority.priority_index,
        Priority_Value: priority.Priority_Value,
        priority: priority as unknown as IPriority,
      },
      fromAgent: priority.addedByAgent ?? undefined,
    },
  };

  const commentId = await createCommentActivity(task.id, activityBody);
  return { priority, commentId };
}

async function createEstimateAndActivity(
  task: any,
  currentUser: IUser,
  estimate_: any,
  agentId?: string | null
) {
  const estimate = await prisma.estimate.create({
    data: {
      taskId: task.id,
      sectionId: task.sectionId ?? -1,
      projectId: task.projectId,
      addedByUserId: currentUser.id,
      estimate_index: estimate_.estimate_index,
      estimate_value: estimate_.estimate_value,
      addedByAgentId: agentId,
    },
    include: {
      addedByAgent: true,
    },
  });
  // ============== create comment in that taskId as activity log.
  const activityBody: ITaskEstimateActivity = {
    type: "TaskEstimate",
    data: {
      fromUserId: currentUser.id,
      fromUserDisplayName: currentUser.displayName ?? "",
      fromUser: currentUser,
      fromAgent: estimate.addedByAgent ?? undefined,
      toEstimate: {
        estimate_index: estimate.estimate_index,
        estimate_value: estimate.estimate_value,
        estimate: estimate as unknown as IEstimate,
      },
    },
  };

  const commentId = await createCommentActivity(task.id, activityBody);
  return { estimate, commentId };
}

async function createCommentActivity(taskId: number, activityBody: any) {
  const comment = await prisma.comment.create({
    data: {
      text: "",
      taskId: taskId,
      activity: activityBody,
    },
  });

  // Get the current updatedByUserIds for the task
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { updatedByUserIds: true },
  });

  const fromUserId =
    activityBody.data.fromUserId ?? activityBody.data.fromUser?.userId;
  if (fromUserId && !task?.updatedByUserIds?.includes(fromUserId)) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        updatedByUserIds: {
          push: fromUserId,
        },
      },
    });
  }

  return comment.id;
}

async function createNewTaskFromComment(
  createTaskFromComment: { task: ITask; commentIndex: number },
  newTask: any,
  creatorId: number,
  agentId?: string | null,
) {
  try {
    const commentLink = `<a target="_blank" rel="noopener noreferrer nofollow" href="/detail/project-${createTaskFromComment.task?.projectId}/${createTaskFromComment.task?.uniqueIndex}#comment-${createTaskFromComment.commentIndex}">Comment-${createTaskFromComment.commentIndex}</a>`;
    const taskLink = `<a target="_blank" rel="noopener noreferrer nofollow" href="/detail/project-${newTask?.projectId}/${newTask?.uniqueIndex}">${newTask?.ticketNumber} | ${newTask.title}</a>`;
    const commentText = `Created ${taskLink} from ${commentLink}`;

    const comment = await prisma.comment.create({
      data: {
        text: `<p>${commentText}</p>`,
        creatorId,
        taskId: createTaskFromComment.task.id,
      },
    });

    //Create relation between tasks.
    await prisma.taskRelations.create({
      data: {
        sourceTaskId: createTaskFromComment.task.id,
        targetTaskId: newTask.id,
        relationType: "RelatedTo",
      },
    });

    await Promise.allSettled([
      import("@/utils/controllers/turbopuffer/turbopufferHelper").then(
        ({ upsertCommentToTurbopuffer }) =>
          upsertCommentToTurbopuffer(comment.id),
      ),
      import("../queues/FAST/generateSummary").then(
        ({ default: scheduleTaskSummaryGeneration }) =>
          scheduleTaskSummaryGeneration({
            taskId: createTaskFromComment.task.id,
            agentId: agentId ?? null,
          }),
      ),
    ]);
  } catch (error) {
    console.log("🤔 ~ createNewTaskFromComment ~ error:", error);
  }
}

export default handler;
