import { NextRequest, NextResponse } from "next/server";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { checkUpstashDailyRequests } from "@/lib/ops/upstashRequestAlarm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await checkUpstashDailyRequests());
  } catch (error) {
    console.error("[upstash-alarm] check failed", error);
    return NextResponse.json({ error: "check failed" }, { status: 500 });
  }
}
