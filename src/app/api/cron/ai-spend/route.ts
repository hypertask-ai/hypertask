import { NextRequest, NextResponse } from "next/server";
import { checkDailyAiSpend } from "@/lib/ai/dailyAiSpend";
import { checkUpstashDailyRequests } from "@/lib/ops/upstashRequestAlarm";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ checked: 0 });
  }
  try {
    const [aiSpend, upstash] = await Promise.all([checkDailyAiSpend(), checkUpstashDailyRequests()]);
    return NextResponse.json({ checked: 1, ...aiSpend, upstash });
  } catch {
    return NextResponse.json({ error: "AI usage check unavailable" }, { status: 503 });
  }
}
