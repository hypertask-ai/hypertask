import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import { findTaskByStringIdentifier } from "@/lib/mcp/tasks/resolveTask";
import { listReport } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";

function parsePositiveInteger(value: string | null) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseDate(value: string | null) {
  if (!value?.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function GET(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) {
    return NextResponse.json(
      { success: false, error: "Unauthorized. Invalid or missing authentication token." },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const userParam = params.get("user")?.trim();
  const filterUserId =
    userParam === "me" ? ctx.user.id : parsePositiveInteger(userParam ?? null);
  const runningParam = params.get("running")?.trim().toLowerCase();

  // Resolve the task filter the same way the other time endpoints do, so
  // callers can pass a ticket ID, unique index, or task ID (not just the raw
  // internal DB id).
  const taskParam = params.get("task")?.trim();
  let taskId: number | undefined;
  if (taskParam) {
    const task = await findTaskByStringIdentifier(ctx.user, taskParam, ctx.agentId);
    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found or access denied" },
        { status: 404 }
      );
    }
    taskId = task.id;
  }

  const entries = await listReport(ctx.user.id, {
    teamId: params.get("team")?.trim() || undefined,
    boardId: parsePositiveInteger(params.get("board")),
    taskId,
    filterUserId,
    from: parseDate(params.get("from")),
    to: parseDate(params.get("to")),
    runningOnly: runningParam === "1" || runningParam === "true",
  });

  return NextResponse.json({
    success: true,
    entries: entries.map((entry) => ({
      ...entry,
      startedAt: entry.startedAt.toISOString(),
      endedAt: entry.endedAt?.toISOString() ?? null,
      pausedAt: entry.pausedAt?.toISOString() ?? null,
    })),
  });
}
