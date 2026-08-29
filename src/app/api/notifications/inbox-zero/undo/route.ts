import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import {
  broadcastInboxChange,
  socketIdFromHeader,
} from "@/lib/realtime/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: { notificationIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !Array.isArray(body.notificationIds)) {
    return NextResponse.json(
      { message: "notificationIds must be an array" },
      { status: 400 }
    );
  }

  const notificationIds = Array.from(
    new Set(
      body.notificationIds.filter(
        (id): id is number => Number.isInteger(id) && Number(id) > 0
      )
    )
  );
  if (notificationIds.length === 0) {
    return NextResponse.json({ restoredCount: 0, notificationIds: [] });
  }

  const restored = await prisma.$transaction(async (transaction) => {
    const restorable = await transaction.notification.findMany({
      where: {
        id: { in: notificationIds },
        userId: session.userId,
        status: "Archive",
      },
      select: { id: true },
    });
    const restorableIds = restorable.map(({ id }) => id);
    if (restorableIds.length === 0) return [];

    await transaction.notification.updateMany({
      where: {
        id: { in: restorableIds },
        userId: session.userId,
        status: "Archive",
      },
      data: {
        status: "Normal",
        archivedAt: null,
      },
    });

    return restorable;
  });

  if (restored.length > 0) {
    const excludeSocketId = socketIdFromHeader(request.headers.get("x-socket-id"));
    void broadcastInboxChange(
      session.userId,
      { originUserId: session.userId },
      excludeSocketId
    );
  }

  return NextResponse.json({
    restoredCount: restored.length,
    notificationIds: restored.map(({ id }) => id),
  });
}
