import { NextRequest, NextResponse } from "next/server";
import { wrapMcpRoute, checkMcpRouteRateLimit, validateMcpRouteAuth } from "@/lib/mcp/routeWrapper";
import { reportMcpOperationCrash } from "@/lib/mcp/operationCrashReport";
import { getBoardHygiene } from "@/utils/controllers/projects/hygiene";

export async function GET(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  return wrapMcpRoute(async (request: NextRequest) => {
    try {
      const rateLimited = await checkMcpRouteRateLimit(request);
      if (rateLimited) return rateLimited;
      const ctx = await validateMcpRouteAuth(request);
      if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      const projectId = Number((await props.params).projectId);
      if (!Number.isSafeInteger(projectId) || projectId <= 0) {
        return NextResponse.json({ success: false, error: "Invalid project ID" }, { status: 400 });
      }
      const report = await getBoardHygiene(projectId, ctx.user.id, ctx.agentId, ctx.teamScope);
      if (!report) return NextResponse.json({ success: false, error: "Board not found or access denied" }, { status: 404 });
      return NextResponse.json({ success: true, projectId, report });
    } catch (error) {
      reportMcpOperationCrash(request, error);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
  })(request);
}
