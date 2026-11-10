import { NextRequest, NextResponse } from "next/server";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { checkUpstashDailyRequests } from "@/lib/ops/upstashRequestAlarm";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ checked: 0 });
  }
  try {
    return NextResponse.json({ checked: 1, ...await checkUpstashDailyRequests() });
  } catch {
    return NextResponse.json({ error: "Upstash request check unavailable" }, { status: 503 });
  }
}
