import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { isAgentOnBoard } from "@/utils/controllers/agents/boardMembers";
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
  const sectionId = Number(body?.sectionId);
  const autoAssignUserId =
    body?.autoAssignUserId == null ? null : Number(body.autoAssignUserId);
  const autoAssignAgentId =
    body?.autoAssignAgentId == null ? null : String(body.autoAssignAgentId);

  if (
    !Number.isInteger(sectionId) ||
    sectionId <= 0 ||
    (autoAssignUserId !== null &&
      (!Number.isInteger(autoAssignUserId) || autoAssignUserId <= 0)) ||
    (autoAssignAgentId !== null && autoAssignAgentId.trim().length === 0) ||
    (autoAssignUserId !== null && autoAssignAgentId !== null)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "sectionId and one valid auto-assign member, agent, or clear selection are required",
      },
      { status: 400 }
    );
  }

  const section = await (prisma.section as any).findFirst({
    where: {
      id: sectionId,
      deleted: false,
      project: getProjectWhere(session.userId),
    },
    select: { id: true, projectId: true },
  });

  if (!section) {
    return NextResponse.json(
      { success: false, error: "Column not found or access denied" },
      { status: 404 }
    );
  }

  if (autoAssignUserId !== null) {
    const memberCheck = await validateProjectMemberIds(section.projectId, [
      autoAssignUserId,
    ]);
    if (memberCheck.error) {
      return NextResponse.json(
        { success: false, error: memberCheck.error.message },
        { status: memberCheck.error.status }
      );
    }
    if (memberCheck.invalidIds.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Auto-assign user must be a member of this board",
        },
        { status: 400 }
      );
    }
  }

  if (
    autoAssignAgentId !== null &&
    !(await isAgentOnBoard(section.projectId, autoAssignAgentId))
  ) {
    return NextResponse.json(
      { success: false, error: "Auto-assign agent must be active on this board" },
      { status: 400 },
    );
  }

  await prisma.section.update({
    where: { id: section.id },
    data: { autoAssignUserId, autoAssignAgentId },
  });

  return NextResponse.json({
    success: true,
    sectionId: section.id,
    autoAssignUserId,
    autoAssignAgentId,
  });
}
