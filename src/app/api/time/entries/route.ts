import {
  createManualEntry,
  deleteEntry,
  elapsedSeconds,
  listEntries,
  TimeTrackingDisabledError,
  updateEntry,
} from "@/lib/timeTracking";
import { parseTimeMinutes } from "@/lib/timeManualEntry";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser, parseTaskId, validateTimeTaskAccess } from "../_lib";

const notFoundResponse = () =>
  NextResponse.json(
    { success: false, error: "Time entry not found or access denied" },
    { status: 404 }
  );

const serializeEntry = <T extends {
  id: number;
  userId: number;
  note: string | null;
  startedAt: Date;
  endedAt: Date | null;
  pausedAt: Date | null;
  createdAt: Date;
  userName: string;
}>(entry: T) => ({
  id: entry.id,
  userId: entry.userId,
  userName: entry.userName,
  note: entry.note,
  startedAt: entry.startedAt,
  endedAt: entry.endedAt,
  pausedAt: entry.pausedAt,
  createdAt: entry.createdAt,
  seconds: elapsedSeconds(entry.startedAt, entry.endedAt, entry.pausedAt),
});

export async function GET(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const taskId = parseTaskId(request.nextUrl.searchParams.get("taskId"));
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId must be a positive integer" },
      { status: 400 }
    );
  }

  const result = await listEntries(auth.userId, taskId);
  if (!result) return notFoundResponse();

  return NextResponse.json({
    success: true,
    canManage: result.canManage,
    entries: result.entries.map(serializeEntry),
  });
}

export async function POST(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const taskId = parseTaskId(body?.taskId);
  const minutes = parseTimeMinutes(body?.minutes);
  const date = body?.date;
  const note = typeof body?.note === "string" ? body.note : undefined;
  const timezoneOffsetMinutes =
    typeof body?.timezoneOffsetMinutes === "number" &&
    Number.isInteger(body.timezoneOffsetMinutes) &&
    Math.abs(body.timezoneOffsetMinutes) <= 14 * 60
      ? body.timezoneOffsetMinutes
      : undefined;
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId must be a positive integer" },
      { status: 400 }
    );
  }
  if (minutes === null) {
    return NextResponse.json(
      { success: false, error: "minutes must be an integer from 1 to 1440" },
      { status: 400 }
    );
  }
  if (typeof date !== "string" || date.length === 0) {
    return NextResponse.json(
      { success: false, error: "date must be a non-empty string" },
      { status: 400 }
    );
  }

  const accessError = await validateTimeTaskAccess(auth.userId, taskId);
  if (accessError) return accessError;

  try {
    const entry = await createManualEntry(
      auth.userId,
      taskId,
      date,
      minutes,
      timezoneOffsetMinutes,
      note
    );
    return NextResponse.json({
      success: true,
      entry: {
        id: entry.id,
        taskId: entry.taskId,
        userId: entry.userId,
        note: entry.note,
        startedAt: entry.startedAt.toISOString(),
        endedAt: entry.endedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof TimeTrackingDisabledError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      );
    }
    if (error instanceof RangeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const entryId = parseTaskId(body?.entryId);
  const minutes = parseTimeMinutes(body?.minutes);
  const date = body?.date;
  const note = typeof body?.note === "string" ? body.note : undefined;
  const timezoneOffsetMinutes =
    typeof body?.timezoneOffsetMinutes === "number" &&
    Number.isInteger(body.timezoneOffsetMinutes) &&
    Math.abs(body.timezoneOffsetMinutes) <= 14 * 60
      ? body.timezoneOffsetMinutes
      : undefined;
  if (!entryId) {
    return NextResponse.json(
      { success: false, error: "entryId must be a positive integer" },
      { status: 400 }
    );
  }
  if (minutes === null) {
    return NextResponse.json(
      { success: false, error: "minutes must be an integer from 1 to 1440" },
      { status: 400 }
    );
  }
  if (date !== undefined && typeof date !== "string") {
    return NextResponse.json(
      { success: false, error: "date must be a string" },
      { status: 400 }
    );
  }

  try {
    const entry = await updateEntry(
      auth.userId,
      entryId,
      minutes,
      date,
      timezoneOffsetMinutes,
      note
    );
    if (!entry) return notFoundResponse();
    return NextResponse.json({ success: true, entry: serializeEntry(entry) });
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

export async function DELETE(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const entryId = parseTaskId(body?.entryId);
  if (!entryId) {
    return NextResponse.json(
      { success: false, error: "entryId must be a positive integer" },
      { status: 400 }
    );
  }

  const deleted = await deleteEntry(auth.userId, entryId);
  if (!deleted) return notFoundResponse();
  return NextResponse.json({ success: true });
}
