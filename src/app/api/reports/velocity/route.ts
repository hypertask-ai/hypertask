import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { loadVelocityReport } from "@/utils/controllers/reports/velocityReport";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

type CookieUser = { id?: number };

async function getCurrentUserFromCookies(): Promise<CookieUser | null> {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    if (!userCookie?.value) return null;
    return JSON.parse(userCookie.value) as CookieUser;
  } catch (error) {
    console.log("🚀 ~ getCurrentUserFromCookies ~ error:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  return withAgentScopeRequest(request, () => getVelocityReport(request));
}

async function getVelocityReport(request: NextRequest) {
  const session = await getSessionUser(request.headers).catch(() => null);
  const currentUser = await loadCurrentUser(request.headers, true).catch(() => null);
  const cookieUser = currentUser
    ? currentUser.user
    : await getCurrentUserFromCookies();
  const userId = Number(cookieUser?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
      { status: 400 }
    );
  }

  try {
    const report = await loadVelocityReport({
      projectId,
      userId,
      actingUserId: session?.agentId ? session.userId : userId,
      actingAgentId: session?.agentId ?? null,
      teamScope: session?.teamScope ?? null,
      rangeKey: request.nextUrl.searchParams.get("range"),
    });

    if (!report) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("[reports/velocity] Unable to build report:", error);
    return NextResponse.json(
      { error: "Unable to load velocity report" },
      { status: 500 }
    );
  }
}
