import { assertTaskCountTransition, isPlanLimitReachedError, isPlanLimitsEnabled, planLimitResponse } from "@/lib/planLimits";
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { processAnalyticsIntentSoon } from "@/lib/telemetry/analyticsIntents";
import { stripForeignTaskRelations } from "@/lib/tasks/sameBoardRelations";
import { assertParentTaskOnBoard, ParentTaskNotFoundError } from "@/utils/controllers/tasks/parentTaskAccess";
import { enqueueAgentTaskCompletion } from "@/lib/telemetry/activationOccurrences";
import prisma from "@/lib/prisma";
import { ITaskUpdateDescriptionActivity } from "@/models/ActivityModels.ts";
import { IUser } from "@/models/model";
import { Prisma, Status, type Task } from "@prisma/client";
import createActivity from "../activities/createActivity";
import {
  createTaskMovedActivityInTransaction,
  type TaskMovedActivityProps,
} from "../activities/createTaskMovedActivity";
import { sendTaskMoveNotificationIfNeeded } from "../activities/sendTaskMoveNotification";
import sendNotificationForTask from "../notifications/creation-service/createAndSendNotificationTaskMove";
import upsertTaskDescription from "../description/common-description-create";
import scheduleTaskSummaryGeneration from "@/pages/api/queues/FAST/generateSummary";
import {
  upsertAllCommentsToTurbopuffer,
  upsertTaskToTurbopuffer,
} from "../turbopuffer/turbopufferHelper";
import { autoAssignForSection } from "../assignees/autoAssignForSection";
import { scheduleClassifyTaskAiLabels } from "@/lib/ai/labelClassifier";
import { sectionIsDone, spawnNextRecurrence } from "./spawnRecurrence";
import { scheduleAgentFirstTaskEmail } from "../notifications/agentFirstTaskEmail";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  AgentMutationLeaseConflictError,
  TaskTeamScopeError,
  assertAgentAssignmentChangeAllowed,
  cancelAgentMutationLeaseForHumanOverride,
} from "@/lib/mcp/tasks/agentMutationFence";
import { permanentlyDeleteTask } from "./invokeTaskDelete";
import {
  persistBoardWebhookEvent,
  publishBoardWebhookDeliveries,
} from "@/lib/mcp/webhooks/outbox";
import {
  persistAgentTaskUpdatedWebhook,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import type { AgentWebhookTaskChanges } from "@/lib/agentWebhooks/events";
import type {
  WebhookDelivery,
  WebhookTaskChanges,
} from "@/lib/mcp/webhooks/events";
import {
  hasRequestedTaskStateChange,
  normalizeRequestedTaskMutation,
  requestedTaskStateChanges,
  taskLifecycleTimestampChanges,
} from "@/lib/mcp/tasks/humanMutationOverride";
import {
  AgentDoneLifecycleDeniedError,
  assertAgentMayLeaveDone,
} from "@/lib/mcp/tasks/agentDoneLifecycle";
import {
  assertCycleAssignable,
  CycleAssignmentError,
} from "@/lib/cycleService";

type UpdateTaskSingleOptions = {
  teamScope?: AgentTokenTeamScope | null;
  allowProjectChange?: boolean;
  onProjectChangedInTx?: (
    tx: Prisma.TransactionClient,
    before: Task,
    after: Task,
  ) => Promise<void>;
  skipAutoAssign?: boolean;
  skipRecurrence?: boolean;
  trustedCaller?: boolean;
  expectedDescription?: string;
  expectedTitle?: string;
  expectedProjectId?: number;
  expectedStatus?: Status;
  taskMovedActivity?: Pick<
    TaskMovedActivityProps,
    "fromAgent" | "sendNotification"
  >;
};

class TaskDescriptionChangedError extends Error {}
class TaskTitleChangedError extends Error {}
class TaskTargetChangedError extends Error {}
class FlagColumnMismatchError extends Error {}

export const TASK_IDENTITY_CONFLICT_CODE = "TASK_IDENTITY_CONFLICT";

function isTaskIdentityConflict(error: unknown): boolean {
  const target =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.meta?.target
      : undefined;
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(target) &&
    target.includes("projectId") &&
    target.includes("uniqueIndex")
  );
}

type UpdateTaskSingleResult = {
  status: number;
  json: any;
  oldTask?: any;
  commentActivity?: any;
  moveActivity?: Awaited<
    ReturnType<typeof createTaskMovedActivityInTransaction>
  > | null;
};

export async function updateTaskSingle(
  newTask: any,
  currentUser: IUser,
  agentId?: string | null,
  options: UpdateTaskSingleOptions = {},
): Promise<UpdateTaskSingleResult> {
  try {
    if (!newTask || !newTask.id || !currentUser) {
      return {
        status: 500,
        json: { message: "Missing required information" },
      };
    }
    const oldTask = await prisma.task.findUnique({
      where: {
        id: newTask.id,
      },
      include: { description_: { select: { content: true } } },
    });
    console.log("🤔 ~ updateTaskSingle ~ oldTask:", oldTask);

    if (!oldTask) {
      return {
        status: 404,
        json: { message: "Task not found" },
      };
    }

    if (!options.trustedCaller || options.teamScope != null) {
      const allowed = await prisma.project.findFirst({
        where: {
          id: oldTask.projectId,
          ...taskWriteAccessWhere(currentUser.id, agentId, options.teamScope),
        },
        select: { id: true },
      });
      if (!allowed) {
        return {
          status: 404,
          json: { message: "Task not found" },
        };
      }
    }

    recordAgentBoardScopeMiss(oldTask.projectId, "write");
    let taskBeforeWrite = oldTask;
    let sectionChanged = false;
    let sectionIdChanged = false;
    const normalizedTask = normalizeRequestedTaskMutation(newTask);
    const nestedWriteKeys = [
      "connect", "connectOrCreate", "create", "createMany", "set",
      "disconnect", "delete", "deleteMany", "update", "updateMany", "upsert",
    ];
    if (Object.values(normalizedTask).some((value) =>
      value !== null && typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
      nestedWriteKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))
    )) {
      return {
        status: 400,
        json: { message: "Nested writes are not allowed" },
      };
    }
    if (
      normalizedTask.projectId !== undefined &&
      normalizedTask.projectId !== oldTask.projectId &&
      !options.allowProjectChange
    ) {
      return {
        status: 400,
        json: { message: "Use the cross-board move endpoint to change project" },
      };
    }
    const isHumanOverride = !agentId && !options.trustedCaller;
    const taskAtRequestTime = {
      ...oldTask,
      description: oldTask.description_?.content ?? oldTask.description,
    };
    const requestedMutation = isHumanOverride
      ? requestedTaskStateChanges(taskAtRequestTime, normalizedTask)
      : normalizedTask;

    const taskInclude = {
      description_: true,
      user: true,
      project: {
        select: {
          team: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    } satisfies Prisma.TaskInclude;
    const {
      task,
      newComment,
      moveActivity,
      boardWebhookDeliveryIds,
      agentWebhookDeliveryIds = [],
      analyticsKey,
    } = await prisma.$transaction(
      async (tx) => {
        const enforceMoveLimits = options.allowProjectChange && requestedMutation.projectId !== undefined && await isPlanLimitsEnabled(currentUser.id);
        if (options.allowProjectChange && requestedMutation.projectId !== undefined && !enforceMoveLimits) {
          const projectIds = [...new Set([oldTask.projectId, requestedMutation.projectId as number])].sort((a, b) => a - b);
          for (const projectId of projectIds) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(9428471::int, ${projectId}::int)`;
          }
          const destination = await tx.project.findUnique({
            where: { id: requestedMutation.projectId as number },
            select: { uniqueIdentifier: true },
          });
          if (!destination?.uniqueIdentifier) throw new Error("Destination board has no ticket prefix");
          requestedMutation.ticketNumber = `${destination.uniqueIdentifier}-${requestedMutation.uniqueIndex ?? oldTask.uniqueIndex}`;
        }

        if (typeof requestedMutation.cycleId === "number") {
          await assertCycleAssignable(
            tx,
            (requestedMutation.projectId as number | undefined) ?? oldTask.projectId,
            requestedMutation.cycleId,
          );
        }
        await assertAgentAssignmentChangeAllowed(
          tx,
          newTask.id,
          agentId,
          currentUser.id,
          {
            allowHumanOverride: isHumanOverride,
            teamScope: options.teamScope,
          },
        );
        if (options.teamScope != null && requestedMutation.projectId !== undefined && !await tx.project.findFirst({
          where: { id: requestedMutation.projectId as number, ...taskWriteAccessWhere(currentUser.id, agentId, options.teamScope) },
          select: { id: true },
        })) throw new TaskTeamScopeError()
        const currentState = await tx.task.findUnique({
          where: { id: newTask.id },
          include: { description_: { select: { content: true } } },
        });
        if (!currentState) throw new Error("Task not found");
        if (
          (options.expectedProjectId !== undefined && currentState.projectId !== options.expectedProjectId) ||
          (options.expectedStatus !== undefined && currentState.status !== options.expectedStatus)
        ) {
          throw new TaskTargetChangedError();
        }
        if (options.expectedTitle !== undefined && currentState.title !== options.expectedTitle) {
          throw new TaskTitleChangedError();
        }
        if (
          options.expectedDescription !== undefined &&
          (currentState.description_?.content ?? "") !==
            options.expectedDescription
        ) {
          throw new TaskDescriptionChangedError();
        }
        taskBeforeWrite = currentState;
        await assertAgentMayLeaveDone(
          tx,
          currentState,
          requestedMutation.status,
          agentId,
        );

        if (isHumanOverride) {
          const currentComparableState = {
            ...currentState,
            description:
              currentState.description_?.content ?? currentState.description,
          };
          if (
            hasRequestedTaskStateChange(
              currentComparableState,
              requestedMutation,
            )
          ) {
            await cancelAgentMutationLeaseForHumanOverride(
              tx,
              newTask.id,
              currentUser.id,
            );
          } else {
            await assertAgentAssignmentChangeAllowed(
              tx,
              newTask.id,
              null,
              currentUser.id,
            );
          }
        }

        const updateData: any = {
          title: currentState.title,
          description: currentState.description,
          section: currentState.section,
          sectionId: currentState.sectionId,
          userId: currentState.userId,
          status: currentState.status,
          ranking: currentState.ranking,
          archivedAt: currentState.archivedAt,
          deletedAt: currentState.deletedAt,
          updatedAt: currentState.updatedAt,
          parentTaskId: currentState.parentTaskId,
          uniqueIndex: currentState.uniqueIndex,
          projectId: currentState.projectId,
          dueDate: currentState.dueDate,
        };
        for (const key in requestedMutation) {
          if (requestedMutation[key] !== undefined) {
            updateData[key] = requestedMutation[key];
          }
        }
        Object.assign(
          updateData,
          taskLifecycleTimestampChanges(
            requestedMutation.status,
            new Date(),
          ),
        );
        const targetProject = updateData.projectId;
        if (
          updateData.parentTaskId != null &&
          (updateData.parentTaskId !== currentState.parentTaskId ||
            targetProject !== currentState.projectId)
        ) {
          await assertParentTaskOnBoard(tx, updateData.parentTaskId, targetProject);
        }
        const requestedSectionId = requestedMutation.sectionId;
        const requestedSectionName = requestedMutation.section;
        sectionIdChanged =
          requestedSectionId !== undefined &&
          requestedSectionId !== currentState.sectionId;
        const sectionNameChanged =
          requestedSectionName !== undefined &&
          requestedSectionName !== currentState.section;
        sectionChanged = sectionIdChanged || sectionNameChanged;
        if (sectionIdChanged) {
          if (requestedSectionId === null) {
            if (
              requestedSectionName !== undefined &&
              requestedSectionName !== null
            ) {
              throw new Error("Section does not match sectionId");
            }
            updateData.section = "";
          } else {
            if (typeof requestedSectionId !== "number") {
              throw new Error("Section not found");
            }
            const targetSection = await tx.section.findFirst({
              where: {
                id: requestedSectionId,
                projectId:
                  requestedMutation.projectId ?? currentState.projectId,
              },
              select: { section_title: true },
            });
            if (!targetSection) throw new Error("Section not found");
            if (
              requestedSectionName !== undefined &&
              requestedSectionName !== targetSection.section_title
            ) {
              throw new Error("Section does not match sectionId");
            }
            updateData.section = targetSection.section_title;
          }
        }
        if (sectionChanged && targetProject === 15 && updateData.section === "Flag: Everyone") {
          const { listFeatureFlagModes } = await import("@/lib/flags");
          const { unreleasedTicketFlags } = await import("@/lib/flags/taskColumn");
          const blocked = unreleasedTicketFlags({
            uniqueIndex: updateData.uniqueIndex,
            description: typeof requestedMutation.description === "string"
              ? requestedMutation.description
              : currentState.description_?.content ?? currentState.description,
          }, await listFeatureFlagModes());
          if (blocked.length) {
            throw new FlagColumnMismatchError(`Cannot move to Flag: Everyone. Not released: ${blocked.map(({ key, mode }) => `${key} (${mode})`).join(", ")}.`);
          }
        }
        if (sectionChanged) updateData.sectionChangedAt = new Date();
        updateData.updatedAt = new Date();

        await assertTaskCountTransition(tx, currentState, updateData, {
          actorUserId: currentUser.id,
          agentId,
          entryPoint: "task.update",
        });
        if (enforceMoveLimits) {
          const projectIds = [...new Set([currentState.projectId, requestedMutation.projectId as number])].sort((a, b) => a - b);
          for (const projectId of projectIds) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(9428471::int, ${projectId}::int)`;
          }
          const destination = await tx.project.findUnique({
            where: { id: requestedMutation.projectId as number },
            select: { uniqueIdentifier: true },
          });
          if (!destination?.uniqueIdentifier) throw new Error("Destination board has no ticket prefix");
          updateData.ticketNumber = `${destination.uniqueIdentifier}-${requestedMutation.uniqueIndex ?? currentState.uniqueIndex}`;
        }

        if (
          updateData.projectId !== currentState.projectId ||
          updateData.uniqueIndex !== currentState.uniqueIndex
        ) {
          await tx.taskNumberAlias.upsert({
            where: {
              projectId_uniqueIndex: {
                projectId: currentState.projectId,
                uniqueIndex: currentState.uniqueIndex,
              },
            },
            create: {
              projectId: currentState.projectId,
              uniqueIndex: currentState.uniqueIndex,
              ticketNumber: currentState.ticketNumber,
              taskId: currentState.id,
            },
            update: {
              ticketNumber: currentState.ticketNumber,
              taskId: currentState.id,
            },
          });
        }

        let updatedTask = await tx.task.update({
          where: { id: newTask.id },
          data: updateData,
          include: taskInclude,
        });
        if (currentState.projectId !== updatedTask.projectId) {
          await options.onProjectChangedInTx?.(tx, currentState, updatedTask);
        }
        sectionIdChanged = currentState.sectionId !== updatedTask.sectionId;
        sectionChanged =
          sectionIdChanged || currentState.section !== updatedTask.section;
        if (sectionChanged) {
          await tx.taskSectionEvent.create({
            data: {
              taskId: updatedTask.id,
              from: currentState.section ?? "",
              to: updatedTask.section ?? "",
              userId: currentUser.id,
            },
          });
        }
        let moveActivity = null;
        if (sectionIdChanged) {
          let taskMoveAgent = options.taskMovedActivity?.fromAgent;
          if (taskMoveAgent === undefined && agentId) {
            taskMoveAgent = await tx.agent.findUnique({
              where: { id: agentId },
              select: {
                id: true,
                userId: true,
                displayName: true,
                photoURL: true,
              },
            });
          }
          moveActivity = await createTaskMovedActivityInTransaction({
            transaction: tx,
            taskId: updatedTask.id,
            userObj: currentUser,
            toSectionId: updatedTask.sectionId,
            toSection_title: updatedTask.section ?? "",
            fromSectionId: currentState.sectionId,
            fromSection_title: currentState.section ?? "",
            fromAgent: taskMoveAgent,
          });
        }
        let descriptionActivity;
        if (requestedMutation.description !== undefined) {
          const [, , fullUser, actingAgent] = await Promise.all([
            upsertTaskDescription(
              {
                content: requestedMutation.description as string,
                taskId: newTask.id,
                creatorId: taskBeforeWrite.userId!,
                agentId: agentId ?? null,
                actingUserId: currentUser.id,
              },
              tx,
            ),
            tx.drafts.deleteMany({
              where: {
                type: "Description",
                taskId: newTask.id,
                userId: currentUser.id,
              },
            }),
            tx.user.findUnique({
              where: { id: currentUser.id },
              select: {
                id: true,
                email: true,
                displayName: true,
                photoURL: true,
              },
            }),
            agentId
              ? tx.agent.findUnique({
                  where: { id: agentId },
                  select: {
                    id: true,
                    userId: true,
                    displayName: true,
                    photoURL: true,
                  },
                })
              : Promise.resolve(null),
          ]);
          const userForActivity = fullUser
            ? { ...currentUser, photoURL: fullUser.photoURL ?? undefined }
            : currentUser;
          const activityBody: ITaskUpdateDescriptionActivity = {
            type: "TaskDescriptionUpdate",
            data: {
              fromUserId: currentUser.id,
              fromUserDisplayName: currentUser.displayName ?? "",
              fromUser: userForActivity,
              fromAgent: actingAgent ?? null,
            },
          };
          descriptionActivity = await createActivity({
            activityBody,
            taskId: newTask.id,
            runTaskSummary: false,
            transaction: tx,
          });
          updatedTask = await tx.task.findUniqueOrThrow({
            where: { id: newTask.id },
            include: taskInclude,
          });
        }
        const changes: Record<string, unknown> = {};
        if (currentState.sectionId !== updatedTask.sectionId) {
          const sectionIds = [
            currentState.sectionId,
            updatedTask.sectionId,
          ].filter((id): id is number => typeof id === "number");
          const sections = sectionIds.length
            ? await tx.section.findMany({
                where: { id: { in: sectionIds } },
                select: { id: true, section_title: true },
              })
            : [];
          const toRef = (id: number | null) => {
            const found = sections.find((section) => section.id === id);
            return found ? { id: found.id, title: found.section_title } : null;
          };
          changes.section = {
            from: toRef(currentState.sectionId),
            to: toRef(updatedTask.sectionId),
          };
        }
        if (currentState.status !== updatedTask.status) {
          changes.status = {
            from: currentState.status,
            to: updatedTask.status,
          };
        }
        const dueFrom = currentState.dueDate?.toISOString() ?? null;
        const dueTo = updatedTask.dueDate?.toISOString() ?? null;
        if (dueFrom !== dueTo) {
          changes.dueDate = { from: dueFrom, to: dueTo };
        }
        const agentChanges: AgentWebhookTaskChanges = {};
        if (changes.section) {
          agentChanges.section = changes.section as AgentWebhookTaskChanges["section"];
        }
        if (changes.status) {
          agentChanges.status = changes.status as AgentWebhookTaskChanges["status"];
        }
        const agentWebhookDeliveryIds = Object.keys(agentChanges).length
          ? await persistAgentTaskUpdatedWebhook(tx, {
              taskId: updatedTask.id,
              actor: {
                userId: currentUser.id,
                agentId: agentId ?? null,
                displayName: currentUser.displayName,
              },
              changes: agentChanges,
            })
          : [];
        const updatedEvent: WebhookDelivery = {
          event: "task.updated",
          data: {
            task: {
              id: updatedTask.id,
              ticketNumber: updatedTask.ticketNumber,
              projectId: updatedTask.projectId,
              title: updatedTask.title,
            },
            changes: changes as unknown as WebhookTaskChanges,
            actor: { userId: currentUser.id, agentId: agentId ?? null },
          },
        };
        const boardWebhookDeliveryIds = Object.keys(changes).length
          ? await persistBoardWebhookEvent(
              tx,
              updatedTask.projectId,
              updatedEvent,
            )
          : [];
        return {
          analyticsKey: await enqueueAgentTaskCompletion(tx, currentState, updatedTask, agentId),
          task: updatedTask,
          newComment: descriptionActivity,
          moveActivity,
          boardWebhookDeliveryIds,
          agentWebhookDeliveryIds,
        };
      },
      { timeout: 60_000 },
    );
    if (!options.trustedCaller) {
      scheduleAgentFirstTaskEmail(taskBeforeWrite, task, currentUser.id, agentId);
    }
    if (analyticsKey) processAnalyticsIntentSoon(analyticsKey);
    const moveNotification =
      moveActivity && options.taskMovedActivity?.sendNotification
        ? sendTaskMoveNotificationIfNeeded(
            moveActivity,
            options.taskMovedActivity.sendNotification,
          ).catch((error) => {
            console.warn(
              "[task-move] Notification failed after the task update committed.",
              error,
            );
            return false;
          })
        : Promise.resolve(false);
    await Promise.all([
      agentWebhookDeliveryIds.length > 0
        ? publishAgentWebhookDeliveries(agentWebhookDeliveryIds)
        : Promise.resolve(),
      boardWebhookDeliveryIds.length > 0
        ? publishBoardWebhookDeliveries(boardWebhookDeliveryIds)
        : Promise.resolve(),
      moveNotification,
    ]);

    if (requestedMutation.description !== undefined) {
      try {
        await sendNotificationForTask(
          currentUser.id,
          "TaskUpdateDescription",
          taskBeforeWrite.id,
          taskBeforeWrite.projectId,
          agentId ?? null,
        );
      } catch (notificationError) {
        console.log(
          "🤔 ~ updateTaskSingle ~ description notification error:",
          notificationError,
        );
      }
    }

    if (sectionIdChanged && !options.skipAutoAssign) {
      const autoAssigned = await autoAssignForSection({
        taskId: task.id,
        projectId: task.projectId,
        sectionId: task.sectionId,
        currentUser,
        agentAssignerId: agentId,
      });
      if (autoAssigned !== "ready") {
        console.warn(
          "[task-update] column auto-assignment remains pending after the task move",
          { taskId: task.id },
        );
      }
    }

    if (taskBeforeWrite.recurrence && !options.skipRecurrence) {
      const becameArchived =
        requestedMutation.status === Status.Archive &&
        taskBeforeWrite.status !== Status.Archive;
      try {
        if (
          becameArchived ||
          (sectionIdChanged && (await sectionIsDone(task.sectionId)))
        ) {
          await spawnNextRecurrence(task.id, taskBeforeWrite.dueDate, currentUser.id, agentId);
        }
      } catch (error) {
        console.log("🤔 ~ updateTaskSingle ~ recurrence spawn error:", error);
      }
    }

    upsertTaskToTurbopuffer(task.id);
    if (
      requestedMutation.status ||
      requestedMutation.ticketNumber ||
      requestedMutation.uniqueIndex ||
      requestedMutation.projectId
    )
      upsertAllCommentsToTurbopuffer(task.id);
    const titleChanged =
      requestedMutation.title !== undefined &&
      requestedMutation.title !== taskBeforeWrite.title;
    const descriptionChanged =
      requestedMutation.description !== undefined &&
      requestedMutation.description !==
        ((taskBeforeWrite as any).description_?.content ??
          taskBeforeWrite.description);
    scheduleTaskSummaryGeneration({
      taskId: newTask.id,
      agentId: agentId ?? null,
      activityOnlyOwnerId:
        !titleChanged &&
        !descriptionChanged &&
        requestedMutation.ticketNumber === undefined &&
        requestedMutation.projectId === undefined
          ? taskBeforeWrite.userId
          : null,
    });
    if (titleChanged || descriptionChanged) {
      scheduleClassifyTaskAiLabels(task.id, task.projectId);
    }

    return {
      status: 200,
      json: task,
      oldTask: taskBeforeWrite,
      commentActivity: newComment,
      moveActivity,
    };
  } catch (error) {
    if (isPlanLimitReachedError(error)) {
      const refusal = planLimitResponse(error);
      return { status: refusal.status, json: refusal.body };
    }
    if (error instanceof FlagColumnMismatchError) {
      return { status: 409, json: { message: error.message, code: "FLAG_COLUMN_MISMATCH" } };
    }
    if (error instanceof TaskTeamScopeError) return { status: 404, json: { message: error.message } };
    if (error instanceof ParentTaskNotFoundError) {
      return {
        status: 404,
        json: { message: "Parent task not found" },
      };
    }
    if (error instanceof TaskTargetChangedError) {
      return {
        status: 409,
        json: { message: "This task moved or changed status. Your note is still here." },
      };
    }
    if (error instanceof TaskTitleChangedError) {
      return {
        status: 409,
        json: { message: "This task is no longer empty. Your note is still here." },
      };
    }
    if (error instanceof TaskDescriptionChangedError) {
      return {
        status: 409,
        json: { message: "Description changed before it could be restored" },
      };
    }
    if (error instanceof AgentMutationLeaseConflictError) {
      return {
        status: 409,
        json: { message: error.message },
      };
    }
    if (error instanceof CycleAssignmentError) {
      return {
        status: error.status,
        json: { message: error.message },
      };
    }
    if (error instanceof AgentDoneLifecycleDeniedError) {
      return {
        status: error.status,
        json: { message: error.message, code: error.code },
      };
    }
    if (isTaskIdentityConflict(error)) {
      return {
        status: 409,
        json: {
          message: "Task identity is already in use",
          code: TASK_IDENTITY_CONFLICT_CODE,
        },
      };
    }
    console.log("🤔 ~ updateTaskSingle ~ error:", error);
    return {
      status: 500,
      json: { message: "Failed to update task" },
    };
  }
}

export async function getTaskSingle(taskId: number) {
  try {
    const task = await prisma.task.findUnique({
      where: {
        id: taskId,
      },
      include: {
        taskLabels: {
          select: {
            label: true,
            labelId: true,
            id: true,
            taskId: true,
          },
        },
        estimate: true,
        priority: true,
        description_: { select: { content: true } },
        subTasks: {
          where: {
            status: {
              not: "Deleted",
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
        parentTask: {
          include: {
            subTasks: { where: { status: { not: "Deleted" } } },
          },
        },
      },
    });
    return {
      status: 200,
      json: task ? stripForeignTaskRelations(task) : task,
    };
  } catch (error) {
    console.log("🤔 ~ getTask ~ error:", error);
    return {
      status: 500,
      json: { message: "Failed to load task" },
    };
  }
}

export async function deleteTaskSingle(taskId: number, actingUserId: number) {
  try {
    const deleteResult = await permanentlyDeleteTask(taskId, actingUserId);
    return {
      status: deleteResult === "success" ? 200 : 409,
      json:
        deleteResult === "success"
          ? { id: taskId }
          : { message: "Task is being restored or permanently deleted" },
    };
  } catch (error) {
    console.log("🤔 ~ deleteTaskSingle ~ error:", error);
    return {
      status: 500,
      json: { message: "Failed to delete task" },
    };
  }
}
