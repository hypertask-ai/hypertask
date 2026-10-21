import prisma from "@/lib/prisma";
import { IUser } from "@/models/model";
import assigneesAssign from "./assign";

type AutoAssignResult = "ready" | "pending";

const inFlightAutoAssignments = new Map<string, Promise<AutoAssignResult>>();

type AutoAssignForSectionProps = {
  taskId: number;
  projectId: number;
  sectionId: number | null;
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
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true, sectionId: true, status: true },
    });
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
      return "ready";
    }
    const autoAssignUserId = section?.autoAssignUserId;
    const autoAssignAgentId = section?.autoAssignAgentId;
    if (!autoAssignUserId && !autoAssignAgentId) return "ready";

    const actor =
      currentUser ??
      ((await prisma.user.findUnique({
        where: { id: currentUserId ?? 0 },
        select: { id: true, email: true, displayName: true, photoURL: true },
      })) as IUser | null);
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
    return needsDurableHandoff ? "pending" : "ready";
  }
}
