import { Prisma } from "@prisma/client";
import type { IAgent, IEstimate, ITask, IUser, IPriority } from "@/models/model";
import type { ITaskAssignedActivity, ITaskEstimateActivity, ITaskPriorityActivity } from "@/models/ActivityModels.ts";
import { waitUntil } from "@vercel/functions";
import prisma from "@/lib/prisma";
import { assignmentActivityUserSelect } from "@/utils/controllers/activities/createAssignedActivity";

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
    import("@/pages/api/queues/FAST/generateSummary").then(
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
      import("@/pages/api/queues/FAST/generateSummary").then(
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

export { schedulePostCreateWork, persistAssignee, createAssigneeActivityAndNotification, createPriorityActivity, createEstimateAndActivity, getActiveAgentOwnerId, isAgentAssignee };
export type { TaskCreatedGlobally, NormalizedTaskAssignee };
