import { sendDataNewCommentFCM } from "../FCM";
import { IAssignees, IFCMReqBody, ITask, IUser } from "@/models/model";
import prisma from "@/lib/prisma";
import createAssignedActivity, {
  assignmentActivityUserSelect,
} from "../activities/createAssignedActivity";
import checkReminderAndCreateNotification from "../notifications/creation-service/check-reminder_create-notification";
import { shouldSkipSelfAssign } from "../notifications/agentActionRecipients";
import { sendAssignEmail } from "../notifications/sendAssignEmail";
import { taskBaseUri } from "@/utils";
import { isAgentOnBoard } from "@/utils/controllers/agents/boardMembers";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { publicAgentSelect } from "@/lib/agents/publicAgent";
import {
  persistAgentWebhookEvent,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import {
  persistBoardWebhookEvent,
  publishBoardWebhookDeliveries,
} from "@/lib/mcp/webhooks/outbox";
import type { WebhookDelivery } from "@/lib/mcp/webhooks/events";
import {
  AgentMutationLeaseConflictError,
  assertAgentAssignmentChangeAllowed,
  cancelAgentMutationLeaseForHumanOverride,
} from "@/lib/mcp/tasks/agentMutationFence";

export type AssigneeIntent = "assign" | "unassign" | "toggle";

const assigneesAssign = async (
  currentUser: IUser,
  userId: number | null,
  taskId: number,
  agentId?: string,
  agentAssignerId?: string,
  options?: {
    intent?: AssigneeIntent;
    expectedProjectId?: number;
    expectedSectionId?: number | null;
  }
) => {
  try {
    const intent: AssigneeIntent = options?.intent ?? "toggle";
    let assignStatus: "Assigned" | "Unassigned" | "Conflict" = "Assigned";
    let assignmentOutcome:
      | "created"
      | "already-assigned"
      | "stale-task" = "already-assigned";

    const task = await prisma.task.findUnique({
      where: {
        id: taskId,
      },
    });
    if (!task) {
      return { status: 400, json: { message: "Task not found" } };
    }

    let assigneeUserId = userId;
    if (agentId) {
      // Removing an agent must always work, even once it is revoked or off the
      // board — otherwise its chip is stuck on the task with no way to clear it.
      const isRemoval = intent === "unassign";
      const [agent, onBoard] = await Promise.all([
        prisma.agent.findFirst({
          where: { id: agentId, ...(isRemoval ? {} : { revokedAt: null }) },
          select: { userId: true },
        }),
        isAgentOnBoard(task.projectId, agentId),
      ]);

      if (!agent || (!onBoard && !isRemoval)) {
        return {
          status: 400,
          json: {
            message:
              "Agent is not a member of this board. Add the agent to the board before assigning.",
          },
        };
      }

      assigneeUserId = agent.userId;
    }

    if (assigneeUserId == null) {
      return {
        status: 400,
        json: { message: "A user or agent assignee is required." },
      };
    }

    let assigneeIdentity:
      | { agentId: string }
      | { userId: number; agentId?: null };
    if (agentId) {
      assigneeIdentity = { agentId };
    } else if (intent === "assign") {
      assigneeIdentity = { userId: assigneeUserId };
    } else {
      assigneeIdentity = { userId: assigneeUserId, agentId: null };
    }

    const assign = await prisma.assignees.findFirst({
      where: {
        taskId,
        ...assigneeIdentity,
      },
      include: {
        user: {
          select: assignmentActivityUserSelect,
        },
        agent: {
          select: {
            id: true,
            userId: true,
            photoURL: true,
            displayName: true,
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
      },
    });

    const validateUserAssignee = async () => {
      const memberCheck = await validateProjectMemberIds(task.projectId, [assigneeUserId]);
      if (memberCheck.error) {
        return {
          status: memberCheck.error.status,
          json: { message: memberCheck.error.message },
        };
      }

      if (memberCheck.invalidIds.length > 0) {
        return {
          status: 400,
          json: {
            message: `User ${assigneeUserId} is not a member of this project and cannot be assigned.`,
          },
        };
      }

      return null;
    };

    const willCreateAssignee =
      !agentId && !assign && (intent === "assign" || intent === "toggle");
    if (willCreateAssignee) {
      const validationError = await validateUserAssignee();
      if (validationError) return validationError;
    }

    // ------------------------ get devices of the user the notification will go to
    const devices = await prisma.subscribedDevices.findMany({
      where: {
        userId: assigneeUserId,
      },
      include: {
        user: true,
      },
    });

    const afterAppDomain = `${taskBaseUri}project-${task.projectId}/${task.uniqueIndex}`;
    const props = {
      afterAppDomain,
      devices,
      taskId,
      userId: assigneeUserId,
      task,
      currentUser,
      agentId,
      agentAssignerId,
    };

    if (intent === "assign") {
      if (!assign) {
        const result = await createAssignee({
          ...props,
          assigneeIntent: "Assigned",
          includeAgentOwnedAssignments: true,
          expectedProjectId: options?.expectedProjectId ?? task.projectId,
          expectedSectionId: options?.expectedSectionId ?? task.sectionId,
        });
        assignmentOutcome = result.outcome;
        assignStatus = result.outcome === "stale-task" ? "Conflict" : "Assigned";
      } else {
        // Already assigned is an idempotent success. assignmentOutcome below
        // still tells callers whether this request created a row.
        assignStatus = "Assigned";
      }
    } else if (intent === "unassign") {
      if (assign) {
        assignStatus = "Unassigned";
        await removeAssignee({ ...props, assign, assigneeIntent: "Unassigned" });
      } else {
        // Not assigned — idempotent no-op
        assignStatus = "Unassigned";
      }
    } else {
      // toggle (legacy UI): assign or unassign
      if (!assign) {
        assignStatus = "Assigned";
        const result = await createAssignee({
          ...props,
          assigneeIntent: "Assigned",
          expectedProjectId: options?.expectedProjectId ?? task.projectId,
          expectedSectionId: options?.expectedSectionId ?? task.sectionId,
        });
        assignmentOutcome = result.outcome;
      } else {
        assignStatus = "Unassigned";
        await removeAssignee({ ...props, assign, assigneeIntent: "Unassigned" });
      }
    }

    // ============================ Return assignees
    const assignees = await prisma.assignees.findMany({
      where: {
        taskId: taskId,
      },
      include: {
        user: true,
        agent: { select: publicAgentSelect },
      },
    });
    if (assignmentOutcome === "stale-task") {
      // A race-safe auto-assignment is a rejected write, not a successful
      // unassignment. Return a conflict so callers cannot mistake the legacy
      // status field for a completed mutation.
      return {
        status: 409,
        json: {
          message: "Task changed before the assignment could be applied.",
          assignStatus: "Conflict" as const,
          assignmentOutcome,
        },
      };
    }

    return {
      status: 200,
      json: { body: assignees, assignStatus, assignmentOutcome },
    };
  } catch (error) {
    if (error instanceof AgentMutationLeaseConflictError) {
      return { status: 409, json: { message: error.message } };
    }
    console.error("🚀 ~ assigneesAssign ~ error:", error);
    return { status: 500, json: { message: "Internal server error" } };
  }
};

export default assigneesAssign;

interface ICreateAssigneeProps {
  afterAppDomain: string;
  devices: any;
  taskId: number;
  userId: number;
  task: {
    id: number;
    projectId: number;
    title: string;
    ticketNumber: string | null;
  };
  currentUser: IUser;
  agentId?: string;
  agentAssignerId?: string;
  assigneeIntent: "Assigned" | "Unassigned";
  includeAgentOwnedAssignments?: boolean;
  expectedProjectId?: number;
  expectedSectionId?: number | null;
}
const createAssignee = async ({
  afterAppDomain,
  devices,
  taskId,
  userId,
  task,
  currentUser,
  agentId,
  agentAssignerId,
  assigneeIntent,
  includeAgentOwnedAssignments = false,
  expectedProjectId,
  expectedSectionId,
}: ICreateAssigneeProps) => {
  const result = await prisma.$transaction(async (tx) => {
    // Human and agent assignments share the discovery/take fence. Otherwise a
    // person can be assigned after require_unassigned succeeds but before the
    // autonomous self-assignment commits.
    await assertAgentAssignmentChangeAllowed(
      tx,
      taskId,
      agentAssignerId,
      currentUser.id,
      { allowHumanOverride: !agentAssignerId }
    );

    // assigneesAssign reads before entering this transaction. Recheck after
    // taking the fence so two processes cannot both create the same assignment
    // and emit duplicate activities or notifications.
    let existingIdentity:
      | { agentId: string }
      | { userId: number; agentId?: null };
    if (agentId) {
      existingIdentity = { agentId };
    } else if (includeAgentOwnedAssignments) {
      existingIdentity = { userId };
    } else {
      existingIdentity = { userId, agentId: null };
    }

    const existing = await tx.assignees.findFirst({
      where: {
        taskId,
        ...existingIdentity,
      },
      select: { id: true },
    });
    if (existing) {
      return {
        assign: existing,
        outcome: "already-assigned" as const,
        webhookDeliveryId: null,
        boardWebhookDeliveryIds: [],
      };
    }

    if (expectedProjectId !== undefined || expectedSectionId !== undefined) {
      const currentTask = await tx.task.findUnique({
        where: { id: taskId },
        select: { projectId: true, sectionId: true, status: true },
      });
      if (
        !currentTask ||
        currentTask.status !== "Normal" ||
        currentTask.projectId !== expectedProjectId ||
        currentTask.sectionId !== expectedSectionId
      ) {
        return {
          assign: null,
          outcome: "stale-task" as const,
          webhookDeliveryId: null,
          boardWebhookDeliveryIds: [],
        };
      }
    }

    if (!agentAssignerId) {
      await cancelAgentMutationLeaseForHumanOverride(tx, taskId, currentUser.id);
    }
    const assign = await tx.assignees.create({
      data: {
        assignerId: currentUser.id,
        taskId,
        userId,
        agentId,
        agentAssignerId,
      },
      include: {
        user: {
          select: assignmentActivityUserSelect,
        },
        agent: {
          select: {
            id: true,
            userId: true,
            photoURL: true,
            displayName: true,
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
      },
    });
    const follower = await tx.follower.findFirst({
      where: { userId, taskId },
      select: { id: true },
    });

    if (follower) {
      await tx.follower.delete({ where: { id: follower.id } });
    }

    const webhookDeliveryId = agentId
      ? await persistAgentWebhookEvent(tx, {
          event: "task.assigned",
          agentId,
          projectId: task.projectId,
          taskId,
          ticketNumber: task.ticketNumber,
          taskTitle: task.title,
          actor: {
            userId: currentUser.id,
            agentId: agentAssignerId ?? null,
            displayName:
              assign.agentAssigner?.displayName?.trim() ||
              currentUser.displayName?.trim() ||
              "Hypertask user",
          },
        })
      : null;
    // Board-wide subscribers see every assignment, human or agent (HTPR-4530).
    const assignedEvent: WebhookDelivery = {
      event: "task.assigned",
      data: {
        task: {
          id: taskId,
          ticketNumber: task.ticketNumber,
          projectId: task.projectId,
          title: task.title,
        },
        action: "assigned",
        assignee: { userId, agentId: agentId ?? null },
        actor: { userId: currentUser.id, agentId: agentAssignerId ?? null },
      },
    };
    const boardWebhookDeliveryIds = await persistBoardWebhookEvent(
      tx,
      task.projectId,
      assignedEvent,
    );
    return {
      assign,
      outcome: "created" as const,
      webhookDeliveryId,
      boardWebhookDeliveryIds,
    };
  });
  if (result.outcome === "created") {
    await publishAgentWebhookDeliveries([result.webhookDeliveryId]);
    await publishBoardWebhookDeliveries(result.boardWebhookDeliveryIds);
  }

  if (result.outcome !== "created" || !result.assign) return result;
  const assign = result.assign;

  // ======================= create activity of task assignment
  createAssignedActivity({
    taskId: taskId,
    updatedStatus: "Assigned",
    toUser: {
      userId: userId,
      user: assign.user,
      displayName: assign.user.displayName!,
    },
    fromUser: {
      userId: currentUser.id,
      user: currentUser,
      displayName: currentUser.displayName!,
    },
    fromAgent: assign.agentAssigner,
    toAgent: assign.agent,
  });

  // ============================= send notificaiton of assignment
  // Skip notification only when a user assigns themselves, or when an agent assigns itself.
  const isSelfAssign =
    !agentId && shouldSkipSelfAssign(userId, currentUser.id, agentAssignerId);
  const isAgentSelfAssign = !!agentId && agentId === agentAssignerId;
  if (!isSelfAssign && !isAgentSelfAssign) {
    const notificationCreated = await checkReminderAndCreateNotification(
      userId,
      task.projectId,
      taskId,
      {
        assignId: assign.id,
        userId: userId,
        taskId: taskId,
        projectId: task.projectId,
        type: "Assigned",
        fromUserId: currentUser.id,
        ...(agentAssignerId ? { fromAgentId: agentAssignerId } : {}),
        ...(agentId ? { agentId: agentId } : {}),
      }
    );

    let displayName: string = currentUser.displayName ?? "User";
    if (agentAssignerId) {
      const agent = await prisma.agent.findUnique({
        where: {
          id: agentAssignerId,
        },
        select: {
          displayName: true,
        },
      });
      displayName = `${agent?.displayName} (Agent)`;
    }

    if (!isSelfAssign && notificationCreated) {
      const body: IFCMReqBody = {
        type: "newAssignee",
        notificationTitle: `${displayName} assigned you a task`,
        notificationBody: task.title,
        devices: devices,
        payload: assign.user,
        taskTitle: task.title,
        afterAppDomain: afterAppDomain,
      };
  
      await sendDataNewCommentFCM(body);
  
      sendAssignEmail(
        displayName,
        task.title,
        afterAppDomain,
        assigneeIntent,
        assign.user.email,
        task.id
      );
    }
  }
  return result;
};

interface IRemoveAssigneeProps extends ICreateAssigneeProps {
  skipNotificationCleanup?: boolean;
  assign: {
    id: number;
    assignerId: number | null;
    taskId: number;
    userId: number;
    agentId: string | null;
    assignedAt: Date;
    user: {
      id: number;
      displayName?: string | null;
      email: string;
      photoURL?: string | null;
    };
    agent: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    } | null;
    agentAssigner: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    } | null;
  };
}

const removeAssignee = async ({
  afterAppDomain,
  devices,
  taskId,
  userId,
  task,
  currentUser,
  agentAssignerId,
  assign,
  assigneeIntent,
  skipNotificationCleanup,
}: IRemoveAssigneeProps) => {
  const removal = await prisma.$transaction(async (tx) => {
    await assertAgentAssignmentChangeAllowed(
      tx,
      taskId,
      agentAssignerId,
      currentUser.id,
      { allowHumanOverride: !agentAssignerId }
    );
    // Re-read after taking the shared fence. If the row observed by the caller
    // was removed and recreated while this request waited, it is a different
    // assignment and this stale removal must not delete it. When the original
    // still exists, remove only the duplicate rows present under this lock.
    const current = await tx.assignees.findMany({
      where: {
        taskId,
        userId,
        agentId: assign.agentId ?? null,
      },
      select: { id: true },
    });
    if (!current.some(({ id }) => id === assign.id)) {
      return {
        removed: false,
        webhookDeliveryId: null,
        boardWebhookDeliveryIds: [] as string[],
      };
    }
    if (!agentAssignerId) {
      await cancelAgentMutationLeaseForHumanOverride(tx, taskId, currentUser.id);
    }
    await tx.assignees.deleteMany({
      where: { id: { in: current.map(({ id }) => id) } },
    });
    const webhookDeliveryId = assign.agentId
      ? await persistAgentWebhookEvent(tx, {
          event: "task.unassigned",
          agentId: assign.agentId,
          projectId: task.projectId,
          taskId,
          ticketNumber: task.ticketNumber,
          taskTitle: task.title,
          actor: {
            userId: currentUser.id,
            agentId: agentAssignerId ?? null,
            displayName:
              assign.agentAssigner?.displayName?.trim() ||
              currentUser.displayName?.trim() ||
              "Hypertask user",
          },
        })
      : null;
    const unassignedEvent: WebhookDelivery = {
      event: "task.assigned",
      data: {
        task: {
          id: taskId,
          ticketNumber: task.ticketNumber,
          projectId: task.projectId,
          title: task.title,
        },
        action: "unassigned",
        assignee: { userId, agentId: assign.agentId ?? null },
        actor: { userId: currentUser.id, agentId: agentAssignerId ?? null },
      },
    };
    const boardWebhookDeliveryIds = await persistBoardWebhookEvent(
      tx,
      task.projectId,
      unassignedEvent,
    );
    return { removed: true, webhookDeliveryId, boardWebhookDeliveryIds };
  });
  if (!removal.removed) return;
  await publishAgentWebhookDeliveries([removal.webhookDeliveryId]);
  await publishBoardWebhookDeliveries(removal.boardWebhookDeliveryIds);

  await finishRemovingAssignee({
    afterAppDomain,
    devices,
    taskId,
    userId,
    task,
    currentUser,
    agentAssignerId,
    assign,
    assigneeIntent,
    skipNotificationCleanup,
  });
};

const finishRemovingAssignee = async ({
  afterAppDomain,
  devices,
  taskId,
  userId,
  task,
  currentUser,
  agentAssignerId,
  assign,
  assigneeIntent,
  skipNotificationCleanup,
}: IRemoveAssigneeProps) => {
  // ======================== handle assignment activity
  createAssignedActivity({
    taskId: taskId,
    updatedStatus: "Unassigned",
    toUser: {
      userId: userId,
      user: assign.user,
      displayName: assign.user.displayName!,
    },
    fromUser: {
      userId: currentUser.id,
      user: currentUser,
      displayName: currentUser.displayName!,
    },
    fromAgent: assign.agentAssigner,
    toAgent: assign.agent,
  });

  // ======================== handle assignment notification
  if (!skipNotificationCleanup) {
    await prisma.notification.deleteMany({
      where: {
        type: "Assigned",
        taskId: taskId,
        userId: userId,
      },
    });
  }

  const projectMuted = currentUser.id !== userId
    ? await import("@/utils/controllers/notifications/projectMute").then(
      ({ isProjectMuted }) => isProjectMuted(userId, task.projectId),
    )
    : false;

  if (currentUser.id !== userId && !projectMuted) {
    let displayName: string = currentUser.displayName ?? "User";
    if (agentAssignerId) {
      const agent = await prisma.agent.findUnique({
        where: {
          id: agentAssignerId,
        },
        select: {
          displayName: true,
        },
      });
      displayName = `${agent?.displayName} (Agent)`;
    }

    const body: IFCMReqBody = {
      type: "removeAssignee",
      notificationTitle: `${displayName} unassigned you`,
      notificationBody: task.title,
      devices: devices,
      payload: { id: assign.id },
      taskTitle: task.title,
      afterAppDomain: afterAppDomain,
    };

    await sendDataNewCommentFCM(body);

    sendAssignEmail(
      displayName,
      task.title,
      afterAppDomain,
      assigneeIntent,
      assign.user.email,
      task.id
    );
  }
};

export const clearHumanAssignees = async (
  currentUser: {
    id: number;
    email: string;
    displayName?: string | null;
    photoURL?: string | null;
  },
  taskId: number,
  agentAssignerId?: string
) => {
  try {
    const actor: IUser = {
      id: currentUser.id,
      email: currentUser.email,
      displayName: currentUser.displayName ?? undefined,
      photoURL: currentUser.photoURL ?? undefined,
      uid: "",
      stripe_customer_id: "",
      joinedAt: new Date(),
      UserSettingId: "",
      UserSetting: {} as IUser["UserSetting"],
    };
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return { status: 400, json: { message: "Task not found" } };
    }

    const clearAtomically = async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              await assertAgentAssignmentChangeAllowed(
                tx,
                taskId,
                agentAssignerId,
                currentUser.id,
                { allowHumanOverride: !agentAssignerId }
              );
              const current = await tx.assignees.findMany({
                where: { taskId, agentId: null },
                include: {
                  user: {
                    select: assignmentActivityUserSelect,
                  },
                  agent: {
                    select: { id: true, userId: true, photoURL: true, displayName: true },
                  },
                  agentAssigner: {
                    select: { id: true, userId: true, photoURL: true, displayName: true },
                  },
                },
              });
              if (current.length > 0 && !agentAssignerId) {
                await cancelAgentMutationLeaseForHumanOverride(
                  tx,
                  taskId,
                  currentUser.id
                );
              }
              if (current.length > 0) {
                const removedUserIds = [
                  ...new Set(current.map((assign) => assign.userId)),
                ];
                await tx.notification.deleteMany({
                  where: {
                    type: "Assigned",
                    taskId,
                    userId: { in: removedUserIds },
                    agentId: null,
                  },
                });
              }
              await tx.assignees.deleteMany({ where: { taskId, agentId: null } });
              // A bulk clear is still an unassignment per person, so subscribers
              // get the same task.assigned/unassigned rows they would get from
              // removeAssignee, persisted in this transaction (HTPR-4530).
              const boardWebhookDeliveryIds: string[] = [];
              for (const removedUserId of [
                ...new Set(current.map((assign) => assign.userId)),
              ]) {
                const unassignedEvent: WebhookDelivery = {
                  event: "task.assigned",
                  data: {
                    task: {
                      id: taskId,
                      ticketNumber: task.ticketNumber,
                      projectId: task.projectId,
                      title: task.title,
                    },
                    action: "unassigned",
                    assignee: { userId: removedUserId, agentId: null },
                    actor: {
                      userId: currentUser.id,
                      agentId: agentAssignerId ?? null,
                    },
                  },
                };
                boardWebhookDeliveryIds.push(
                  ...(await persistBoardWebhookEvent(
                    tx,
                    task.projectId,
                    unassignedEvent,
                  )),
                );
              }
              const remaining = await tx.assignees.findMany({
                where: { taskId },
                include: {
                  user: true,
                  agent: { select: publicAgentSelect },
                },
              });
              return { removed: current, remaining, boardWebhookDeliveryIds };
            },
            { isolationLevel: "Serializable" }
          );
        } catch (transactionError) {
          const code =
            typeof transactionError === "object" && transactionError !== null && "code" in transactionError
              ? (transactionError as { code?: unknown }).code
              : null;
          if (code !== "P2034" || attempt === 3) throw transactionError;
          await new Promise((resolve) => setTimeout(resolve, attempt * 25));
        }
      }
      throw new Error("Assignee clear retry limit exceeded");
    };

    const cleared = await clearAtomically();
    await publishBoardWebhookDeliveries(cleared.boardWebhookDeliveryIds);

    const uniqueRemoved = [
      ...new Map(
        cleared.removed.map((assign) => [assign.userId, assign])
      ).values(),
    ];
    const afterAppDomain = `${taskBaseUri}project-${task.projectId}/${task.uniqueIndex}`;
    for (const assign of uniqueRemoved) {
      try {
        const devices = await prisma.subscribedDevices.findMany({
          where: { userId: assign.userId },
          include: { user: true },
        });
        await finishRemovingAssignee({
          afterAppDomain,
          devices,
          taskId,
          userId: assign.userId,
          task,
          currentUser: actor,
          agentAssignerId,
          assign,
          assigneeIntent: "Unassigned",
          skipNotificationCleanup: true,
        });
      } catch (sideEffectError) {
        console.warn(
          `Failed to finish assignee clear side effects for task ${taskId} and user ${assign.userId}:`,
          sideEffectError
        );
      }
    }

    return {
      status: 200,
      json: { body: cleared.remaining, assignStatus: "Unassigned" as const },
    };
  } catch (error) {
    if (error instanceof AgentMutationLeaseConflictError) {
      return { status: 409, json: { message: error.message } };
    }
    console.error("clearHumanAssignees error:", error);
    return { status: 500, json: { message: "Internal server error" } };
  }
};
