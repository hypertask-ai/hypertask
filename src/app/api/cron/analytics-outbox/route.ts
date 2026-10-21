import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { retryAnalyticsIntents } from "@/lib/telemetry/analyticsIntents";
import { retryAnalyticsOutbox } from "@/lib/telemetry/analyticsOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const intents = await retryAnalyticsIntents();
  const outbox = await retryAnalyticsOutbox();
  return NextResponse.json({ ...outbox, intents });
}
