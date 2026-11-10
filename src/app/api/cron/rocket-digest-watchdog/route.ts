import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { checkUpdatesFreshness } from "@/lib/rocketDigest/digest";

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

  try {
    const check = await checkUpdatesFreshness();
    return NextResponse.json(check);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[rocket-digest] freshness check failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
