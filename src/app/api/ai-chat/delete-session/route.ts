import prisma from "@/lib/prisma";
import { deleteTaskAttachmentFromS3 } from "@/lib/storage/uploadTaskAttachmentToS3";
import { isValidUser } from "@/utils/edgeHelpers";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

//Tis simple. We get the attachments in the sessions. We delete them from the bucket and then the db. 
async function removeChatAttachmentsForSessions(sessionIds: string[]) {
  if (sessionIds.length === 0) return;

  const rows = await prisma.attachment.findMany({
    where: {
      chatMessage: {
        sessionId: { in: sessionIds },
      },
    },
    select: {
      id: true,
      fileSource: true,
    },
  });

  if (rows.length === 0) return;

  await Promise.all(rows.map((row) => deleteTaskAttachmentFromS3(row.fileSource)));

  await prisma.attachment.deleteMany({
    where: {
      id: { in: rows.map((r) => r.id) },
    },
  });
}

// Template for handling DELETE request to remove a chat session
export async function DELETE(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const toDelete = searchParams.get("delete");

    if (!toDelete) {
      return NextResponse.json(
        { error: "Session ID is required or ALL tag required" },
        { status: 400 }
      );
    }

    if (toDelete === "ALL") {
      const sessions = await prisma.chatSession.findMany({
        where: {
          userId: user.id,
        },
        select: {
          id: true,
        },
      });

      await removeChatAttachmentsForSessions(sessions.map((s) => s.id));

      const deleted = await prisma.chatSession.deleteMany({
        where: {
          userId: user.id,
        },
      });

      console.log("🚀 ~ DELETE ~ Number of sessions deleted:", deleted.count);
      await prisma.chatSession.create({
        data: {
          userId: user.id,
        },
      });
    } else {
      await removeChatAttachmentsForSessions([toDelete]);

      await prisma.chatSession.delete({
        where: {
          id: toDelete,
          userId: user.id,
        },
      });

      const numSessions = await prisma.chatSession.count({
        where: {
          userId: user.id,
        },
      });

      console.log("🚀 ~ DELETE ~ Number of sessions remaining:", numSessions);

      if (numSessions === 0) {
        await prisma.chatSession.create({
          data: {
            userId: user.id,
          },
        });
      }

      return NextResponse.json(
        { message: `Session ${toDelete} deleted successfully` },
        { status: 200 }
      );
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
