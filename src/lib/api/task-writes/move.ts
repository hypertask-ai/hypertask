import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import generateRank from "@/utils/generateRank";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { toErrorMessage } from "@/lib/api/errorMessage";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import { taskWriteRoute } from "./route";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";

type MoveTaskBody = {
  taskId: number;
  section_title: string;
  sectionId: number;
  ranking?: string;
  projectId: number;
  agentId?: string | null;
  expectedSectionId?: number;
  expectedUpdatedAt?: string;
};

const schema = z.custom<MoveTaskBody>((body) => {
  const value = body as Partial<MoveTaskBody> | null;
  if (value?.expectedSectionId !== undefined || value?.expectedUpdatedAt !== undefined) {
    if (typeof value.expectedSectionId !== 'number' || !Number.isSafeInteger(value.expectedSectionId) || value.expectedSectionId <= 0 || value.expectedSectionId > 2147483647 ||
      typeof value.expectedUpdatedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expectedUpdatedAt) ||
      !Number.isFinite(Date.parse(value.expectedUpdatedAt))) return false;
  }
  return !!(value?.taskId && value?.section_title && value?.sectionId && value?.projectId);
});

export const PUT = taskWriteRoute({
  schema,
  validationMessage: "Missing Required Information",
  prepare: async (session) => ({ user: await loadSessionUserRecord(session.userId), session }),
  operation: async ({ taskId, section_title, sectionId, ranking, projectId, agentId: requestedAgentId, expectedSectionId, expectedUpdatedAt }, { user: userObj, session }) => {
    try {
      const actingAgent = resolveActingAgent({ sessionAgentId: session.agentId, bodyAgentId: requestedAgentId });
      if (!actingAgent.ok) {
        return NextResponse.json({ message: actingAgent.message }, { status: actingAgent.status });
      }
      const agentId = actingAgent.agentId;
      const [taskToMove, targetSection] = await Promise.all([
        prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } }),
        prisma.section.findFirst({ where: { id: sectionId, projectId }, select: { id: true } }),
      ]);
      if (!taskToMove || taskToMove.projectId !== projectId || !targetSection) {
        return NextResponse.json({ message: "Invalid task or section" }, { status: 400 });
      }
      const agent = agentId ? await prisma.agent.findUnique({
        where: { id: agentId, revokedAt: null },
        select: { id: true, userId: true, displayName: true, photoURL: true },
      }) : null;
      let ranking_ = ranking;
      if (!ranking_) {
        const task = await prisma.task.findFirst({
          where: { sectionId, status: "Normal" },
          orderBy: { ranking: "desc" },
        });
        ranking_ = generateRank(task?.ranking, undefined);
      }
      const response: any = await updateTaskSingle({
        id: taskId,
        sectionId,
        section: section_title,
        ranking: ranking_,
        updatedAt: new Date(),
      }, userObj, agentId ?? null, { teamScope: session.teamScope,
        expectedProjectId: expectedSectionId === undefined ? undefined : projectId,
        expectedSectionId,
        expectedAssigneeAgentId: expectedSectionId === undefined ? undefined : agentId ?? undefined,
        expectedStatus: expectedSectionId === undefined ? undefined : "Normal",
        expectedUpdatedAt: expectedUpdatedAt === undefined ? undefined : new Date(expectedUpdatedAt),
        taskMovedActivity: {
          fromAgent: agent,
          sendNotification: () => sendNotificationForTask(
            userObj.id, "TaskMoved", taskId, projectId, agentId ?? null,
          ),
        },
      });
      if (response.status !== 200) {
        return NextResponse.json({ message: toErrorMessage(response.json, "Failed to move task") }, {
          status: response.status,
        });
      }
      void broadcastBoardChange(projectId, { originUserId: userObj.id });
      void broadcastTaskChange(taskId, { originUserId: userObj.id });
      return NextResponse.json({
        ...response.json,
        ...(response.moveActivity?.newComment && { newComment: response.moveActivity.newComment }),
      }, { status: response.status });
    } catch (error) {
      console.error(error);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
