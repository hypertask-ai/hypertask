import { NextResponse } from "next/server";
import type { SessionUser } from "@/lib/auth/getSessionUser";
import { BoardAccessError, mutateBoardAccessNotification } from "@/lib/agents/boardAccessRequests/service";
import { broadcastInboxChange } from "@/lib/realtime/server";

export async function boardAccessNotificationWrite(session: SessionUser, id: unknown, taskId: unknown, change: { seen?: boolean; status?: "Normal" | "Archive" }) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
  try {
    const row = await mutateBoardAccessNotification(session, Number(id), taskId, change);
    if (!row) return null;
    await broadcastInboxChange(session.userId, { originUserId: session.userId }).catch(() => {});
    return NextResponse.json(row);
  } catch (error) {
    if (!(error instanceof BoardAccessError)) throw error;
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
}
