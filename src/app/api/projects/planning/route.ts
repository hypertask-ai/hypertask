import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import {
  cleanPlanningText,
  parseDateOnly,
  parseProjectHealth,
  toDateOnly,
} from "@/lib/projectPlanning";
import { broadcastBoardChange } from "@/lib/realtime/server";
import {
  getProjectCycleOverview,
  setProjectCyclesEnabled,
} from "@/lib/cycleService";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import isProjectAdmin from "@/utils/controllers/projects/isProjectAdmin";
import { NextRequest, NextResponse } from "next/server";

const planningSelect = {
  id: true,
  targetDate: true,
  milestones: {
    orderBy: { targetDate: "asc" as const },
    select: {
      id: true,
      title: true,
      targetDate: true,
      completedAt: true,
      createdAt: true,
    },
  },
  statusUpdates: {
    orderBy: { createdAt: "desc" as const },
    take: 20,
    select: {
      id: true,
      health: true,
      message: true,
      createdAt: true,
      author: {
        select: { id: true, displayName: true, photoURL: true },
      },
    },
  },
};

const projectIdFrom = (value: unknown) => {
  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
};

const planningResponse = async (projectId: number, userId: number) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...getProjectWhere(userId) },
    select: planningSelect,
  });
  if (!project) return null;

  const [canManage, cycles] = await Promise.all([
    isProjectAdmin(userId, projectId),
    getProjectCycleOverview(projectId),
  ]);

  return {
    ...project,
    targetDate: toDateOnly(project.targetDate),
    milestones: project.milestones
      .toSorted(
        (left, right) =>
          Number(Boolean(left.completedAt)) - Number(Boolean(right.completedAt)),
      )
      .map((milestone) => ({
        ...milestone,
        targetDate: toDateOnly(milestone.targetDate),
      })),
    canManage,
    cycles,
  };
};

const unauthorized = () =>
  NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

const invalid = (error: string) =>
  NextResponse.json({ success: false, error }, { status: 400 });

export async function GET(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) return unauthorized();

  const projectId = projectIdFrom(request.nextUrl.searchParams.get("projectId"));
  if (!projectId) return invalid("A valid projectId is required");

  const planning = await planningResponse(projectId, session.userId);
  if (!planning) {
    return NextResponse.json(
      { success: false, error: "Board not found or access denied" },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, planning });
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  const projectId = projectIdFrom(body?.projectId);
  if (!projectId || typeof body?.action !== "string") {
    return invalid("projectId and action are required");
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, ...getProjectWhere(session.userId) },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json(
      { success: false, error: "Board not found or access denied" },
      { status: 404 },
    );
  }

  const canManage = await isProjectAdmin(session.userId, projectId);
  if (body.action !== "post_status" && !canManage) {
    return NextResponse.json(
      { success: false, error: "Board admin access is required" },
      { status: 403 },
    );
  }

  if (body.action === "set_cycles") {
    if (typeof body.enabled !== "boolean") {
      return invalid("enabled must be a boolean");
    }
    await setProjectCyclesEnabled(projectId, body.enabled);
  } else if (body.action === "set_target_date") {
    const targetDate = body.targetDate === null ? null : parseDateOnly(body.targetDate);
    if (body.targetDate !== null && !targetDate) {
      return invalid("targetDate must be a valid YYYY-MM-DD date or null");
    }
    await prisma.project.update({ where: { id: projectId }, data: { targetDate } });
  } else if (body.action === "create_milestone") {
    const title = cleanPlanningText(body.title, 120);
    const targetDate = parseDateOnly(body.targetDate);
    if (!title || !targetDate) {
      return invalid("A milestone title and valid target date are required");
    }
    await prisma.projectMilestone.create({
      data: { projectId, title, targetDate, createdById: session.userId },
    });
  } else if (body.action === "toggle_milestone") {
    if (typeof body.milestoneId !== "string" || typeof body.completed !== "boolean") {
      return invalid("milestoneId and completed are required");
    }
    const result = await prisma.projectMilestone.updateMany({
      where: { id: body.milestoneId, projectId },
      data: { completedAt: body.completed ? new Date() : null },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { success: false, error: "Milestone not found" },
        { status: 404 },
      );
    }
  } else if (body.action === "delete_milestone") {
    if (typeof body.milestoneId !== "string") {
      return invalid("milestoneId is required");
    }
    const result = await prisma.projectMilestone.deleteMany({
      where: { id: body.milestoneId, projectId },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { success: false, error: "Milestone not found" },
        { status: 404 },
      );
    }
  } else if (body.action === "post_status") {
    const health = parseProjectHealth(body.health);
    const message = cleanPlanningText(body.message, 2000);
    if (!health || !message) {
      return invalid("A valid health and update message are required");
    }
    await prisma.projectStatusUpdate.create({
      data: { projectId, health, message, authorId: session.userId },
    });
  } else {
    return invalid("Unknown planning action");
  }

  broadcastBoardChange(projectId, { originUserId: session.userId });
  const planning = await planningResponse(projectId, session.userId);
  return NextResponse.json({ success: true, planning });
}
