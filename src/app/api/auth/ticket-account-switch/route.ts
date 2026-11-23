import { NextResponse } from "next/server";

import { ticketDetailFields } from "@/lib/auth/ticketDetailLocator";
import {
  resolveTicketAccountSwitch,
  type DeviceAccount,
} from "@/lib/auth/ticketAccountSwitch";
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

export async function POST(request: Request) {
  const user = await getServerCookieUser();
  if (!user) return jsonAction("stay");
  const enabled = await isFeatureEnabled(HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG, user.id);
  if (!enabled) return jsonAction("stay");

  let locator: ReturnType<typeof ticketDetailFields> = null;
  try {
    const body: unknown = await request.json();
    const record = body && typeof body === "object" ? body as { projectSlug?: unknown; uniqueIndex?: unknown } : {};
    locator = ticketDetailFields(record.projectSlug, record.uniqueIndex);
  } catch {
    locator = null;
  }
  if (!locator) return jsonAction("stay");

  let accounts: DeviceAccount[] = [];
  try {
    accounts = await deviceAccounts(request);
  } catch {
    return jsonAction("stay");
  }

  const decision = await resolveTicketAccountSwitch({
    enabled: true,
    currentUserId: user.id,
    projectSlug: locator.projectSlug,
    uniqueIndex: locator.uniqueIndex,
    accounts,
  });
  if (decision.action !== "switch") return jsonAction(decision.action);

  try {
    const switched = await auth.api.setActiveSession({
      body: { sessionToken: decision.sessionToken },
      headers: request.headers,
      asResponse: true,
    });
    if (!switched.ok) return jsonAction("stay");
    const cookies = typeof switched.headers.getSetCookie === "function"
      ? switched.headers.getSetCookie()
      : [];
    if (cookies.length === 0) return jsonAction("stay");
    const response = jsonAction("switch");
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
    return response;
  } catch {
    return jsonAction("stay");
  }
}
