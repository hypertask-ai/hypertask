import { deleteEntry } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { authenticateMcpTime, readEntryId } from "../_lib";

/**
 * HTPR-4725: an entry logged against the wrong task could not be removed from
 * the CLI or MCP. Unlike update, this also covers a still-running timer, since
 * a timer started by mistake is the common case.
 */
export async function POST(request: NextRequest) {
  const { ctx, body, response } = await authenticateMcpTime(request);
  if (response) return response;

  const entry = readEntryId(body);
  if (entry.response) return entry.response;

  const deleted = await deleteEntry(ctx.user.id, entry.entryId, ctx.agentId);

  // Same reasoning as update: one response for missing and for forbidden, so the
  // endpoint cannot be used to probe which entry ids exist.
  if (!deleted) {
    return NextResponse.json(
      { success: false, error: "Time entry not found or access denied" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, deleted: entry.entryId });
}
