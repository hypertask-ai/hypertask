import { NextRequest, NextResponse } from "next/server";
import { checkDailyAiSpend } from "@/lib/ai/dailyAiSpend";
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
    return NextResponse.json({ checked: 1, ...await checkDailyAiSpend() });
  } catch {
    return NextResponse.json({ error: "AI usage check unavailable" }, { status: 503 });
  }
}
