import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import { getCalendarAccessibleProjectIds } from "@/utils/controllers/tasks/calendarReadModel";
import { buildCalendarAuthorizationRevision } from "@/lib/calendarSync/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
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

  try {
    const projectIds = await getCalendarAccessibleProjectIds(user.id);
    return NextResponse.json(
      {
        success: true,
        accountId: user.id,
        projectIds,
        authorizationRevision: buildCalendarAuthorizationRevision(projectIds),
      },
      { status: 200, headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("Calendar access check failed:", error);
    return NextResponse.json(
      { success: false, error: "Unable to verify Calendar access" },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
