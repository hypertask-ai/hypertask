import { NextResponse } from "next/server";

import {
  TICKET_ACCOUNT_SWITCH_CHOOSE,
  TICKET_ACCOUNT_SWITCHED,
  ticketDetailFields,
  type TicketDetailLocator,
} from "@/lib/auth/ticketDetailLocator";
import {
  resolveTicketAccountSwitch,
  siblingSessions,
  type DeviceAccount,
} from "@/lib/auth/ticketAccountSwitch";
import {
  claimTicketAccountSwitchAttempt,
  getTicketAccountSwitchClientIp,
} from "@/lib/auth/ticketAccountSwitchRateLimit";
import { auth } from "@/lib/auth/betterAuth";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import { HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG } from "@/lib/flags/definitions/htpr-9621-auto-switch-account";
import { isFeatureEnabled } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonAction(action: "stay" | "choose" | "switch") {
  return NextResponse.json(
    { action },
    { headers: { "cache-control": "private, no-store" } },
  );
}

function ticketPath(locator: TicketDetailLocator | null) {
  return locator ? `/detail/${locator.projectSlug}/${locator.uniqueIndex}` : "/inbox";
}

function pageReturn(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

async function deviceAccounts(request: Request): Promise<DeviceAccount[]> {
  if (process.env.BETTER_AUTH_ENABLED !== "1") return [];
  const sessions = await auth.api.listDeviceSessions({ headers: request.headers });
  if (!Array.isArray(sessions)) return [];
  const accounts: DeviceAccount[] = [];
  for (const row of sessions) {
    const userId = Number(row?.user?.id);
    const sessionToken = row?.session?.token;
    if (!Number.isInteger(userId) || userId <= 0) continue;
    if (typeof sessionToken !== "string" || sessionToken.length === 0) continue;
    accounts.push({ userId, sessionToken });
  }
  return accounts;
}

async function readRequest(request: Request): Promise<{ locator: TicketDetailLocator | null; page: boolean }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const body: unknown = await request.json();
      const record = body && typeof body === "object" ? body as { projectSlug?: unknown; uniqueIndex?: unknown } : {};
      return { locator: ticketDetailFields(record.projectSlug, record.uniqueIndex), page: false };
    } catch {
      return { locator: null, page: false };
    }
  }
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      return { locator: ticketDetailFields(form.get("projectSlug"), form.get("uniqueIndex")), page: true };
    } catch {
      return { locator: null, page: true };
    }
  }
  return { locator: null, page: false };
}

function finish(request: Request, page: boolean, action: "stay" | "choose" | "switch", locator: TicketDetailLocator | null, setCookies: string[] = []) {
  const response = page ? pageReturn(request, ticketPath(locator)) : jsonAction(action);
  if (page && action === "choose") {
    response.headers.append("set-cookie", `${TICKET_ACCOUNT_SWITCH_CHOOSE}=choose; Path=/; Max-Age=30; SameSite=Lax`);
  }
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  if (action === "switch") {
    response.headers.append("set-cookie", `${TICKET_ACCOUNT_SWITCHED}=1; Path=/; Max-Age=30; SameSite=Lax`);
  }
  return response;
}

export async function POST(request: Request) {
  const { locator, page } = await readRequest(request);
  const user = await getServerCookieUser();
  if (!user) return finish(request, page, "stay", locator);
  const enabled = await isFeatureEnabled(HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG, user.id);
  if (!enabled || !locator) return finish(request, page, "stay", locator);

  const clientIp = getTicketAccountSwitchClientIp(request);
  if (!clientIp) return finish(request, page, "stay", locator);
  let attempt;
  try {
    attempt = await claimTicketAccountSwitchAttempt(user.id, clientIp);
  } catch {
    return finish(request, page, "stay", locator);
  }
  if (!attempt.allowed) return finish(request, page, "stay", locator);

  let accounts: DeviceAccount[] = [];
  try {
    accounts = await deviceAccounts(request);
  } catch {
    return finish(request, page, "stay", locator);
  }
  let siblings: DeviceAccount[] = [];
  try {
    siblings = await siblingSessions(accounts.filter((account) => account.userId !== user.id));
  } catch {
    return finish(request, page, "stay", locator);
  }
  if (siblings.length === 0) return finish(request, page, "stay", locator);

  let decision: Awaited<ReturnType<typeof resolveTicketAccountSwitch>>;
  try {
    decision = await resolveTicketAccountSwitch({
      enabled,
      currentUserId: user.id,
      projectSlug: locator.projectSlug,
      uniqueIndex: locator.uniqueIndex,
      accounts: siblings,
    });
  } catch {
    return finish(request, page, "stay", locator);
  }
  if (decision.action !== "switch") return finish(request, page, decision.action, locator);

  try {
    const switched = await auth.api.setActiveSession({
      body: { sessionToken: decision.sessionToken },
      headers: request.headers,
      asResponse: true,
    });
    if (!switched.ok) return finish(request, page, "stay", locator);
    const cookies = typeof switched.headers.getSetCookie === "function"
      ? switched.headers.getSetCookie()
      : [];
    if (cookies.length === 0) return finish(request, page, "stay", locator);
    return finish(request, page, "switch", locator, cookies);
  } catch {
    return finish(request, page, "stay", locator);
  }
}
