import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getStructuredInboxForAgent } from "@/utils/controllers/notifications/getStructuredInboxForAgent";

async function getCurrentUserFromCookies() {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    if (!userCookie?.value) return null;
    return JSON.parse(userCookie.value) as { id?: number };
  } catch (error: any) {
    console.log("🚀 ~ getCurrentUserFromCookies ~ error:", error);
    return null;
  }
}

export async function GET(request: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const user = await getCurrentUserFromCookies();
  if (!user?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const result = await getStructuredInboxForAgent({
    userId: user.id,
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
