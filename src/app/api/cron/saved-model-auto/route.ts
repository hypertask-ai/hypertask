import { NextRequest, NextResponse } from "next/server";

import { sweepHtpr9019ModelChoices } from "@/lib/ai/htpr9019ModelChoiceAuto";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await sweepHtpr9019ModelChoices());
}
