import prisma from "@/lib/prisma";
import { IUser } from "@/models/model";
import assigneesAssign from "./assign";

type AutoAssignResult = "ready" | "pending";

const inFlightAutoAssignments = new Map<string, Promise<AutoAssignResult>>();

type AutoAssignForSectionProps = {
  taskId: number;
  projectId: number;
  sectionId: number | null;
  /** The acting user. Creation paths that only carry an id pass `currentUserId`. */
  currentUser?: IUser | null;
  currentUserId?: number | null;
  agentAssignerId?: string | null;
};

export function autoAssignForSection(
  props: AutoAssignForSectionProps,
): Promise<AutoAssignResult> {
  const key = [
    props.taskId,
    props.projectId,
    props.sectionId ?? "none",
    props.agentAssignerId ?? "none",
    props.currentUser
      ? `user:${props.currentUser.id}`
      : `user-id:${props.currentUserId ?? "none"}`,
  ].join(":");
  const existing = inFlightAutoAssignments.get(key);
  if (existing) return existing;

  const work = runAutoAssignForSection(props);
  inFlightAutoAssignments.set(key, work);
  // Concurrent callers share this attempt. A pending result is returned only
  // after the promise settles, and this finally block clears the entry before
  // callers can start the next attempt.
  void work
    .finally(() => {
      if (inFlightAutoAssignments.get(key) === work) {
        inFlightAutoAssignments.delete(key);
      }
    })
    .catch(() => {});
  return work;
}

async function runAutoAssignForSection({
  taskId,
  projectId,
  sectionId,
  currentUser,
  currentUserId,
  agentAssignerId,
}: AutoAssignForSectionProps) {
  const needsDurableHandoff = currentUser == null;
  try {
    // The caller's section snapshot can be stale during recovery or after a
    // move. Read the task first and use its current board and section.
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true, sectionId: true, status: true },
    });
    // The outbox derives the event board from the task row. A stale caller
    // snapshot must not strand the creation handoff.
    if (!task) return "ready";
    if (task.status !== "Normal" || !task.sectionId) return "ready";
    if (task.projectId !== projectId) {
      return needsDurableHandoff ? "pending" : "ready";
    }

    const section = await prisma.section.findUnique({
      where: { id: task.sectionId },
      select: {
        projectId: true,
        deleted: true,
        autoAssignAgentId: true,
        autoAssignUserId: true,
      },
    });
    if (
      !section ||
      section.deleted ||
      section.projectId !== task.projectId
    ) {
      // A deleted or mismatched section has no valid auto-assignment target.
      // Treat it as no rule so task.created can still describe the current
      // task instead of retrying a target that cannot exist.
      return "ready";
    }
    const autoAssignUserId = section?.autoAssignUserId;
    const autoAssignAgentId = section?.autoAssignAgentId;
    if (!autoAssignUserId && !autoAssignAgentId) return "ready";

    // Creation paths hand over an id only. assigneesAssign writes the activity
    // row and the notification from this record, so load the real user rather
    // than passing a stub with an empty display name.
    const actor =
      currentUser ??
      ((await prisma.user.findUnique({
        where: { id: currentUserId ?? 0 },
        select: { id: true, email: true, displayName: true, photoURL: true },
      })) as IUser | null);
    // A missing actor is a terminal no-op. The task.created emitter can still
    // publish the task, while a later explicit assignment can repair the rule.
    if (!actor) return "ready";

    const response = await assigneesAssign(
      actor,
      autoAssignUserId ?? null,
      taskId,
      autoAssignAgentId ?? undefined,
      agentAssignerId ?? undefined,
      {
        intent: "assign",
        expectedProjectId: task.projectId,
        expectedSectionId: task.sectionId,
      },
    );

    if (response.status !== 200) {
      console.warn(
        `[autoAssignForSection] Failed to assign ${autoAssignAgentId ? `agent ${autoAssignAgentId}` : `user ${autoAssignUserId}`} to task ${taskId}:`,
        response.json
      );
      // Move and update callers have no durable creation marker. Preserve
      // their existing best-effort behavior. Invalid configuration cannot
      // repair itself by retrying, so creation must still emit task.created.
      // Conflicts and server failures remain pending for the minute sweep.
      const isPermanentConfigurationFailure =
        response.status === 400 || response.status === 404;
      return needsDurableHandoff && !isPermanentConfigurationFailure
        ? "pending"
        : "ready";
    }
    const assignmentOutcome = (
      response.json as { assignmentOutcome?: string } | undefined
    )?.assignmentOutcome;
    if (needsDurableHandoff && assignmentOutcome === "stale-task") return "pending";
    return "ready";
  } catch (error) {
    console.warn(
      `[autoAssignForSection] Failed for task ${taskId} and section ${sectionId}:`,
      error
    );
    // See the response-status branch above. A task-created marker makes the
    // id-only path retryable; moves and edits keep their prior best-effort
    // contract and report completion to their caller.
    return needsDurableHandoff ? "pending" : "ready";
  }
}
