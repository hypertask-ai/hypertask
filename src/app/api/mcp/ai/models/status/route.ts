import { NextRequest, NextResponse } from "next/server";
import { readModelCanaryStatus } from "@/lib/ai/modelCanary";
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
    if (!await validateMcpRouteAuth(request)) {
      return NextResponse.json({ success: false, error: "Invalid or missing authentication token." }, { status: 401, headers });
    }
    return NextResponse.json({ success: true, ...await readModelCanaryStatus() }, { headers });
  } catch {
    return NextResponse.json({ success: false, error: "Model status is unavailable" }, { status: 503, headers });
  }
});
