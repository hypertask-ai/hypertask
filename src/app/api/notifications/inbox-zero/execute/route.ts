import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import {
  broadcastInboxChange,
  socketIdFromHeader,
} from "@/lib/realtime/server";
import {
  evaluateInboxZero,
  loadActiveInboxZeroNotifications,
  loadInboxZeroDoneTitlesByProject,
  parseInboxZeroRules,
} from "@/utils/controllers/notifications/inboxZero";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const loadPreview = async (
  userId: number,
  rules: NonNullable<ReturnType<typeof parseInboxZeroRules>>,
  db: Pick<Prisma.TransactionClient, "notification" | "section">,
  now: Date
) => {
  const notifications = await loadActiveInboxZeroNotifications(userId, db);
  const doneTitlesByProject = await loadInboxZeroDoneTitlesByProject(
    notifications,
    db
  );
  return evaluateInboxZero(
    notifications,
    userId,
    rules,
    now,
    doneTitlesByProject
  );
};

const publicPreview = (
  preview: Awaited<ReturnType<typeof loadPreview>>
) => {
  const { notificationIds: _notificationIds, ...result } = preview;
  return result;
};

const previewChanged = async (
  userId: number,
  rules: NonNullable<ReturnType<typeof parseInboxZeroRules>>
) => {
  const preview = await loadPreview(userId, rules, prisma, new Date());
  return NextResponse.json(
    {
      message: "Inbox changed. Review the updated preview and confirm again.",
      preview: publicPreview(preview),
    },
    { status: 409 }
  );
};

export async function POST(request: Request) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const input = body as { rules?: unknown; previewVersion?: unknown } | null;
  const rules = parseInboxZeroRules(input?.rules);
  if (!rules) {
    return NextResponse.json({ message: "Invalid Inbox Zero rules" }, { status: 400 });
  }
  const requestedPreviewVersion =
    typeof input?.previewVersion === "string" ? input.previewVersion : null;
  if (!requestedPreviewVersion) {
    return previewChanged(session.userId, rules);
  }

  const archivedAt = new Date();
  let result:
    | { kind: "changed"; preview: ReturnType<typeof publicPreview> }
    | {
        kind: "archived";
        notificationIds: number[];
        archivedItemCount: number;
      };
  try {
    result = await prisma.$transaction(
      async (transaction) => {
        const preview = await loadPreview(
          session.userId,
          rules,
          transaction,
          archivedAt
        );
        if (preview.previewVersion !== requestedPreviewVersion) {
          return { kind: "changed" as const, preview: publicPreview(preview) };
        }

        if (preview.notificationIds.length === 0) {
          return {
            kind: "archived" as const,
            notificationIds: [],
            archivedItemCount: 0,
          };
        }

        await transaction.notification.updateMany({
          where: {
            id: { in: preview.notificationIds },
            userId: session.userId,
            agentId: null,
            status: "Normal",
            archivedAt: null,
          },
          data: {
            status: "Archive",
            archivedAt,
          },
        });

        const archived = await transaction.notification.findMany({
          where: {
            id: { in: preview.notificationIds },
            userId: session.userId,
            agentId: null,
            status: "Archive",
            archivedAt,
          },
          select: { id: true },
        });
        return {
          kind: "archived" as const,
          notificationIds: archived.map(({ id }) => id),
          archivedItemCount: preview.totalToArchive,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return previewChanged(session.userId, rules);
    }
    throw error;
  }

  if (result.kind === "changed") {
    return NextResponse.json(
      {
        message: "Inbox changed. Review the updated preview and confirm again.",
        preview: result.preview,
      },
      { status: 409 }
    );
  }

  const { notificationIds } = result;

  if (notificationIds.length > 0) {
    const excludeSocketId = socketIdFromHeader(request.headers.get("x-socket-id"));
    void broadcastInboxChange(
      session.userId,
      { originUserId: session.userId },
      excludeSocketId
    );
  }

  return NextResponse.json({
    archivedCount: notificationIds.length,
    archivedItemCount: result.archivedItemCount,
    notificationIds,
  });
}
