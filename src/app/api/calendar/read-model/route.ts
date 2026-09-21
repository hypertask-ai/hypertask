import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import { getCalendarReadModel } from "@/utils/controllers/tasks/calendarReadModel";
import {
  validateCalendarVisibleRange,
  type CalendarVisibleRange,
} from "@/lib/calendarSync/range";
import { containsUnsafeCalendarIdentity } from "@/lib/calendarSync/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const { isValid, user } = isValidUser(
    cookieStore.get("nookies_user")?.value,
  );
  if (!isValid || !user?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const range: CalendarVisibleRange = {
    rangeStart: request.nextUrl.searchParams.get("rangeStart") ?? "",
    rangeEndExclusive:
      request.nextUrl.searchParams.get("rangeEndExclusive") ?? "",
    startIso: request.nextUrl.searchParams.get("start") ?? "",
    endExclusiveIso: request.nextUrl.searchParams.get("endExclusive") ?? "",
    timezone: request.nextUrl.searchParams.get("timezone") ?? "",
  };
  const validRange = validateCalendarVisibleRange(range);
  if (!validRange) {
    return NextResponse.json(
      { success: false, error: "Invalid calendar range" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  try {
    const { tasks, projects, authorizationRevision } = await getCalendarReadModel({
      userId: user.id,
      start: new Date(validRange.startIso),
      endExclusive: new Date(validRange.endExclusiveIso),
    });
    if (containsUnsafeCalendarIdentity({ tasks, projects })) {
      throw new Error("Calendar response contained unsafe identity fields");
    }
    return NextResponse.json(
      {
        success: true,
        payload: {
          ...validRange,
          accountId: user.id,
          authorizationRevision,
          retrievedAt: new Date().toISOString(),
          tasks,
          projects,
        },
      },
      { status: 200, headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("Calendar read-model reconciliation failed:", error);
    return NextResponse.json(
      { success: false, error: "Unable to load calendar" },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
