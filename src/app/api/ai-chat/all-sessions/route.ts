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

    const sessions = await prisma.chatSession.findMany({
      where: {
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
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (sessions.length === 0) {
      console.warn("No sessions found, creating new session");
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
      sessions.push(session);
    }

    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    console.error("🚀 ~ GET ~ Error listing chat sessions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
