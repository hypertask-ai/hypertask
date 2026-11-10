import { NextRequest, NextResponse } from "next/server";
import { checkDailyAiSpend } from "@/lib/ai/dailyAiSpend";
import { isFeatureEnabled, FEATURE_FLAG_OWNER_USER_ID } from "@/lib/flags";
import { HTPR_8978_UPSTASH_AUDIENCE_FLAG } from "@/lib/flags/definitions/htpr-8978-upstash-audience";
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
    const upstashEnabled = await isFeatureEnabled(HTPR_8978_UPSTASH_AUDIENCE_FLAG, FEATURE_FLAG_OWNER_USER_ID);
    const [aiSpend, upstash] = await Promise.all([
      checkDailyAiSpend(),
      upstashEnabled ? checkUpstashDailyRequests() : Promise.resolve({ day: new Date().toISOString().slice(0, 10), filed: false, skipped: true }),
    ]);
    return NextResponse.json({ checked: 1, ...aiSpend, upstash });
  } catch {
    return NextResponse.json({ error: "AI usage check unavailable" }, { status: 503 });
  }
}
