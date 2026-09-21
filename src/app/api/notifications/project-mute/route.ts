import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";

const parseProjectId = (value: unknown): number | null => {
  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
};

async function accessibleProject(userId: number, projectId: number) {
  return prisma.project.findFirst({
    where: { id: projectId, ...projectContentAccessWhere(userId) },
    select: { id: true },
  });
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = parseProjectId(
    request.nextUrl.searchParams.get("projectId"),
  );
  if (!projectId) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  if (!(await accessibleProject(session.userId, projectId))) {
    return NextResponse.json(
      { error: "Board not found or access denied" },
      { status: 404 },
    );
  }

  const mute = await prisma.projectMute.findUnique({
    where: { projectId_userId: { projectId, userId: session.userId } },
    select: { id: true },
  });

  return NextResponse.json({ muted: Boolean(mute) });
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const projectId = parseProjectId(body?.projectId);
  const muted = body?.muted;
  if (!projectId || typeof muted !== "boolean") {
    return NextResponse.json(
      { error: "Invalid board mute preference" },
      { status: 400 },
    );
  }

  if (!(await accessibleProject(session.userId, projectId))) {
    return NextResponse.json(
      { error: "Board not found or access denied" },
      { status: 404 },
    );
  }

  if (muted) {
    await prisma.projectMute.upsert({
      where: { projectId_userId: { projectId, userId: session.userId } },
      update: {},
      create: { projectId, userId: session.userId },
    });
  } else {
    await prisma.projectMute.deleteMany({
      where: { projectId, userId: session.userId },
    });
  }

  return NextResponse.json({ muted });
}
