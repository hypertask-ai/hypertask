import { NextRequest, NextResponse } from "next/server";

import { runModelCanary } from "@/lib/ai/modelCanary";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { reportError } from "@/lib/errors/reportError";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ checked: 0, pass: 0, fail: 0, skipped: 0, inconclusive: 0 });
  }
  try {
    return NextResponse.json(await runModelCanary());
  } catch (error) {
    await reportError({
      message: error instanceof Error ? error.message : "Model canary run failed",
      stack: error instanceof Error ? error.stack : undefined,
      url: "/api/cron/ai-model-canary",
      source: "handled",
      extra: { stage: "run" },
    });
    return NextResponse.json({ checked: 0, pass: 0, fail: 0, skipped: 0, inconclusive: 1 }, { status: 503 });
  }
}
