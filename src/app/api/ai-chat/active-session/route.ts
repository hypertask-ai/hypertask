import prisma from "@/lib/prisma";
import { isValidUser } from "@/utils/edgeHelpers";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
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

    const sessionId = request.nextUrl.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 }
      );
    }

    const session = await prisma.chatSession.findUnique({
      where: {
        userId: user.id,
        id: sessionId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
          include: {
            attachments: true,
          },
        },
      },
    });

    if (!session) {
      console.warn("Session not found, creating new session");
      const session = await prisma.chatSession.create({
        data: {
          userId: user.id,
        },
        include: {
          messages: {
            orderBy: {
              createdAt: "asc",
            },
            include: {
              attachments: true,
            },
          },
        },
      });
      return NextResponse.json(
        { success: true, session },
        { status: 200 }
      );
    }

    return NextResponse.json({ success: true, session });
  } catch (error) {
    console.error("🚀 ~ GET ~ Error getting active chat session:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
