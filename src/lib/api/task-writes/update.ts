import { isPlanLimitReachedError, planLimitResponse } from "@/lib/planLimits";
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { inlineAgentImagesForUser } from "@/lib/media/inlineAgentImages.server";
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import type { IUser } from "@/models/model";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { extractTaskReferencesFromCommentText } from "@/utils/controllers/comments/extractTaskReferences";
import { addRelatedTasks } from "@/utils/controllers/tasks/addRelatedTasks";
import { taskWriteRoute } from "./route";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";

const schema = z.custom<{ newTask: Record<string, any>; agentId?: unknown }>(
  (body) => !!(body as { newTask?: { id?: unknown } } | null)?.newTask?.id,
);

async function userCanAccessProject(userId: number, projectId: number, agentId: string | null, teamScope?: AgentTokenTeamScope | null) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...taskWriteAccessWhere(userId, agentId, teamScope) },
    select: { id: true },
  });
  if (project) recordAgentBoardScopeMiss(project.id, "write");
  return !!project;
}

export const PUT = taskWriteRoute({
  schema,
  validationMessage: "Task id is required",
  validateBeforeAuth: true,
  operation: async ({ newTask, agentId }, session) => {
    try {
      const actingAgent = resolveActingAgent({ sessionAgentId: session.agentId, bodyAgentId: agentId });
      if (!actingAgent.ok) {
        return NextResponse.json({ message: actingAgent.message }, { status: actingAgent.status });
      }
      const actingAgentId = actingAgent.agentId;
      const [taskToUpdate, sessionUser, ownedAgent] = await Promise.all([
        prisma.task.findUnique({ where: { id: newTask.id }, select: { projectId: true } }),
        prisma.user.findUnique({
          where: { id: session.userId },
          select: { displayName: true, photoURL: true, email: true },
        }),
        actingAgentId ? prisma.agent.findFirst({
          where: { id: actingAgentId, userId: session.userId, revokedAt: null },
          select: { id: true },
        }) : Promise.resolve(null),
      ]);
      if (actingAgentId && !ownedAgent) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      }
      if (taskToUpdate && !(await userCanAccessProject(session.userId, taskToUpdate.projectId, actingAgentId, session.teamScope))) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      }
      if (taskToUpdate && newTask.projectId != null && newTask.projectId !== taskToUpdate.projectId &&
          !(await userCanAccessProject(session.userId, newTask.projectId, actingAgentId, session.teamScope))) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      }
      const currentUser = {
        id: session.userId,
        displayName: sessionUser?.displayName ?? "",
        photoURL: sessionUser?.photoURL ?? undefined,
        email: sessionUser?.email ?? undefined,
      } as IUser;
      if (actingAgentId && typeof newTask.description === "string") {
        newTask.description = await inlineAgentImagesForUser(newTask.description, session.userId, { inlineImages: newTask.inline_images });
      }
      delete newTask.inline_images;
      const response = await updateTaskSingle(newTask, currentUser, actingAgentId, { teamScope: session.teamScope });
      if (response.status === 200) {
        void broadcastBoardChange((response.json as any)?.projectId ?? newTask?.projectId, {
          originUserId: currentUser?.id,
        });
        if (newTask?.description !== undefined || newTask?.title !== undefined || newTask?.status !== undefined) {
          try {
            await broadcastTaskChange((response.json as any)?.id ?? newTask?.id, {
              originUserId: currentUser?.id,
            });
          } catch (error) {
            console.warn("[tasks/single] task realtime broadcast failed", error);
          }
        }
        if (typeof newTask?.description === "string") {
          const relatedTaskId = (response.json as any)?.id ?? newTask.id;
          void (async () => {
            try {
              const refs = extractTaskReferencesFromCommentText(newTask.description);
              if (refs.length === 0) return;
              await addRelatedTasks({ relatedTasks: refs, currentTaskId: relatedTaskId }, currentUser.id, actingAgentId, session.teamScope);
            } catch (error) {
              console.warn("[tasks/single] description relations failed:", error);
            }
          })();
        }
      }
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      if (isPlanLimitReachedError(error)) {
        const refusal = planLimitResponse(error);
        return NextResponse.json(refusal.body, { status: refusal.status });
      }
      console.log(error);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
