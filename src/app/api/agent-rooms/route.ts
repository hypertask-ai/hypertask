import { getAuthSession, withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HTPR_6557_AGENT_ROOMS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { AGENT_ROOM_DAILY_TURN_BUDGET } from "@/lib/agents/roomPolicy";

export const runtime = "nodejs";

async function roomUser(request: NextRequest) {
  const userId = (await getAuthSession(request.headers))?.userId;
  if (
    !userId ||
    !(await isFeatureEnabled(HTPR_6557_AGENT_ROOMS_FLAG, userId))
  ) {
    return null;
  }
  return userId;
}

async function GETHandler(request: NextRequest) {
  const userId = await roomUser(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  const projects = await prisma.project.findMany({
    where: { status: "Normal", ...getProjectWhere(userId) },
    orderBy: [{ title: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      title: true,
      agentRoom: { select: { id: true } },
      members: {
        where: {
          status: "Accepted",
          agentId: { not: null },
          agent: { revokedAt: null, archivedAt: null },
        },
        orderBy: { agent: { displayName: "asc" } },
        select: {
          agent: {
            select: { id: true, displayName: true, photoURL: true },
          },
        },
      },
    },
  });
  return NextResponse.json({
    success: true,
    rooms: projects.map((project) => ({
      id: project.agentRoom?.id ?? null,
      projectId: project.id,
      name: project.title ?? project.name,
      agents: project.members.flatMap(({ agent }) => (agent ? [agent] : [])),
    })),
  });
}

async function POSTHandler(request: NextRequest) {
  const userId = await roomUser(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const projectId = Number(body?.projectId);
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    return NextResponse.json(
      { success: false, error: "projectId must be a positive integer" },
      { status: 400 },
    );
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, status: "Normal", ...getProjectWhere(userId) },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json(
      { success: false, error: "Board not found" },
      { status: 404 },
    );
  }
  const room = await prisma.agentRoom.upsert({
    where: { projectId },
    update: {},
    create: { projectId, dailyTurnBudget: AGENT_ROOM_DAILY_TURN_BUDGET },
    select: { id: true, projectId: true },
  });
  return NextResponse.json({ success: true, room });
}

export const GET = withAuth(GETHandler, { authenticateInHandler: true });
export const POST = withAuth(POSTHandler, { authenticateInHandler: true });
