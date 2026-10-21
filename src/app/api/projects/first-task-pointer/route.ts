import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7511-signup-straight-to-board";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session || session.agentId) {
    return NextResponse.json({ eligible: false }, { status: 401 });
  }
  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ eligible: false }, { status: 400 });
  }
  if (!(await isFeatureEnabled(HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG, session.userId))) {
    return NextResponse.json({ eligible: false });
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: session.userId, seeded: true, status: "Normal" },
    select: { firstTaskPointerTaskId: true, firstTaskPointerSectionId: true, firstRealTaskCreatedAt: true },
  });
  if (!project) return NextResponse.json({ eligible: false }, { status: 404 });
  const starterTaskId = project.firstTaskPointerTaskId;
  const sectionId = project.firstTaskPointerSectionId;
  if (!starterTaskId || !sectionId || project.firstRealTaskCreatedAt) {
    return NextResponse.json({ eligible: false });
  }
  const [realTaskCount, section] = await Promise.all([
    prisma.task.count({ where: { projectId, id: { not: starterTaskId } } }),
    prisma.section.findFirst({ where: { id: sectionId, projectId }, select: { id: true } }),
  ]);
  return NextResponse.json({ eligible: !!section && realTaskCount === 0, starterTaskId, sectionId });
}
