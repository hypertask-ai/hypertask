import { NextResponse } from "next/server";

import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8046_ARCHIVE_SAFE_FLAG } from "@/lib/flags/definitions/htpr-8046-archive-safe";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_8047_INBOX_ZERO_AGENT_ACTIONS_FLAG } from "@/lib/flags/definitions/htpr-8047-inbox-zero-agent-actions";
import {
  evaluateInboxZero,
  loadActiveInboxZeroNotifications, // trufflehog:ignore
  loadInboxZeroDoneTitlesByProject,
  parseInboxZeroRules,
} from "@/utils/controllers/notifications/inboxZero";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const rules = parseInboxZeroRules(body);
  if (!rules) {
    return NextResponse.json({ message: "Invalid Inbox Zero rules" }, { status: 400 });
  }
  if (rules.safeUpdates && !(await isFeatureEnabled(HTPR_8046_ARCHIVE_SAFE_FLAG, session.userId))) {
    return NextResponse.json({ message: "Archive safe is unavailable" }, { status: 404 });
  }

  const notifications = await loadActiveInboxZeroNotifications(session.userId, undefined, undefined, Boolean(rules.safeUpdates));
  const doneTitlesByProject = await loadInboxZeroDoneTitlesByProject(notifications);
  const { notificationIds: _notificationIds, ...preview } = evaluateInboxZero(
    notifications,
    session.userId,
    rules,
    new Date(),
    doneTitlesByProject,
    await isFeatureEnabled(HTPR_8047_INBOX_ZERO_AGENT_ACTIONS_FLAG, session.userId)
  );

  return NextResponse.json(preview);
}
