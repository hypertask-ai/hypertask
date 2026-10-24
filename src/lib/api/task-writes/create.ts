import { isPlanLimitReachedError, planLimitResponse } from "@/lib/planLimits";
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
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7740_CREATE_RESPONSE_FLAG } from "@/lib/flags/keys";

const schema = z.custom<Record<string, any>>(
  (body) => !!((body as any)?.fullScreenTask || ((body as any)?.title && (body as any)?.projectId)),
);

export const POST = taskWriteRoute({
  schema,
  validationMessage: "Missing Required Information",
  prepare: async (session) => ({ user: await loadSessionUserRecord(session.userId), session }),
  operation: async (body, { user: userObj, session }) => {
    try {
      const { title, description, userId, ranking, projectId, index, fullScreenTask, projectIdentifier, agentId: requestedAgentId } = body;
      let { section, sectionId } = body;
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
      const createResponseEnabled = await isFeatureEnabled(HTPR_7740_CREATE_RESPONSE_FLAG, session.userId);
      if (createResponseEnabled) {
        const resolvedSection = await prisma.section.findFirst({
          where: { projectId, deleted: false, ...(sectionId ? { id: sectionId } : { visibility: true }) },
          orderBy: { ranking: "asc" },
        });
        if (!resolvedSection) {
          return NextResponse.json(
            { message: sectionId ? "Section does not belong to this project" : "No active section found" },
            { status: sectionId ? 400 : 404 },
          );
        }
        sectionId = resolvedSection.id;
        section = resolvedSection.section_title;
      }
      if (ranking && section) {
        const response = await create({ title, description: agentId ? await inlineAgentImagesForUser(description ?? "", session.userId, { inlineImages: body.inline_images }) : description, section, userId: createResponseEnabled ? userId ?? userObj.id : userId, ranking, projectId, sectionId, index, currentUser: userObj, agentId });
        if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
        return NextResponse.json(response.json, { status: response.status });
      }
      const task = await prisma.task.findFirst({
        where: { sectionId, ...(createResponseEnabled ? { projectId, status: "Normal" as const } : {}) }, orderBy: { ranking: "desc" },
      });
      if (task) {
        const ranking = generateRank(createResponseEnabled ? task.ranking || undefined : task.ranking, undefined);
        if (ranking) {
          const response = await create({ title, description: "", section: createResponseEnabled ? section : task.section, userId: userObj.id, ranking, projectId, sectionId, currentUser: userObj, agentId });
          if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
          return NextResponse.json(response.json, { status: response.status });
        }
      } else {
        const section = await prisma.section.findFirst({ where: { id: sectionId, deleted: false, ...(createResponseEnabled ? { projectId } : {}) } });
        if (section) {
          const taskRanking = createResponseEnabled ? ranking || generateRank(undefined, undefined) : ranking;
          const response = await create({ title, description: "", section: section.section_title, userId: userObj.id, ranking: taskRanking, projectId, sectionId, currentUser: userObj, agentId });
          if (response.status === 200) void broadcastBoardChange(projectId, { originUserId: userObj?.id });
          return NextResponse.json(response.json, { status: response.status });
        }
      }
      if (createResponseEnabled) {
        return NextResponse.json({ message: "Could not resolve task position" }, { status: 500 });
      }
    } catch (error) {
      if (isPlanLimitReachedError(error)) {
        const refusal = planLimitResponse(error);
        return NextResponse.json(refusal.body, { status: refusal.status });
      }
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
