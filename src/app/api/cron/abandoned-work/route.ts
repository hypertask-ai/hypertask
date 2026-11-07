import { NextRequest, NextResponse } from "next/server";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { FEATURE_FLAG_OWNER_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_8909_ABANDONED_WORK_FLAG } from "@/lib/flags/definitions/htpr-8909-abandoned-work";
import { sweepAbandonedWork } from "@/lib/abandonedWork/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isFeatureEnabled(HTPR_8909_ABANDONED_WORK_FLAG, FEATURE_FLAG_OWNER_USER_ID))) {
    return NextResponse.json({ enabled: false, liveRunners: 0, boards: [] });
  }
  const dryRun = request.nextUrl.searchParams.get("dry") === "1";
  const result = await sweepAbandonedWork({ dryRun });
  return NextResponse.json(result);
}
