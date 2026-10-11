import { NextRequest, NextResponse } from "next/server";

import { collectBatches } from "@/lib/ai/batch/collectBatches";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// HTPR-7098: applies finished half-price AI batches (Slack summaries, smart label backfills).
export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await collectBatches());
}
