import { withAuth } from "#with-auth";
import { administeredProjectIds, listReport } from "@/lib/timeTracking";
import { parseTimeReportFilters } from "@/lib/timeReportFilters";
import {
  HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG,
  isFeatureEnabled,
} from "@/lib/flags";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser } from "../_lib";

const invalidFilterResponse = (filter: string) =>
  NextResponse.json(
    { success: false, error: `Invalid ${filter} filter` },
    { status: 400 }
  );

async function GETHandler(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const parsed = parseTimeReportFilters(
    request.nextUrl.searchParams,
    auth.userId
  );
  if (!parsed.success) return invalidFilterResponse(parsed.filter);

  const reportsEnabled = await isFeatureEnabled(
    HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG,
    auth.userId
  );
  const adminProjectIds = reportsEnabled
    ? await administeredProjectIds(auth.userId, {
        teamId: parsed.filters.teamId,
        boardIds: parsed.filters.boardIds,
      })
    : [];
  const canViewOthers = reportsEnabled && adminProjectIds.length > 0;
  // A stale "user" URL parameter must not turn the report empty for a plain
  // member (no UI to clear it), so the filter only applies with the scope.
  const entries = await listReport(auth.userId, {
    ...parsed.filters,
    ...(canViewOthers ? {} : { filterUserIds: undefined }),
    adminProjectIds,
  });

  return NextResponse.json({
    success: true,
    canViewOthers,
    entries: entries.map((entry) => ({
      ...entry,
      startedAt: entry.startedAt.toISOString(),
      endedAt: entry.endedAt?.toISOString() ?? null,
      pausedAt: entry.pausedAt?.toISOString() ?? null,
    })),
  });
}

export const GET = withAuth(GETHandler);
