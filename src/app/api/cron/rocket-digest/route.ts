import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { reportError } from "@/lib/errors/reportError";
import { runRocketDigest } from "@/lib/rocketDigest/digest";

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

  const dryRun = request.nextUrl.searchParams.get("dry") === "1";

  try {
    const run = await runRocketDigest({ dryRun });
    return NextResponse.json({ ...run, dryRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[rocket-digest] run failed", message);
    await reportError({
      message: `Latest Updates digest failed: ${message}`,
      source: "server",
      url: "/api/cron/rocket-digest",
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
