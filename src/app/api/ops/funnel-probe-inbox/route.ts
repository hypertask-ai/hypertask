import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7294_DAILY_FUNNEL_PROBE_FLAG } from "@/lib/flags/definitions/htpr-7294-daily-funnel-probe";
import { readProbeInbox } from "@/lib/funnelProbe/inbox";
import { isProbeRecipientEmail } from "@/lib/funnelProbe/probeEmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (new URL(request.url).origin !== "https://app.hypertask.ai") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = request.headers.get("authorization");
  if (!hasValidCronAuthorization(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isFeatureEnabled(HTPR_7294_DAILY_FUNNEL_PROBE_FLAG, null))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
