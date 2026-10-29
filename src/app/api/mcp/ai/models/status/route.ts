import { NextRequest, NextResponse } from "next/server";
import { readModelCanaryStatus } from "@/lib/ai/modelCanary";
import { reportError } from "@/lib/errors/reportError";
import { MODEL_CANARY_STATE_FLAG, isFeatureEnabled } from "@/lib/flags";
import { wrapMcpRoute, validateMcpRouteAuth, checkMcpRouteRateLimit } from "@/lib/mcp/routeWrapper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = wrapMcpRoute(async (request: NextRequest) => {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const rateLimited = await checkMcpRouteRateLimit(request);
    if (rateLimited) {
      rateLimited.headers.set("Cache-Control", headers["Cache-Control"]);
      return rateLimited;
    }
    const ctx = await validateMcpRouteAuth(request);
    if (!ctx) {
      return NextResponse.json({ success: false, error: "Invalid or missing authentication token." }, { status: 401, headers });
    }
    const status = await readModelCanaryStatus();
    if (!await isFeatureEnabled(MODEL_CANARY_STATE_FLAG, ctx.user.id)) {
      return NextResponse.json({ success: true, checkedAt: status.checkedAt, models: status.models }, { headers });
    }
    return NextResponse.json({ success: true, ...status }, { headers });
  } catch (error) {
    await reportError({
      message: error instanceof Error ? error.message : "AI request failed",
      stack: error instanceof Error ? error.stack : undefined,
      url: "/api/mcp/ai/models/status",
      source: "handled",
      extra: { stage: "request" },
    });
    return NextResponse.json({ success: false, error: "Model status is unavailable" }, { status: 503, headers });
  }
});
