import { inlineAgentImagesForUser } from "@/lib/media/inlineAgentImages.server";
import { NextResponse } from "next/server";
import { z } from "zod";
import create from "@/utils/controllers/tasks/create";
import generateRank from "@/utils/generateRank";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import { createFullScreenTaskAndReturn } from "./create-fullscreen";
import { taskWriteRoute } from "./route";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";

const schema = z.custom<Record<string, any>>(
  (body) => !!((body as any)?.fullScreenTask || ((body as any)?.title && (body as any)?.projectId)),
);

export const POST = taskWriteRoute({
  schema,
  validationMessage: "Missing Required Information",
  prepare: async (session) => ({ user: await loadSessionUserRecord(session.userId), session }),
  operation: async (body, { user: userObj, session }) => {
    try {
      const { title, description, section, userId, ranking, projectId, sectionId, index, fullScreenTask, projectIdentifier, agentId: requestedAgentId } = body;
      const actingAgent = resolveActingAgent({ sessionAgentId: session.agentId, bodyAgentId: requestedAgentId });
      if (!actingAgent.ok) {
        return NextResponse.json({ message: actingAgent.message }, { status: actingAgent.status });
      }
      const agentId = actingAgent.agentId ?? undefined;

      if (fullScreenTask) {
        const newTask = await createFullScreenTaskAndReturn(projectId, userId, projectIdentifier, title, userObj, agentId);
        if (newTask.error && newTask.status) return NextResponse.json({ message: newTask.message }, { status: newTask.status });
        if (newTask.error) return NextResponse.json({ newTask }, { status: 406 });
        void broadcastBoardChange(projectId, { originUserId: userObj?.id });
        return NextResponse.json({ newTask }, { status: 200 });
      }
      if (ranking && section) {
        const response = await create({ title, description: agentId ? await inlineAgentImagesForUser(description ?? "", session.userId, { inlineImages: body.inline_images }) : description, section, userId, ranking, projectId, sectionId, index, currentUser: userObj, agentId });
        if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
        return NextResponse.json(response.json, { status: response.status });
      }
      const task = await prisma.task.findFirst({
        where: { sectionId }, orderBy: { ranking: "desc" },
      });
      if (task) {
        const ranking = generateRank(task.ranking, undefined);
        if (ranking) {
          const response = await create({ title, description: "", section: task.section, userId: userObj.id, ranking, projectId, sectionId, currentUser: userObj, agentId });
          if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
          return NextResponse.json(response.json, { status: response.status });
        }
      } else {
        const section = await prisma.section.findFirst({ where: { id: sectionId, deleted: false } });
        if (section) {
          const response = await create({ title, description: "", section: section.section_title, userId: userObj.id, ranking, projectId, sectionId, currentUser: userObj, agentId });
          if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
          return NextResponse.json(response.json, { status: response.status });
        }
      }
    } catch {
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
