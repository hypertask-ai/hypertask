import { checkRestRateLimit } from "@/lib/api/rateLimit";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
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
      : isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (restCompat && currentUser) {
      const limited = await checkRestRateLimit(currentUser.userId, "read");
      if (limited) return limited;
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
