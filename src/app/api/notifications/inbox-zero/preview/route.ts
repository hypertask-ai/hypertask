import { getAuthSession, withAuth } from "#with-auth";
import { NextResponse } from "next/server";

import {
  evaluateInboxZero,
  loadActiveInboxZeroNotifications,
  loadInboxZeroDoneTitlesByProject,
  parseInboxZeroRules,
} from "@/utils/controllers/notifications/inboxZero";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function POSTHandler(request: Request) {
  const session = await getAuthSession(request.headers);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const rules = parseInboxZeroRules(body);
  if (!rules) {
    return NextResponse.json({ message: "Invalid Inbox Zero rules" }, { status: 400 });
  }

  const notifications = await loadActiveInboxZeroNotifications(session.userId);
  const doneTitlesByProject = await loadInboxZeroDoneTitlesByProject(notifications);
  const { notificationIds: _notificationIds, ...preview } = evaluateInboxZero(
    notifications,
    session.userId,
    rules,
    new Date(),
    doneTitlesByProject
  );

  return NextResponse.json(preview);
}

export const POST = withAuth(POSTHandler, { authenticateInHandler: true });
