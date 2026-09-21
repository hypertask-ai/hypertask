import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { createTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { NextRequest, NextResponse } from "next/server";

// HTPR-4886: instantiate a template as a fresh task in the board's first
// non-done column. Returns the new task's location so the client can open it.
export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const templateId = Number(body?.templateId);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return NextResponse.json({ success: false, error: "templateId is required" }, { status: 400 });
  }

  const template = await prisma.taskTemplate.findFirst({
    where: { id: templateId, project: { ...getProjectWhere(session.userId) } },
    include: { project: { select: { id: true, uniqueIdentifier: true } } },
  });
  if (!template) {
    return NextResponse.json({ success: false, error: "Template not found or access denied" }, { status: 404 });
  }

  const sections = await prisma.section.findMany({
    where: { projectId: template.projectId, deleted: false, visibility: true },
    orderBy: { ranking: "asc" },
    select: { id: true, section_title: true, isDone: true },
  });
  const target = sections.find((s) => columnRoleFor(s) !== "done") ?? sections[0];
  if (!target) {
    return NextResponse.json({ success: false, error: "Board has no columns" }, { status: 400 });
  }

  // Labels can be deleted after a template is saved; keep only live ones.
  const liveLabels =
    template.labelIds.length > 0
      ? await prisma.label.findMany({
          where: { id: { in: template.labelIds }, projectId: template.projectId },
          select: { id: true },
        })
      : [];

  const { task } = await createTaskCore({
    title: template.title,
    description: template.descriptionHtml,
    userId: session.userId,
    projectId: template.projectId,
    sectionId: target.id,
    sectionTitle: target.section_title,
    projectIdentifier: template.project?.uniqueIdentifier ?? "TASK",
    priorityIndex: template.priorityIndex ?? 0,
    estimateIndex: template.estimateIndex ?? 0,
    labelIds: liveLabels.map((l) => l.id),
    createDrafts: false,
    updateTeamActivity: true,
  });

  void broadcastBoardChange(template.projectId, { originUserId: session.userId });
  return NextResponse.json({
    success: true,
    task: {
      id: task.id,
      projectId: task.projectId,
      uniqueIndex: task.uniqueIndex,
      ticketNumber: task.ticketNumber,
    },
  });
}
