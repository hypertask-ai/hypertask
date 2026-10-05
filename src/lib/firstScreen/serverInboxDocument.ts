import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import { featureFlagsForUser } from "@/lib/flags";
import notificationGetAll from "@/utils/controllers/notifications/getAll";
import { getInboxAccessibleProjectIds } from "@/utils/controllers/notifications/getAccessibleProjectIds";
import getUserDrafts from "@/utils/controllers/drafts/getUserDrafts";
import { fetchUserPreferenceController } from "@/utils/controllers/users/fetch_preferences";
import type { INotification } from "@/models/model";
import type { IUserDraft } from "@/hooks/General/useGetUserDrafts";
import { BOARD_DISPLAY_COOKIE, parseBoardDisplay } from "./boardDisplay";
import { BOARD_FIRST_SCREEN_FLAG, projectBoardDocumentUser } from "./boardDocument";
import { activeInboxDrafts, INBOX_DOCUMENT_ROUTE_HEADER, INBOX_DOCUMENT_TIMEOUT_MS, type InboxDocument } from "./inboxDocument";
import { projectInboxFirstScreen } from "./inbox";
import { selectInboxZeroImage } from "./inboxZero";

export async function readInboxDocument(route: string, displayCookie: string | undefined, deadline = Infinity): Promise<InboxDocument | null> {
  const url = new URL(route, "https://app.hypertask.ai");
  if (url.pathname !== "/inbox" || url.searchParams.has("tutorial")) return null;
  const user = await getServerCookieUser();
  if (!user || performance.now() > deadline) return null;
  const display = parseBoardDisplay(displayCookie, user.id);
  if (!display?.inbox || typeof display.inbox.nudgeDismissed !== "boolean" || typeof display.inbox.pushEnabled !== "boolean" ||
      !["default", "granted", "denied"].includes(display.inbox.pushPermission)) return null;
  const flags = await featureFlagsForUser(user.id);
  if (flags[BOARD_FIRST_SCREEN_FLAG] !== true || performance.now() > deadline) return null;
  const [response, projectIds, drafts, preferences] = await Promise.all([
    notificationGetAll(String(user.id)), getInboxAccessibleProjectIds(user.id),
    getUserDrafts(user.id), fetchUserPreferenceController(user.id),
  ]);
  if (performance.now() > deadline || response.status !== 200 || !("notifications" in response.json) ||
      preferences.status !== 200) return null;
  const raw = JSON.parse(JSON.stringify(response.json)) as { notifications: INotification[]; splitsNoImportant: InboxDocument["data"]["payload"]["splitsNoImportant"]; showImportantSplit: boolean };
  // Projectless agent rows need an agent-access proof, not a board-access proof.
  // Until the controller supplies that scope, keep the complete legacy path.
  if (raw.notifications.some(row => row.userId === user.id && row.type === "AgentMessage" && !row.task && !row.projectId)) return null;
  const accessible = new Set(projectIds);
  // Use the existing signed inbox controller and its fresh project-content
  // access proof. Never serialize its stale compact tabs or another account.
  const rows = raw.notifications.filter(row => row.userId === user.id &&
    ((row.type === "Invited" && !row.task && !row.projectId) ||
      (accessible.has(row.projectId) && (!row.task || accessible.has(row.task.projectId)))));
  for (const row of rows) {
    if (row.fromUser) delete row.fromUser.email;
    if (row.user) delete row.user.email;
    const taskUser = (row.task as unknown as { user?: { email?: string } })?.user;
    if (taskUser) delete taskUser.email;
  }
  const safeDrafts = JSON.parse(JSON.stringify(drafts)) as IUserDraft[];
  const authorizedDrafts = safeDrafts.filter(draft => draft.userId === user.id && accessible.has(draft.task.projectId));
  const now = new Date().toISOString();
  const projected = projectInboxFirstScreen({ notifications: rows, splitsNoImportant: raw.splitsNoImportant,
    showImportantSplit: raw.showImportantSplit, now, locale: display.locale,
    split: url.searchParams.get("split") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined });
  const selectedSplit = url.searchParams.get("showAll") === "true" ? projected.structuredData.data.length - 1 : projected.selectedSplit ?? 0;
  const payload = { notifications: projected.notifications, structuredData: projected.structuredData,
    splitsNoImportant: raw.splitsNoImportant, showImportantSplit: raw.showImportantSplit, accountId: user.id, dataOrigin: "network" as const };
  const isInboxZero = payload.structuredData.data[selectedSplit].length === 0 && activeInboxDrafts(authorizedDrafts, payload, selectedSplit).length === 0;
  const generation = randomUUID();
  const visibleRows = rows.filter(row => !row.waitingOnSynthetic);
  return {
    schemaVersion: 1, buildVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? "inbox-document-v1",
    scope: { accountId: user.id, route: "/inbox", generation },
    authorization: { outcome: "authorized", checkedAt: now }, fetchedAt: now, now, display,
    flags: { accountId: user.id, evaluatedAt: now, values: flags }, completeness: "complete", projectsCompleteness: "active-board-only",
    selection: { view: null, surface: null, split: selectedSplit, focus: null },
    data: { user: projectBoardDocumentUser(user), payload, drafts: authorizedDrafts, displayAvatar: preferences.res.displayAvatar,
      counts: { all: visibleRows.length, unseen: visibleRows.some(row => !row.seen) ? 1 : 0 },
      isInboxZero, zeroImage: isInboxZero ? selectInboxZeroImage(display.isMobile) : null,
      nudge: { visible: !display.inbox.nudgeDismissed && !user.UserSetting?.notification &&
        !(display.inbox.pushPermission === "granted" && display.inbox.pushEnabled), pushDenied: display.inbox.pushPermission === "denied" } },
  } as unknown as InboxDocument;
}

// Request-local, shared by the layout and page. A late or partial response is
// discarded, including on Flight navigation where the live root already exists.
export const getServerInboxDocument = cache(async (): Promise<InboxDocument | null> => {
  const requestHeaders = await headers();
  const route = requestHeaders.get(INBOX_DOCUMENT_ROUTE_HEADER);
  if (!route || requestHeaders.get("rsc") === "1") return null;
  const cookieStore = await cookies();
  const displayCookie = cookieStore.get(BOARD_DISPLAY_COOKIE)?.value;
  if (!displayCookie) return null;
  const deadline = performance.now() + INBOX_DOCUMENT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([
      readInboxDocument(route, displayCookie, deadline).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), INBOX_DOCUMENT_TIMEOUT_MS); }),
    ]);
    return performance.now() <= deadline ? snapshot : null;
  } finally {
    clearTimeout(timer);
  }
});
