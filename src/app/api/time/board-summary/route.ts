import { boardTimeSummary } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser, parseTaskId } from "../_lib";

export async function GET(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const projectId = parseTaskId(request.nextUrl.searchParams.get("board"));
  if (!projectId) {
    return NextResponse.json(
      { success: false, error: "board must be a positive integer" },
      { status: 400 },
    );
  }

  const summary = await boardTimeSummary(auth.userId, projectId);
  if (!summary) {
    return NextResponse.json(
      { success: false, error: "Board not found or access denied" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    calculatedAt: summary.calculatedAt.toISOString(),
    enabled: summary.enabled,
    showTimeTotals: summary.showTimeTotals,
    entries: summary.entries.map((entry) => ({
      ...entry,
      runningEntries: entry.runningEntries.map((runningEntry) => ({
        ...runningEntry,
        pausedAt: runningEntry.pausedAt?.toISOString() ?? null,
        startedAt: runningEntry.startedAt.toISOString(),
      })),
    })),
  });
}
