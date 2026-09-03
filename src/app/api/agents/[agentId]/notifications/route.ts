import { NextRequest, NextResponse } from "next/server";
import { getStructuredInboxForAgent } from "@/utils/controllers/notifications/getStructuredInboxForAgent";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export async function GET(request: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const userId = (await getSessionUser(request.headers))?.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const result = await getStructuredInboxForAgent({
    userId,
    agentId: params.agentId,
  });

  if (!result.ok) {
    if (result.kind === "not_found") {
      return NextResponse.json(
        { success: false, error: "Agent does not exist" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    structuredData: result.structuredData,
    notifications: result.notifications,
  });
}
