import { updateEntry } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { authenticateMcpTime, readEntryId } from "../_lib";

/**
 * HTPR-4725: agents could log time but never correct it. A mistyped duration was
 * permanent from the CLI and MCP, so the only fix was opening the web UI.
 *
 * Addresses a TimeEntry by id rather than a task, since a task can hold many
 * entries and the caller already has the id from /time/report.
 */
export async function POST(request: NextRequest) {
  const { ctx, body, response } = await authenticateMcpTime(request);
  if (response) return response;

  const entry = readEntryId(body);
  if (entry.response) return entry.response;

  const minutes = typeof body.minutes === "string" ? Number(body.minutes) : body.minutes;
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
    return NextResponse.json(
      { success: false, error: "minutes must be an integer from 1 to 1440" },
      { status: 400 }
    );
  }

  if (body.date !== undefined && typeof body.date !== "string") {
    return NextResponse.json(
      { success: false, error: "date must be a YYYY-MM-DD string" },
      { status: 400 }
    );
  }

  try {
    const updated = await updateEntry(
      ctx.user.id,
      entry.entryId,
      minutes,
      body.date,
      body.timezone_offset_minutes,
      body.note,
      ctx.agentId
    );

    // updateEntry returns null both when the entry does not exist and when the
    // caller may not touch it. Keeping one response for both avoids telling an
    // unauthorised caller which entry ids are real.
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Time entry not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, entry: updated });
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    throw error;
  }
}
