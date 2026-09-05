import prisma from "@/lib/prisma";
import {
  getHypertasksObjectSize,
  resolveOwnAiChatAttachmentKey,
  uploadAiChatAttachmentToS3,
} from "@/lib/storage/uploadTaskAttachmentToS3";
import { isValidUser } from "@/utils/edgeHelpers";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type IncomingAttachment = {
  fileName?: string;
  mimeType?: string | null;
  url?: string;
  fileSource?: string;
};

type UploadedAttachment = {
  fileName: string;
  mimeType: string;
  fileSize: string;
  fileSource: string;
};

function parseDataUrlToBuffer(dataUrl: string): {
  mimeType: string;
  buffer: Buffer;
} {
  const dataUrlRegex = /^data:([^;]+);base64,(.+)$/;
  const match = dataUrl.match(dataUrlRegex);
  if (!match) {
    throw new Error("Attachment must be a valid base64 data URL");
  }

  const [, mimeTypeRaw, base64Payload] = match;
  const mimeType = mimeTypeRaw || "application/octet-stream";
  const buffer = Buffer.from(base64Payload, "base64");

  if (!buffer.length) {
    throw new Error("Attachment payload is empty");
  }

  return { mimeType, buffer };
}

export async function POST(request: NextRequest) {
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
    const { sessionId, message: messageData } = body;
    const incomingAttachments: IncomingAttachment[] = Array.isArray(
      messageData?.attachments
    )
      ? messageData.attachments
      : [];

    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
      select: {
        id: true,
        agentId: true,
      },
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    const uploadedAttachments: UploadedAttachment[] = [];
    for (let index = 0; index < incomingAttachments.length; index++) {
      const attachment = incomingAttachments[index];
      const source = attachment?.url ?? attachment?.fileSource;
      if (!source) continue;

      const fileName =
        attachment.fileName || `chat-attachment-${Date.now()}-${index}`;

      // An inline editor image was already uploaded when it was pasted, so it arrives as a
      // URL rather than bytes: the browser cannot turn it back into base64 because the
      // attachment host serves no CORS header (HTPR-4735). Record the object we already
      // hold instead of demanding a second copy of it.
      //
      // The key decides this, not the HEAD. Only this session's own AI chat folder is
      // accepted, so a client cannot smuggle in someone else's file, and a storage blip
      // cannot be mistaken for a rejected attachment and cost the user their message.
      const ownKey = resolveOwnAiChatAttachmentKey(source, sessionId);
      if (ownKey) {
        const existingSize = await getHypertasksObjectSize(ownKey);
        uploadedAttachments.push({
          fileName,
          mimeType: attachment.mimeType || "application/octet-stream",
          fileSize: String(existingSize ?? 0),
          fileSource: source,
        });
        continue;
      }

      const { mimeType: parsedMimeType, buffer } = parseDataUrlToBuffer(source);
      const mimeType = attachment.mimeType || parsedMimeType;
      const fileSource = await uploadAiChatAttachmentToS3(
        buffer,
        fileName,
        mimeType,
        sessionId
      );

      uploadedAttachments.push({
        fileName,
        mimeType,
        fileSize: String(buffer.length),
        fileSource,
      });
    }

    // Linkify is enrichment only — never let it fail the message persist.
    const content =
      messageData.role === "assistant"
        ? await linkifyTicketRefs(messageData.content, user.id).catch((err) => {
            console.error("linkifyTicketRefs failed, saving unlinked:", err);
            return messageData.content;
          })
        : messageData.content;

    const [_, message] = await prisma.$transaction([
      prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          updatedAt: new Date(),
        },
      }),
      prisma.chatMessage.create({
        data: {
          sessionId,
          content,
          role: messageData.role,
          isDelivered: true,
          // The person owns their own turns; a reply in a native agent's
          // session is that agent's. A plain AI reply has no Agent row and
          // stays unattributed.
          authorUserId: messageData.role === "human" ? user.id : null,
          authorAgentId:
            messageData.role === "assistant" ? session.agentId : null,
          attachments: uploadedAttachments.length
            ? {
                create: uploadedAttachments.map((attachment) => ({
                  fileType: attachment.mimeType,
                  fileSource: attachment.fileSource,
                  fileName: attachment.fileName,
                  fileSize: attachment.fileSize,
                })),
              }
            : undefined,
        },
        include: {
          attachments: true,
        },
      }),
    ]);

    return NextResponse.json({ message }, { status: 200 });
  } catch (error: any) {
    console.error("🚀 ~ POST ~ Error adding chat message", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to add chat message",
      },
      { status: 500 }
    );
  }
}
