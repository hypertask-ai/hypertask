import { NextRequest, NextResponse } from "next/server";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import { dismissAgentConnectCard, getAgentConnectCardState, getFirstAgentConnection, isAgentConnectCheckEnabledFor } from "@/lib/onboarding/agentConnection";

export const runtime = "nodejs";

const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (typeof user?.id !== "number") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (request.nextUrl.searchParams.get("mode") === "first") {
      const state = await getAgentConnectCardState(user.id);
      if (!state.eligible) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(state);
    }

    const since = request.nextUrl.searchParams.get("since");
    const sinceDate = since ? new Date(since) : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: "Invalid since date" }, { status: 400 });
    }
    const match = await getFirstAgentConnection(user.id, sinceDate);
    const enabled = await isAgentConnectCheckEnabledFor(user.id);
    const status = enabled
      ? { connected: !!match, at: match?.at, client: match?.client }
      : { connected: !!match, at: match?.at };
    return NextResponse.json(status);
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
    if (!(await isAgentConnectCheckEnabledFor(user.id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await dismissAgentConnectCard(user.id);
    return NextResponse.json({ success: true });
  } catch {
    console.error("POST [users/ai-connection-status] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
