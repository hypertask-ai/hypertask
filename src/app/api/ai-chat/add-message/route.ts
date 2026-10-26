import { loadSidebarChatRequest } from "@/lib/agents/chatAccess";
import { readJsonBody } from "@/lib/mcp/readJsonBody";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
import { resolveQueuedMessageCreatedAt } from "@/lib/aiChat/queuedMessageOrder";
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


    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null);
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

    let body: Awaited<ReturnType<typeof request.json>>;
    if (restCompat) {
      let jsonError: unknown;
      const result = await readJsonBody<typeof body>({
        json: async () => {
          try {
            body = await request.json();
            return body;
          } catch (error) {
            jsonError = error;
            throw error;
          }
        },
      } as Request, {
        invalidJson: () => { throw jsonError },
        invalidObject: () => NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 }),
      });
      if (result.ok) body = result.body;
    } else {
      body = await request.json();
    }
    const { sessionId, message: messageData } = body;
    const sidebarAccess = await loadSidebarChatRequest(request, sessionId);
    if (!sidebarAccess.ok) return NextResponse.json({ success: false, error: sidebarAccess.error }, { status: sidebarAccess.status });
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

    const content =
      messageData.role === "assistant"
        ? await linkifyTicketRefs(messageData.content, user.id).catch((err) => {
            console.error("linkifyTicketRefs failed, saving unlinked:", err);
            return messageData.content;
          })
        : messageData.content;

    const createdAt = await resolveQueuedMessageCreatedAt(
      messageData.role,
      messageData.precedesMessageId,
      (id) => prisma.chatMessage.findFirst({ where: { id, sessionId, role: "assistant" }, select: { createdAt: true } })
    );

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
          createdAt,
          role: messageData.role,
          isDelivered: true,
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
