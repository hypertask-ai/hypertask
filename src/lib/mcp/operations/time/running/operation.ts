import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import { elapsedSeconds, listRunning } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";

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

  const now = new Date();
  const entries = await listRunning(ctx.user.id);
  const timers = entries.map((entry) => ({
    id: entry.id,
    startedAt: entry.startedAt,
    pausedAt: entry.pausedAt,
    elapsedSeconds: elapsedSeconds(entry.startedAt, null, entry.pausedAt, now),
    task: {
      id: entry.task.id,
      title: entry.task.title,
      ticketId: entry.task.ticketNumber ?? String(entry.task.uniqueIndex),
      uniqueIndex: entry.task.uniqueIndex,
      projectId: entry.task.projectId,
    },
  }));

  return NextResponse.json({ success: true, timers });
}
