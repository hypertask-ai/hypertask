import prisma from "@/lib/prisma";
import { isValidUser } from "@/utils/edgeHelpers";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const taskIdSchema = z.coerce.number().int().positive();

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

    const parsedTaskId = taskIdSchema.safeParse(
      request.nextUrl.searchParams.get("taskId")
    );
    if (!parsedTaskId.success) {
      return NextResponse.json(
        { error: "A valid task ID is required" },
        { status: 400 }
      );
    }

    const sessions = await prisma.chatSession.findMany({
      where: {
        userId: user.id,
        taskId: parsedTaskId.data,
        messages: { some: {} },
      },
      select: {
        id: true,
        title: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });

    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    console.error("Error listing task chat sessions:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
