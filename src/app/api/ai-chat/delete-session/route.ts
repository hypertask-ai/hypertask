import { chatAudienceWhere } from "@/lib/agents/chatContentScope";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import { loadCurrentUser } from "@/lib/auth/currentUser";
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
    const { isValid, user } = currentUser
      ? { isValid: true, user: currentUser.user }
      : isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (currentUser) {
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

    const sessions = await prisma.chatSession.findMany({
      where: {
        userId: user.id,
        ...chatAudienceWhere({ userId: user.id, agentId: currentUser?.agentId }),
        ...(toDelete === "ALL" ? {} : { id: toDelete }),
      },
      select: { id: true },
    });
    if (toDelete !== "ALL" && sessions.length === 0) {
      await warnIfSessionBelongsToAnotherUser(toDelete, user.id);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sessionIds = sessions.map((session) => session.id);
    const attachments = await prisma.attachment.findMany({
      where: { chatMessage: { sessionId: { in: sessionIds } } },
      select: { id: true, fileSource: true },
    });

    const removedAttachmentIds: number[] = [];
    await Promise.all(attachments.map(async (row) => {
      try {
        if (await deleteTaskAttachmentFromS3(row.fileSource)) {
          removedAttachmentIds.push(row.id);
        } else {
          console.error("[ai-chat/delete-session] attachment storage cleanup failed", row.id);
        }
      } catch {
        console.error("[ai-chat/delete-session] attachment storage cleanup failed", row.id);
      }
    }));

    if (removedAttachmentIds.length !== attachments.length) {
      return NextResponse.json(
        { error: "Could not remove chat files, please try again" },
        { status: 503 }
      );
    }

    await prisma.$transaction(async (tx) => {
      if (removedAttachmentIds.length > 0) {
        await tx.attachment.deleteMany({
          where: { id: { in: removedAttachmentIds } },
        });
      }
      await tx.chatSession.deleteMany({
        where: { userId: user.id, id: { in: sessionIds }, ...chatAudienceWhere({ userId: user.id, agentId: currentUser?.agentId }) },
      });
    });

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
