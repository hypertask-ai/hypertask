import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled, isFeatureFlagOwner } from "@/lib/flags";
import { HTPR_7072_DECISION_INBOX_FLAG } from "@/lib/flags/keys";
import { getDecisionInbox } from "@/utils/controllers/inbox/decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isFeatureEnabled(HTPR_7072_DECISION_INBOX_FLAG, userId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rows = await getDecisionInbox(userId, await isFeatureFlagOwner(request.headers));
    return NextResponse.json({ rows });
  } catch (error) {
    console.error("[inbox/decisions] failed", error);
    return NextResponse.json({ error: "Could not load decisions" }, { status: 500 });
  }
}
