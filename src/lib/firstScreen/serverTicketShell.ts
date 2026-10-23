import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import { featureFlagsForUser, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7627_TICKET_FIRST_SCREEN_FLAG } from "@/lib/flags/keys";
import { BOARD_DISPLAY_COOKIE, parseBoardDisplay } from "./boardDisplay";
import { BOARD_DOCUMENT_TIMEOUT_MS, BOARD_FIRST_SCREEN_FLAG } from "./boardDocument";
import { TICKET_DOCUMENT_ROUTE_HEADER, type TicketShellSeed } from "./ticketShell";

export async function readTicketShell(route: string, displayCookie: string | undefined, deadline = Infinity): Promise<TicketShellSeed | null> {
  const url = new URL(route, "https://app.hypertask.ai");
  if (!/^\/detail\/project-\d+\/(?:\d+|[A-Za-z0-9][A-Za-z0-9_-]*-\d+)(?:\/|$)/.test(url.pathname)) return null;
  const user = await getServerCookieUser();
  if (!user || performance.now() > deadline) return null;
  const display = parseBoardDisplay(displayCookie, user.id, { desktopChat: true });
  if (!display) return null;
  const [ticketSeedEnabled, flags] = await Promise.all([isFeatureEnabled(HTPR_7627_TICKET_FIRST_SCREEN_FLAG, user.id), featureFlagsForUser(user.id)]);
  if (!ticketSeedEnabled || flags[BOARD_FIRST_SCREEN_FLAG] !== true || performance.now() > deadline) return null;
  return { accountId: user.id, flags: { accountId: user.id, evaluatedAt: new Date().toISOString(), values: flags }, display };
}

export const getServerTicketShell = cache(async (): Promise<TicketShellSeed | null> => {
  const requestHeaders = await headers();
  const route = requestHeaders.get(TICKET_DOCUMENT_ROUTE_HEADER);
  if (!route || requestHeaders.get("rsc") === "1") return null;
  const cookieStore = await cookies();
  const displayCookie = cookieStore.get(BOARD_DISPLAY_COOKIE)?.value;
  if (!displayCookie) return null;
  const deadline = performance.now() + BOARD_DOCUMENT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const seed = await Promise.race([
      readTicketShell(route, displayCookie, deadline).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), BOARD_DOCUMENT_TIMEOUT_MS); }),
    ]);
    return performance.now() <= deadline ? seed : null;
  } finally {
    clearTimeout(timer);
  }
});
