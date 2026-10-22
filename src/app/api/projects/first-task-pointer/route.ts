import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7549_FIRST_TASK_POINTER_FLAG } from "@/lib/flags/keys";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export async function GET(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session || session.agentId) {
    return NextResponse.json({ eligible: false }, { status: 401 });
  }
  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ eligible: false }, { status: 400 });
  }
  if (!(await isFeatureEnabled(HTPR_7549_FIRST_TASK_POINTER_FLAG, session.userId))) {
    return NextResponse.json({ eligible: false });
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: session.userId, seeded: true, status: "Normal", AND: [projectContentAccessWhere(session.userId, session.agentId)] },
    select: { firstTaskPointerTaskId: true, firstTaskPointerSectionId: true, firstRealTaskCreatedAt: true },
  });
  if (!project) return NextResponse.json({ eligible: false }, { status: 404 });
  const starterTaskId = project.firstTaskPointerTaskId;
  const sectionId = project.firstTaskPointerSectionId;
  if (!starterTaskId || !sectionId || project.firstRealTaskCreatedAt) {
    return NextResponse.json({ eligible: false });
  }
  const [realTaskCount, section] = await Promise.all([
    prisma.task.count({ where: { projectId, id: { not: starterTaskId }, project: projectContentAccessWhere(session.userId, session.agentId) } }),
    prisma.section.findFirst({ where: { id: sectionId, projectId }, select: { id: true } }),
  ]);
  return NextResponse.json({ eligible: !!section && realTaskCount === 0, starterTaskId, sectionId });
}
