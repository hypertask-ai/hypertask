import { loadCurrentUser } from "@/lib/auth/currentUser";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import { getCalendarAccessibleProjectIds } from "@/utils/controllers/tasks/calendarReadModel";
import { buildCalendarAuthorizationRevision } from "@/lib/calendarSync/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const currentUser = await loadCurrentUser(request.headers, true).catch(() => null);
  let restCompat = false;
  if (currentUser) {
    try {
      restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
    } catch {
      // Flag lookup failure preserves the legacy entry path.
    }
  }
  const { isValid, user } = restCompat && currentUser
    ? { isValid: true, user: currentUser.user }
    : isValidUser(
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
