import { listReport } from "@/lib/timeTracking";
import { parseTimeReportFilters } from "@/lib/timeReportFilters";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser } from "../_lib";

const invalidFilterResponse = (filter: string) =>
  NextResponse.json(
    { success: false, error: `Invalid ${filter} filter` },
    { status: 400 }
  );

export async function GET(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const parsed = parseTimeReportFilters(
    request.nextUrl.searchParams,
    auth.userId
  );
  if (!parsed.success) return invalidFilterResponse(parsed.filter);

  const entries = await listReport(auth.userId, parsed.filters);

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
