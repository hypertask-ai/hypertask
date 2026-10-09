import { NextRequest, NextResponse } from "next/server";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import { HTPR_7026_AGENT_CONNECT_CHECK_FLAG, isFeatureEnabled } from "@/lib/flags";
import { dismissAgentConnectCard, getAgentConnectCardState, getFirstAgentConnection } from "@/lib/onboarding/agentConnection";

export const runtime = "nodejs";

const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (typeof user?.id !== "number") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (request.nextUrl.searchParams.get("mode") === "first") {
      if (!(await isFeatureEnabled(HTPR_7026_AGENT_CONNECT_CHECK_FLAG, user.id))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(await getAgentConnectCardState(user.id));
    }

    const since = request.nextUrl.searchParams.get("since");
    const sinceDate = since ? new Date(since) : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: "Invalid since date" }, { status: 400 });
    }
    const match = await getFirstAgentConnection(user.id, sinceDate);
    return NextResponse.json({ connected: !!match, at: match?.at, client: match?.client });
  } catch {
    console.error("GET [users/ai-connection-status] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await getCurrentUserFromCookies();
    if (typeof user?.id !== "number") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isFeatureEnabled(HTPR_7026_AGENT_CONNECT_CHECK_FLAG, user.id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await dismissAgentConnectCard(user.id);
    return NextResponse.json({ success: true });
  } catch {
    console.error("POST [users/ai-connection-status] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
