import { NextRequest, NextResponse } from "next/server";

import { checkActiveTeamAllowanceDrift } from "@/lib/ai/allowanceDriftCheck";
import { refreshActiveBilledAllowances } from "@/lib/ai/billedAllowanceRefresh";
import { checkDailyGatewaySpend } from "@/lib/ai/dailyGatewaySpend";
import { withBackgroundReportBudget } from "@/lib/ai/gatewayReport";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ checked: 0, inconclusive: 0, unknown: 0, drift: 0, refusalAlerts: 0 });
  }
  return withBackgroundReportBudget(async () => {
    let spendCheckFailed = false;
    try {
      await checkDailyGatewaySpend();
    } catch {
      spendCheckFailed = true;
    }
    try {
      await refreshActiveBilledAllowances();
    } catch {}
    try {
      const counts = await checkActiveTeamAllowanceDrift();
      if (spendCheckFailed) return NextResponse.json({ ...counts, unknown: counts.unknown + 1 }, { status: 503 });
      return NextResponse.json(counts);
    } catch {
      return NextResponse.json({ checked: 0, inconclusive: 0, unknown: 1, drift: 0, refusalAlerts: 0 }, { status: 503 });
    }
  });
}
