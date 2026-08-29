import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import { findTaskByStringIdentifier } from "@/lib/mcp/tasks/resolveTask";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";

/**
 * Rate limit, authenticate, read the JSON body. Entry-scoped routes (update,
 * delete) address a TimeEntry by id rather than a task, so they stop here;
 * resolveMcpTimeTask continues on to resolve the task.
 */
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

/** Reads a positive integer TimeEntry id from the request body. */
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

  const task = await findTaskByStringIdentifier(ctx.user, body.task, ctx.agentId);
  const activeProject = task
    ? await prisma.project.findFirst({
        where: {
          id: task.projectId,
          status: options.allowArchived
            ? { in: ["Normal", "Archive"] }
            : "Normal",
          ...getProjectWhere(ctx.user.id, ctx.agentId),
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
