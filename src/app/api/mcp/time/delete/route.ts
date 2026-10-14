import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { deleteEntry } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { authenticateMcpTime, readEntryId } from "../_lib";

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const { ctx, body, response } = await authenticateMcpTime(request);
  if (response) return response;

  const entry = readEntryId(body);
  if (entry.response) return entry.response;

  const deleted = await deleteEntry(ctx.user.id, entry.entryId, ctx.agentId);

  if (!deleted) {
    return NextResponse.json(
      { success: false, error: "Time entry not found or access denied" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, deleted: entry.entryId });

  })(request)
}
