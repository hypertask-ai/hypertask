import { checkRestRateLimit } from "@/lib/api/rateLimit";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { deleteTaskAttachmentFromS3 } from "@/lib/storage/uploadTaskAttachmentToS3";
import { isValidUser } from "@/utils/edgeHelpers";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function warnIfSessionBelongsToAnotherUser(sessionId: string, callerId: number) {
  if (sessionId === "ALL") return;
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (session && session.userId !== callerId) {
      console.warn("[ai-chat/delete-session] refused delete of another user's chat", { callerId, sessionId });
    }
  } catch (error) {
    console.error("[ai-chat/delete-session] foreign-chat check failed", error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");


    const currentUser = await loadCurrentUser(req.headers, true).catch(() => null);
    let restCompat = false;
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
      } catch {
      }
    }
    const { isValid, user } = restCompat && currentUser
      ? { isValid: true, user: currentUser.user }
      : isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (restCompat && currentUser) {
      const limited = await checkRestRateLimit(currentUser.userId, "write");
      if (limited) return limited;
    }

    const { searchParams } = new URL(req.url);
    const toDelete = searchParams.get("delete");

    if (!toDelete) {
      return NextResponse.json(
        { error: "Session ID is required or ALL tag required" },
        { status: 400 }
      );
    }

    const attachments = await prisma.$transaction(async (tx) => {
      const sessions = await tx.chatSession.findMany({
        where: {
          userId: user.id,
          ...(toDelete === "ALL" ? {} : { id: toDelete }),
        },
        select: { id: true },
      });
      if (toDelete !== "ALL" && sessions.length === 0) return null;

      const sessionIds = sessions.map((session) => session.id);
      const rows = await tx.attachment.findMany({
        where: { chatMessage: { sessionId: { in: sessionIds } } },
        select: { id: true, fileSource: true },
      });
      await tx.chatSession.deleteMany({
        where: { userId: user.id, id: { in: sessionIds } },
      });
      return rows;
    });

    if (!attachments) {
      await warnIfSessionBelongsToAnotherUser(toDelete, user.id);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const removedAttachmentIds: number[] = [];
    await Promise.all(attachments.map(async (row) => {
      try {
        if (await deleteTaskAttachmentFromS3(row.fileSource)) {
          removedAttachmentIds.push(row.id);
        } else {
          console.error("[ai-chat/delete-session] attachment storage cleanup failed", row.id);
        }
      } catch (error) {
        console.error("[ai-chat/delete-session] attachment storage cleanup failed", row.id, error);
      }
    }));

    try {
      if (removedAttachmentIds.length > 0) {
        await prisma.attachment.deleteMany({
          where: { id: { in: removedAttachmentIds } },
        });
      }
    } catch (error) {
      console.error("[ai-chat/delete-session] attachment row cleanup failed after deletion", error);
    }

    try {
      const numSessions = await prisma.chatSession.count({
        where: { userId: user.id },
      });
      if (numSessions === 0) {
        await prisma.chatSession.create({ data: { userId: user.id } });
      }
    } catch (error) {
      console.error("[ai-chat/delete-session] replacement session creation failed after deletion", error);
    }

    return NextResponse.json(
      { message: `Session ${toDelete} deleted successfully` },
      { status: 200 }
    );
  } catch (error: any) {
    console.log("🚀 ~ DELETE ~ error while deleting session:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete session" },
      { status: 500 }
    );
  }
}
