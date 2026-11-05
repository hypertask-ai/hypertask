import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8737_BULK_MOVE_BOARD_FLAG } from "@/lib/flags/definitions/htpr-8737-bulk-move-board";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import prisma from "@/lib/prisma";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { moveTaskToDifferentBoard } from "@/utils/controllers/tasks/moveToDifferentBoard";
import { isPlanLimitReachedError } from "@/lib/planLimits";
import { toErrorMessage } from "@/lib/api/errorMessage";
import { broadcastBoardChange } from "@/lib/realtime/server";

const positiveId = z.number().int().positive();

export const POST = taskWriteRoute({
  schema: z.object({ ids: z.array(positiveId).min(1).max(500), sourceProjectId: positiveId, projectId: positiveId, sectionId: positiveId, agentId: z.string().optional() }),
  validationMessage: "Invalid move request",
  prepare: async (session) => ({ session, currentUser: await loadSessionUserRecord(session.userId) }),
  operation: async ({ ids, sourceProjectId, projectId, sectionId }, { session, currentUser }) => {
    if (!(await isFeatureEnabled(HTPR_8737_BULK_MOVE_BOARD_FLAG, session.userId))) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }
    if (sourceProjectId === projectId) {
      return NextResponse.json({ message: "Choose another board" }, { status: 400 });
    }
    const source = await prisma.project.findFirst({
      where: { id: sourceProjectId, ...taskWriteAccessWhere(session.userId, session.agentId, session.teamScope) },
      select: { id: true },
    });
    if (!source) return NextResponse.json({ message: "Source board unavailable. Check your access." }, { status: 404 });
    const section = await prisma.section.findFirst({
      where: { id: sectionId, projectId, deleted: false, visibility: true, project: taskWriteAccessWhere(session.userId, session.agentId, session.teamScope) },
      select: { id: true },
    });
    if (!section) return NextResponse.json({ message: "Destination column unavailable. Check your access and choose a visible column." }, { status: 404 });
    const selected = [...new Set(ids)];
    const tasks = await prisma.task.findMany({
      where: { projectId: sourceProjectId },
      select: { id: true, parentTaskId: true },
    });
    const parents = new Map(tasks.map((task) => [task.id, task.parentTaskId]));
    const selectedSet = new Set(selected);
    const roots = selected.filter((id) => {
      if (!parents.has(id)) return false;
      const visited = new Set([id]);
      let parent = parents.get(id);
      while (parent != null && !visited.has(parent)) {
        if (selectedSet.has(parent)) return false;
        visited.add(parent);
        parent = parents.get(parent);
      }
      return true;
    });
    const errors = new Map<number, string>();
    for (const taskId of roots) {
      try {
        const current = await prisma.task.findFirst({
          where: { id: taskId, projectId: sourceProjectId, project: taskWriteAccessWhere(session.userId, session.agentId, session.teamScope) },
          select: { id: true },
        });
        if (!current) {
          errors.set(taskId, "Ticket is no longer accessible on the source board.");
          continue;
        }
        const result = await moveTaskToDifferentBoard({ taskId, targetProjectId: projectId, targetSectionId: sectionId, currentProjectId: sourceProjectId, currentUser, agentId: session.agentId, teamScope: session.teamScope });
        if (!result.success) errors.set(taskId, result.error || "Move was refused. Check permissions and try again.");
      } catch (error) {
        console.error("Bulk board move failed", taskId, error);
        const reason = isPlanLimitReachedError(error) ? toErrorMessage(error, "Plan limit reached.") : "The move could not finish.";
        errors.set(taskId, `${reason} The family may be partially moved or cleanup may be incomplete. Check both boards before retrying.`);
      }
    }
    const moved = await prisma.task.findMany({
      where: { id: { in: selected.filter((id) => parents.has(id)) }, projectId, project: taskWriteAccessWhere(session.userId, session.agentId, session.teamScope) },
      select: { id: true },
    });
    const movedIds = moved.map((task) => task.id);
    const movedSet = new Set(movedIds);
    const issues = selected.flatMap((id) => {
      if (!parents.has(id)) return [{ id, message: "Ticket is no longer accessible on the source board." }];
      const visited = new Set<number>();
      let ancestor: number | null | undefined = id;
      while (ancestor != null && !visited.has(ancestor)) {
        visited.add(ancestor);
        const message = errors.get(ancestor);
        if (message) return [{ id, message }];
        ancestor = parents.get(ancestor);
      }
      return movedSet.has(id) ? [] : [{ id, message: "Move was not confirmed. Check both boards before retrying." }];
    });
    for (const id of [sourceProjectId, projectId]) void broadcastBoardChange(id, { originUserId: session.userId });
    return NextResponse.json({ movedIds, failedIds: selected.filter((id) => !movedSet.has(id)), issues });
  },
});
