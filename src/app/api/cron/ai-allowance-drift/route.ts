import { NextRequest, NextResponse } from "next/server";

import { checkActiveTeamAllowanceDrift } from "@/lib/ai/allowanceDriftCheck";
import { refreshActiveBilledAllowances } from "@/lib/ai/billedAllowanceRefresh";
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
  try {
    await refreshActiveBilledAllowances();
  } catch {}
  try {
    return NextResponse.json(await checkActiveTeamAllowanceDrift());
  } catch {
    return NextResponse.json({ checked: 0, inconclusive: 0, unknown: 1, drift: 0, refusalAlerts: 0 }, { status: 503 });
  }
}
