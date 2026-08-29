import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  findTaskTemplateTargetSection,
  taskTemplateSectionWhere,
} from "@/lib/taskTemplatePrefill";
import { NextRequest, NextResponse } from "next/server";

// HTPR-4886: task templates. GET lists a board's templates; POST saves an
// existing task as a template (name defaults to the task title); DELETE
// removes one. Instantiation lives in ./apply/route.ts.

const TEMPLATE_NAME_MAX = 200;

async function accessibleProject(userId: number, projectId: number) {
  return prisma.project.findFirst({
    where: { id: projectId, ...getProjectWhere(userId) },
    select: { id: true, uniqueIdentifier: true },
  });
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ success: false, error: "projectId is required" }, { status: 400 });
  }
  if (!(await accessibleProject(session.userId, projectId))) {
    return NextResponse.json({ success: false, error: "Board not found or access denied" }, { status: 404 });
  }
  const [templates, sections] = await Promise.all([
    prisma.taskTemplate.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        title: true,
        descriptionHtml: true,
        priorityIndex: true,
        estimateIndex: true,
        labelIds: true,
        updatedAt: true,
      },
    }),
    prisma.section.findMany({
      where: taskTemplateSectionWhere(projectId),
      orderBy: { ranking: "asc" },
      select: { id: true, section_title: true, isDone: true },
    }),
  ]);
  const labelIds = [...new Set(templates.flatMap((template) => template.labelIds))];
  const labels = labelIds.length
    ? await prisma.label.findMany({
        where: { id: { in: labelIds }, projectId },
        select: { id: true, value: true, projectId: true },
      })
    : [];
  const targetSection = findTaskTemplateTargetSection(sections);

  return NextResponse.json({
    success: true,
    templates,
    labels,
    targetSection: targetSection
      ? { id: targetSection.id, section_title: targetSection.section_title }
      : null,
  });
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const taskId = Number(body?.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ success: false, error: "taskId is required" }, { status: 400 });
  }
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, TEMPLATE_NAME_MAX) : "";

  const task = await prisma.task.findFirst({
    where: { id: taskId, project: { ...getProjectWhere(session.userId) } },
    include: {
      description_: { select: { content: true } },
      priority: { select: { priority_index: true } },
      estimate: { select: { estimate_index: true } },
      taskLabels: { select: { labelId: true } },
    },
  });
  if (!task) {
    return NextResponse.json({ success: false, error: "Task not found or access denied" }, { status: 404 });
  }

  const template = await prisma.taskTemplate.create({
    data: {
      projectId: task.projectId,
      createdById: session.userId,
      name: name || task.title,
      title: task.title,
      descriptionHtml: task.description_?.content ?? "",
      priorityIndex: task.priority?.priority_index ?? null,
      estimateIndex: task.estimate?.estimate_index ?? null,
      labelIds: task.taskLabels.map((tl) => tl.labelId),
    },
  });
  return NextResponse.json({ success: true, template: { id: template.id, name: template.name } });
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const templateId = Number(body?.templateId);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return NextResponse.json({ success: false, error: "templateId is required" }, { status: 400 });
  }
  const deleted = await prisma.taskTemplate.deleteMany({
    where: { id: templateId, project: { ...getProjectWhere(session.userId) } },
  });
  if (deleted.count === 0) {
    return NextResponse.json({ success: false, error: "Template not found or access denied" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
