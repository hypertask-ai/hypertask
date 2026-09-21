import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const projectId = Number(body?.projectId);
  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    typeof body?.enabled !== "boolean"
  ) {
    return NextResponse.json(
      { success: false, error: "projectId and enabled are required" },
      { status: 400 }
    );
  }
  const warnDays = body.warnDays;
  const hotDays = body.hotDays;
  const nudgeEnabled = body.nudgeEnabled;
  if (
    (warnDays !== undefined &&
      (!Number.isInteger(warnDays) || warnDays <= 0 || warnDays > 36500)) ||
    (hotDays !== undefined &&
      (!Number.isInteger(hotDays) || hotDays <= 0 || hotDays > 36500)) ||
    (nudgeEnabled !== undefined && typeof nudgeEnabled !== "boolean")
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "warnDays and hotDays must be positive whole numbers",
      },
      { status: 400 }
    );
  }

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: {
        id: projectId,
        ...getProjectWhere(session.userId),
      },
      select: {
        staleWarnDays: true,
        staleHotDays: true,
        staleNudgeEnabled: true,
      },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Board not found or access denied" },
        { status: 404 }
      );
    }

    const effectiveWarnDays = warnDays ?? project.staleWarnDays ?? 7;
    const effectiveHotDays = hotDays ?? project.staleHotDays ?? 20;
    if (effectiveWarnDays >= effectiveHotDays) {
      return NextResponse.json(
        { success: false, error: "warnDays must be less than hotDays" },
        { status: 400 }
      );
    }

    const result = await tx.project.updateMany({
      where: {
        id: projectId,
        ...getProjectWhere(session.userId),
      },
      data: {
        stalenessEnabled: body.enabled,
        ...(warnDays === undefined ? {} : { staleWarnDays: warnDays }),
        ...(hotDays === undefined ? {} : { staleHotDays: hotDays }),
        ...(nudgeEnabled === undefined ? {} : { staleNudgeEnabled: nudgeEnabled }),
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { success: false, error: "Board not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      enabled: body.enabled,
      warnDays: warnDays ?? project.staleWarnDays,
      hotDays: hotDays ?? project.staleHotDays,
      nudgeEnabled: nudgeEnabled ?? project.staleNudgeEnabled,
    });
  });
}
