import prisma from "@/lib/prisma";
import { ITaskUpdateDescriptionActivity } from "@/models/ActivityModels.ts";
import { IUser } from "@/models/model";
import { Prisma, Status } from "@prisma/client";
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
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  AgentMutationLeaseConflictError,
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
  assertCycleAssignable,
  CycleAssignmentError,
} from "@/lib/cycleService";

type UpdateTaskSingleOptions = {
  allowProjectChange?: boolean;
  skipAutoAssign?: boolean;
  // HTPR-4885: suppress the recurrence spawn for archives that mean "nobody
  // touched this" rather than "this is finished" — see sweepAutoArchive.
  skipRecurrence?: boolean;
  // HTPR-4982: skip the membership check below. Only for server-internal
  // callers that already established their own trust (cron sweeps, verified
  // webhooks, maintenance scripts) — never for anything carrying a task id
  // that came in over the wire.
  trustedCaller?: boolean;
  // Compare under the mutation fence so a restore cannot replace a newer edit.
  expectedDescription?: string;
  // Every section-ID change creates activity. This only supplies actor detail
  // and the post-commit notification used by move-specific callers.
  taskMovedActivity?: Pick<
    TaskMovedActivityProps,
    "fromAgent" | "sendNotification"
  >;
};

class TaskDescriptionChangedError extends Error {}

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

    // HTPR-4982: the gate for every write route. Callers hand us a task id
    // straight from a request body and none of them checked the caller could
    // see that board, so any signed-in user could edit any task by id. It
    // lives here rather than in each route so a new route cannot forget it.
    // 404 rather than 403: a stranger learns nothing about which ids exist.
    if (!options.trustedCaller) {
      const allowed = await prisma.project.findFirst({
        where: {
          id: oldTask.projectId,
          ...taskWriteAccessWhere(currentUser.id, agentId),
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

    let taskBeforeWrite = oldTask;
    let sectionChanged = false;
    let sectionIdChanged = false;
    const normalizedTask = normalizeRequestedTaskMutation(newTask);
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
    // Browser callers historically sometimes send a whole task object even
    // though this endpoint has patch semantics. Preserve only fields that
    // differed when the request arrived. If an agent writes another field
    // while this request waits for the fence, the human mutation cannot
    // restore that stale snapshot value.
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
    // Every task update must serialize with autonomous ownership, not only
    // terminal status changes. Human writes pass no agentId and are rejected
    // while a managed agent lease is active; the lease-owning agent may
    // continue its own mutation.
    const {
      task,
      newComment,
      moveActivity,
      boardWebhookDeliveryIds,
      agentWebhookDeliveryIds = [],
    } = await prisma.$transaction(
      async (tx) => {
        if (typeof requestedMutation.cycleId === "number") {
          await assertCycleAssignable(
            tx,
            (requestedMutation.projectId as number | undefined) ?? oldTask.projectId,
            requestedMutation.cycleId,
          );
        }
        // A person's explicit task change always outranks autonomous work.
        // The browser does not carry an agentId, so moving, editing, restoring,
        // archiving, or deleting a task must cancel any live agent lease while
        // holding the same fence. Trusted background callers are not people and
        // remain fenced. Otherwise the optimistic UI briefly moves the card,
        // receives a 409, and snaps it back to the old column.
        await assertAgentAssignmentChangeAllowed(
          tx,
          newTask.id,
          agentId,
          currentUser.id,
          {
            allowHumanOverride: isHumanOverride,
          },
        );
        const currentState = await tx.task.findUnique({
          where: { id: newTask.id },
          include: { description_: { select: { content: true } } },
        });
        if (!currentState) throw new Error("Task not found");
        if (
          options.expectedDescription !== undefined &&
          (currentState.description_?.content ?? "") !==
            options.expectedDescription
        ) {
          throw new TaskDescriptionChangedError();
        }
        taskBeforeWrite = currentState;

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
            // A duplicate/no-op request is not an override signal. Keep the
            // live lease and reject the stale write exactly as an agent race.
            await assertAgentAssignmentChangeAllowed(
              tx,
              newTask.id,
              null,
              currentUser.id,
            );
          }
        }

        // Build from the state read under the mutation fence, never from the
        // pre-transaction lookup. A human override may wait behind an agent
        // write; reusing the earlier snapshot would silently restore fields
        // the agent changed before releasing the lock.
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
          ticketNumber: currentState.ticketNumber,
          parentTaskId: currentState.parentTaskId,
          uniqueIndex: currentState.uniqueIndex,
          projectId: currentState.projectId,
          dueDate: currentState.dueDate,
        };
        // startDate and recurrence are deliberately NOT seeded. Writing every
        // seeded key could resurrect a recurrence rule that another completion
        // just claimed. Prisma leaves omitted columns unchanged.
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
            // sectionId is the nullable identity; Task.section is required
            // legacy display text, so unassigned tasks store an empty name.
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
        if (sectionChanged) updateData.sectionChangedAt = new Date();
        updateData.updatedAt = new Date();

        let updatedTask = await tx.task.update({
          where: { id: newTask.id },
          data: updateData,
          include: taskInclude,
        });
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
          // Core task fields, the normalized body, draft cleanup, and activity
          // either all commit under this ownership fence or all roll back.
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
            // A managed agent edits under its owner's user id, so without the
            // agent the feed credited the human for an edit they never made.
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
        // HTPR-4530: board subscribers get task.updated for the fields the
        // public contract covers. The outbox row commits with the task write,
        // so a rolled-back update can never emit a phantom change.
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
        // This controller writes section, status, and due-date fields only.
        // Label controllers emit their own task.updated row with the full
        // before/after label snapshot, so labels cannot be dropped here.
        // Due dates remain board-only because the agent event contract covers
        // section, status, and labels.
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
          task: updatedTask,
          newComment: descriptionActivity,
          moveActivity,
          boardWebhookDeliveryIds,
          agentWebhookDeliveryIds,
        };
      },
      { timeout: 60_000 },
    );
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

    // HTPR-4885: completing a recurring task (done column or archive) spawns
    // its next occurrence. spawnNextRecurrence claims the rule atomically, so
    // overlapping paths (drag + auto-archive sweep) can't double-spawn.
    if (taskBeforeWrite.recurrence && !options.skipRecurrence) {
      const becameArchived =
        requestedMutation.status === Status.Archive &&
        taskBeforeWrite.status !== Status.Archive;
      try {
        if (
          becameArchived ||
          (sectionIdChanged && (await sectionIsDone(task.sectionId)))
        ) {
          await spawnNextRecurrence(task.id, taskBeforeWrite.dueDate);
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
    scheduleTaskSummaryGeneration({
      taskId: newTask.id,
      agentId: agentId ?? null,
    });
    const titleChanged =
      requestedMutation.title !== undefined &&
      requestedMutation.title !== taskBeforeWrite.title;
    const descriptionChanged =
      requestedMutation.description !== undefined &&
      requestedMutation.description !==
        ((taskBeforeWrite as any).description_?.content ??
          taskBeforeWrite.description);
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
    console.log("🤔 ~ updateTaskSingle ~ error:", error);
    return {
      status: 500,
      // Never hand the caller the raw error object: `new Error(obj)` in the
      // MCP layer turned it into "[object Object]". Detail stays in the log.
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
        // description_ holds the real body; the `description` scalar is always "" since createTaskCore
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
      json: task,
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
      // HTPR-5478: `{ message: error }` serialises to `{"message":{}}`, which
      // the CLI printed as "[object Object]". Detail stays in the log.
      json: { message: "Failed to delete task" },
    };
  }
}
