import { NextRequest, NextResponse } from "next/server";
import { validateMcpAuth, checkMcpRateLimit, mcpUnauthorizedResponse } from "@/lib/mcp/auth";
import { getMcpSessionAgentSummary } from "@/lib/mcp/agents";
import prisma from "@/lib/prisma";
import { mapTaskToDetail, taskDetailInclude } from "@/lib/mcp/tasks/mappers";
import { moveTaskToDifferentBoard } from "@/utils/controllers/tasks/moveToDifferentBoard";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  validateProjectAccess,
  getSectionForTask,
} from "@/lib/mcp/tasks/services";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { withAgentMutationLeaseAdoption } from "@/lib/mcp/tasks/agentMutationLeaseAdoption";

interface MoveTaskBody {
  task_id?: number;
  ticket_number?: string;
  project_id?: number;
  unique_index?: number;
  target_project_id: number;
  target_section_id?: number;
}

async function findTaskByIdentifier(
  user: { id: number },
  agentId: string | null | undefined,
  options: {
    task_id?: number | null;
    ticket_number?: string | null;
    unique_index?: number | null;
    project_id?: number | null;
  }
) {
  const { task_id, ticket_number, unique_index, project_id } = options;

  if (task_id) {
    const task = await prisma.task.findFirst({
      where: {
        id: task_id,
        status: { not: "Deleted" },
        project: getProjectWhere(user.id, agentId),
      },
      select: { id: true, projectId: true },
    });
    return task;
  }

  if (ticket_number) {
    // Callers pass this as a string ("HTPR-4578") but also, often, as the bare
    // number. Handing a number straight to a String column threw a Prisma
    // validation error and surfaced as a 500 (HTPR-4580). Normalise, then fall
    // back to matching the digits as a unique index within the board.
    const reference = String(ticket_number).trim();
    const task = await prisma.task.findFirst({
      where: {
        ticketNumber: reference,
        status: { not: "Deleted" },
        project: getProjectWhere(user.id, agentId),
      },
      select: { id: true, projectId: true },
    });
    if (task) return task;

    if (/^\d+$/.test(reference)) {
      return prisma.task.findFirst({
        where: {
          uniqueIndex: Number(reference),
          status: { not: "Deleted" },
          ...(project_id ? { projectId: project_id } : {}),
          project: getProjectWhere(user.id, agentId),
        },
        select: { id: true, projectId: true },
      });
    }

    return null;
  }

  if (
    unique_index != null &&
    project_id != null
  ) {
    const task = await prisma.task.findFirst({
      where: {
        projectId: project_id,
        uniqueIndex: unique_index,
        status: { not: "Deleted" },
        project: getProjectWhere(user.id, agentId),
      },
      select: { id: true, projectId: true },
    });
    return task;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return await mcpUnauthorizedResponse(request);
    }
    const user = ctx.user;
    let body: MoveTaskBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          message: "Request body must be valid JSON",
        },
        { status: 400 }
      );
    }

    const {
      task_id,
      ticket_number,
      project_id,
      unique_index,
      target_project_id,
      target_section_id,
    } = body;

    if (!target_project_id || typeof target_project_id !== "number") {
      return NextResponse.json(
        {
          success: false,
          error: "target_project_id is required and must be a number",
        },
        { status: 400 }
      );
    }

    const methodCount = [
      !!task_id,
      !!ticket_number,
      !!project_id && unique_index != null,
    ].filter(Boolean).length;

    if (methodCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Exactly one of task_id, ticket_number, or (project_id + unique_index) is required",
        },
        { status: 400 }
      );
    }

    if (methodCount > 1) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cannot provide multiple identification methods. Use exactly one: task_id, ticket_number, or (project_id + unique_index)",
        },
        { status: 400 }
      );
    }

    if (unique_index != null && !project_id) {
      return NextResponse.json(
        {
          success: false,
          error: "project_id is required when using unique_index",
        },
        { status: 400 }
      );
    }

    const taskRef = await findTaskByIdentifier(user, ctx.agentId, {
      task_id: task_id ?? null,
      ticket_number: ticket_number ?? null,
      unique_index: unique_index ?? null,
      project_id: project_id ?? null,
    });

    if (!taskRef) {
      return NextResponse.json(
        {
          success: false,
          error: "Task not found or access denied",
        },
        { status: 404 }
      );
    }

    const targetAccess = await validateProjectAccess(target_project_id, user.id, ctx.agentId);
    if (targetAccess.error) {
      return NextResponse.json(
        {
          success: false,
          error: targetAccess.error.message,
        },
        { status: targetAccess.error.status }
      );
    }

    const sectionResult = await getSectionForTask(
      target_project_id,
      target_section_id
    );
    if (sectionResult.error) {
      return NextResponse.json(
        {
          success: false,
          error: sectionResult.error.message,
        },
        { status: sectionResult.error.status }
      );
    }

    const targetSectionId = sectionResult.section!.id;

    const userObj = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        photoURL: true,
      },
    });

    if (!userObj) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const currentUser = {
      id: userObj.id,
      email: userObj.email ?? "",
      displayName: userObj.displayName ?? undefined,
      photoURL: userObj.photoURL ?? undefined,
      uid: "",
      stripe_customer_id: "",
      joinedAt: new Date(),
      UserSettingId: "",
      UserSetting: {} as any,
    };

    // Same request-boundary adoption as the update route: the first fenced
    // transaction may take the lease, later ones stay strict.
    const result = await withAgentMutationLeaseAdoption(
      { agentId: ctx.agentId, userId: currentUser.id },
      () =>
        moveTaskToDifferentBoard({
          taskId: taskRef.id,
          targetProjectId: target_project_id,
          targetSectionId,
          currentProjectId: taskRef.projectId,
          currentUser,
          agentId: ctx.agentId,
        })
    );

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: result.statusCode ?? 500 }
      );
    }

    // Real-time: refresh both the source and target boards for everyone watching.
    void broadcastBoardChange(taskRef.projectId, { originUserId: user.id });
    void broadcastBoardChange(target_project_id, { originUserId: user.id });

    const fullTask = await prisma.task.findUnique({
      where: { id: taskRef.id },
      include: taskDetailInclude(user.id),
    });

    const sessionAgent = await getMcpSessionAgentSummary(ctx.agentId, user.id);
    const agentField = sessionAgent ? { agent: sessionAgent } : {};

    if (!fullTask) {
      return NextResponse.json(
        {
          success: true,
          task: mapTaskToDetail(result.task!, user.id),
          message: "Task moved successfully",
          ...agentField,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        task: mapTaskToDetail(fullTask, user.id),
        message: "Task moved successfully",
        ...agentField,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[MCP Move Task] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
