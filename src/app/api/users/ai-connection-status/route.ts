import { NextRequest, NextResponse } from "next/server";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import { dismissAgentConnectCard, getAgentConnectCardState, getFirstAgentConnection } from "@/lib/onboarding/agentConnection";

export const runtime = "nodejs";

const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (typeof user?.id !== "number") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const mode = request.nextUrl.searchParams.get("mode");
    if (mode === "first" || mode === "overlay") {
      const state = await getAgentConnectCardState(user.id, mode === "overlay");
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
    const status = { connected: !!match, at: match?.at, client: match?.client };
    return NextResponse.json(status);
  } catch {
    console.error("GET [users/ai-connection-status] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request?: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (typeof user?.id !== "number") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const overlay = request?.nextUrl.searchParams.get("mode") === "overlay";
    const eligible = overlay ? (await getAgentConnectCardState(user.id, true)).eligible : true;
    if (!eligible) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await dismissAgentConnectCard(user.id);
    return NextResponse.json({ success: true });
  } catch {
    console.error("POST [users/ai-connection-status] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
