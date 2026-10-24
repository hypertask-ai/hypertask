import { NextRequest, NextResponse } from "next/server";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { cleanupBoardAccessRequests } from "@/lib/agents/boardAccessRequests/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await cleanupBoardAccessRequests(), { headers: { "Cache-Control": "no-store" } });
}
