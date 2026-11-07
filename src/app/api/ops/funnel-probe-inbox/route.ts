import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { readProbeInbox } from "@/lib/funnelProbe/inbox";
import { isProbeRecipientEmail } from "@/lib/funnelProbe/probeEmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRODUCTION_ORIGIN = "https://app.hypertask.ai";

export async function GET(request: NextRequest) {
  if (new URL(request.url).origin !== PRODUCTION_ORIGIN) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email || !isProbeRecipientEmail(email)) {
    return NextResponse.json({ error: "invalid probe email" }, { status: 400 });
  }
  const entry = await readProbeInbox(email);
  if (!entry) {
    return NextResponse.json({ found: false }, { status: 404 });
  }
  return NextResponse.json({ found: true, entry });
}
