import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import { featureFlagsForUser } from "@/lib/flags";
import getBoardTasks from "@/utils/controllers/projects/getBoardTasks";
import getFirst from "@/utils/controllers/projects/getFirst";
import notificationGetCount from "@/utils/controllers/notifications/getCount";
import { BOARD_DISPLAY_COOKIE, parseBoardDisplay } from "./boardDisplay";
import { BOARD_DOCUMENT_ROUTE_HEADER, BOARD_DOCUMENT_TIMEOUT_MS, BOARD_FIRST_SCREEN_FLAG,
  projectBoardDocumentPayload, projectBoardDocumentUser, type BoardDocument } from "./boardDocument";
import { hydrateBoardWithPayload, type BoardTasksPayload } from "./boardPayload";
import { pinProjectViewToUrl, projectBoardFirstScreen } from "./boardView";

export async function readBoardDocument(route: string, displayCookie: string | undefined, deadline = Infinity): Promise<BoardDocument | null> {
  const url = new URL(route, "https://app.hypertask.ai");
  if (url.pathname !== "/project") return null;
  const user = await getServerCookieUser();
  if (!user || performance.now() > deadline) return null;
  const display = parseBoardDisplay(displayCookie, user.id);
  if (!display) return null;
  const flags = await featureFlagsForUser(user.id);
  if (flags[BOARD_FIRST_SCREEN_FLAG] !== true || performance.now() > deadline) return null;
  const cookieStore = await cookies();
  let projectId = Number(url.searchParams.get("id"));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    projectId = Number(cookieStore.get("previousBoard")?.value.split("|&|")[0].replace("project-", ""));
  }
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    const first = await getFirst(user.id);
    projectId = Number((first.json as { id?: number })?.id);
  }
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || performance.now() > deadline) return null;
  const [response, counts] = await Promise.all([
    getBoardTasks(projectId, user.id, user.id), notificationGetCount(user.id),
  ]);
  if (performance.now() > deadline || response.status !== 200 || !("tasks" in response.json) ||
      counts.status !== 200 || !("all" in counts.json) || !("unseen" in counts.json)) return null;
  const payload = projectBoardDocumentPayload(response.json as unknown as BoardTasksPayload);
  if (payload.project?.id !== projectId) return null;
  const viewSlug = url.searchParams.get("view");
  const project = pinProjectViewToUrl(hydrateBoardWithPayload(payload.project, payload), viewSlug);
  const selection = projectBoardFirstScreen(project, url.searchParams.get("surface"), display.boardLayout, viewSlug);
  const now = new Date().toISOString();
  const generation = randomUUID();
  const data = {
    user: projectBoardDocumentUser(user), projectId, payload,
    projects: { accountId: user.id, dataOrigin: "network", projectsCompleteness: "active-board-only",
      networkRequestScopeKey: `${user.id}:${projectId}`, networkRequestGeneration: 0, networkRequestId: generation, serverDocumentGeneration: generation,
      activeBoardPayloadLoaded: true, updatedProjects: [project], notificationsCount: counts.json },
  } as unknown as BoardDocument["data"];
  return {
    schemaVersion: 1, buildVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? "board-document-v1",
    scope: { accountId: user.id, route: "/project", generation },
    authorization: { outcome: "authorized", checkedAt: now }, fetchedAt: now, now, display,
    flags: { accountId: user.id, evaluatedAt: now, values: flags }, completeness: "complete", projectsCompleteness: "active-board-only",
    selection: { view: selection.slug ?? null, surface: selection.surface, split: null, focus: null },
    data,
  };
}

// React cache dedupes the root and page in this request only. The timeout
// includes identity, flag and controller reads; a late result is never adopted.
export const getServerBoardDocument = cache(async (): Promise<BoardDocument | null> => {
  const requestHeaders = await headers();
  const route = requestHeaders.get(BOARD_DOCUMENT_ROUTE_HEADER);
  // Existing root providers survive client navigation. Only a new document
  // may initialize them; an RSC prefetch must not replay a seed into live state.
  if (!route || requestHeaders.get("rsc") === "1") return null;
  const cookieStore = await cookies();
  if (!cookieStore.get(BOARD_DISPLAY_COOKIE)?.value) return null;
  const deadline = performance.now() + BOARD_DOCUMENT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([
      readBoardDocument(route, cookieStore.get(BOARD_DISPLAY_COOKIE)?.value, deadline).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), BOARD_DOCUMENT_TIMEOUT_MS); }),
    ]);
    return performance.now() <= deadline ? snapshot : null;
  } finally {
    clearTimeout(timer);
  }
});
