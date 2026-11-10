import { NextResponse } from "next/server";

import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8046_ARCHIVE_SAFE_FLAG } from "@/lib/flags/definitions/htpr-8046-archive-safe";
import { HTPR_9045_JEV_INBOX_TRIAGE_FLAG } from "@/lib/flags/definitions/htpr-9045-jev-inbox-triage";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_8047_INBOX_ZERO_AGENT_ACTIONS_FLAG } from "@/lib/flags/definitions/htpr-8047-inbox-zero-agent-actions";
import { JEV_TRIAGE_MAX_ITEMS } from "@/lib/ai/jevInboxTriage";
import { jevInboxTriage, loadInboxTriageTeamId } from "@/lib/ai/jevInboxTriageRun";
import {
  evaluateInboxZero,
  jevTriageCandidates,
  loadActiveInboxZeroNotifications, // trufflehog:ignore
  loadInboxZeroDoneTitlesByProject,
  parseInboxZeroRules,
  withoutJevTriage,
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

  const parsedRules = parseInboxZeroRules(body);
  if (!parsedRules) {
    return NextResponse.json({ message: "Invalid Inbox Zero rules" }, { status: 400 });
  }
  if (parsedRules.safeUpdates && !(await isFeatureEnabled(HTPR_8046_ARCHIVE_SAFE_FLAG, session.userId))) {
    return NextResponse.json({ message: "Archive safe is unavailable" }, { status: 404 });
  }

  const jevNoise =
    parsedRules.categories.jevNoise === true &&
    (await isFeatureEnabled(HTPR_9045_JEV_INBOX_TRIAGE_FLAG, session.userId));
  const rules = jevNoise ? parsedRules : withoutJevTriage(parsedRules);

  const notifications = await loadActiveInboxZeroNotifications(
    session.userId,
    undefined,
    undefined,
    Boolean(rules.safeUpdates),
    jevNoise
  );

  let evaluationRules = rules;
  if (jevNoise) {
    const candidates = jevTriageCandidates(notifications, session.userId, rules.keep);
    const { noiseIds } = await jevInboxTriage({
      items: candidates.map((candidate) => candidate.item),
      teamId: await loadInboxTriageTeamId(session.userId),
      userId: session.userId,
    });
    const noise = new Set(noiseIds);
    evaluationRules = {
      ...rules,
      jevNotificationIds: candidates
        .filter((candidate) => noise.has(candidate.key))
        .flatMap((candidate) => candidate.notificationIds)
        .slice(0, JEV_TRIAGE_MAX_ITEMS),
    };
  }

  const doneTitlesByProject = await loadInboxZeroDoneTitlesByProject(notifications);
  const { notificationIds: _notificationIds, ...preview } = evaluateInboxZero(
    notifications,
    session.userId,
    evaluationRules,
    new Date(),
    doneTitlesByProject,
    await isFeatureEnabled(HTPR_8047_INBOX_ZERO_AGENT_ACTIONS_FLAG, session.userId)
  );

  return NextResponse.json(preview);
}
