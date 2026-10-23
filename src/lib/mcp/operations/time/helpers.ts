import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import { findTaskByStringIdentifier, taskIdentifierErrorResponse } from "@/lib/mcp/tasks/resolveTask";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";

export async function authenticateMcpTime(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) {
    return { ctx: null, body: null, response: rateLimited };
  }
  const ctx = await validateMcpAuth(request);
  if (!ctx) {
    return {
      ctx: null,
      body: null,
      response: NextResponse.json(
        { success: false, error: "Unauthorized. Invalid or missing authentication token." },
        { status: 401 }
      ),
    };
  }

  const body = await request.json().catch(() => null);
  return { ctx, body, response: null };
}

export function readEntryId(body: any) {
  const raw = body?.entry_id;
  const entryId = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return {
      entryId: null,
      response: NextResponse.json(
        { success: false, error: "entry_id must be a positive integer" },
        { status: 400 }
      ),
    };
  }
  return { entryId: entryId as number, response: null };
}

export async function resolveMcpTimeTask(
  request: NextRequest,
  options: { allowArchived?: boolean } = {}
) {
  const { ctx, body, response } = await authenticateMcpTime(request);
  if (response) {
    return { ctx, task: null, body, response };
  }

  if (!body || typeof body.task !== "string" || !body.task.trim()) {
    return {
      ctx,
      task: null,
      body,
      response: NextResponse.json(
        { success: false, error: "task must be a task ID, unique index, or ticket ID" },
        { status: 400 }
      ),
    };
  }

  let task;
  try {
    task = await findTaskByStringIdentifier(ctx.user, body.task, ctx.agentId, ctx.teamScope);
  } catch (error) {
    const response = taskIdentifierErrorResponse(error);
    if (response) return { ctx, task: null, body, response };
    throw error;
  }
  const activeProject = task
    ? await prisma.project.findFirst({
        where: {
          id: task.projectId,
          status: options.allowArchived
            ? { in: ["Normal", "Archive"] }
            : "Normal",
          ...getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope),
        },
        select: { id: true },
      })
    : null;
  if (!task || !activeProject) {
    return {
      ctx,
      task: null,
      body,
      response: NextResponse.json(
        { success: false, error: "Task not found or access denied" },
        { status: 404 }
      ),
    };
  }

  return { ctx, task, body, response: null };
}
