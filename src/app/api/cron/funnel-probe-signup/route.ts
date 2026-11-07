import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7294_DAILY_FUNNEL_PROBE_FLAG } from "@/lib/flags/definitions/htpr-7294-daily-funnel-probe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isFeatureEnabled(HTPR_7294_DAILY_FUNNEL_PROBE_FLAG, null))) {
    return NextResponse.json({ ok: false, disabled: true }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    runner: "github-actions",
    workflow: "funnel-probe-daily.yml",
    note: "The browser walk runs on GitHub Actions; this cron is the Vercel schedule anchor.",
  });
}
