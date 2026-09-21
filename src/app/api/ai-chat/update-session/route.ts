import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { chatStore } from "@/utils/controllers/chat";
import prisma from "@/lib/prisma";
import { isValidUser } from "@/utils/edgeHelpers";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function POSTHandler(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");

    if (!userCookie?.value) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { isValid, user } = isValidUser(userCookie.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, title } = body;

    const existingSession = await chatStore().sessions.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingSession) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    const session = await chatStore().sessions.update({
      where: { id: sessionId },
      data: {
        title,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, session }, { status: 200 });
  } catch (error: any) {
    htLogger.error("🚀 ~ POST ~ Error updating chat session", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to update chat session",
      },
      { status: 500 }
    );
  }
}

export const POST = withAuth(POSTHandler);
