import { NextRequest, NextResponse } from "next/server";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (typeof user?.id !== "number") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const since = request.nextUrl.searchParams.get("since");
    const sinceDate = since
      ? new Date(since)
      : new Date(Date.now() - DEFAULT_LOOKBACK_MS);

    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid since date" },
        { status: 400 },
      );
    }

    const match = await prisma.logs.findFirst({
      where: {
        LoggedById: user.id,
        createdAt: { gt: sinceDate },
        OR: [
          { log: "cli_token_exchange" },
          { log: { startsWith: "mcp_connected" } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      connected: !!match,
      at: match ? match.createdAt.toISOString() : undefined,
    });
  } catch (error) {
    console.error("GET [users/ai-connection-status] failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
