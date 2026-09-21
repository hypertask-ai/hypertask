import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { NextRequest } from "next/server";

import {
  getGoogleCalendarPrincipal,
  noStore,
  trustedMutationOrigin,
} from "@/app/api/google-calendar/_lib";
import {
  getGoogleCalendarConnection,
  googleCalendarEnabledFor,
  requestGoogleCalendarDisconnect,
  setGoogleCalendarSyncEnabled,
} from "@/lib/googleCalendar/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function principal(request: NextRequest) {
  const result = await getGoogleCalendarPrincipal(request);
  if (result.status === "unauthorized")
    return { response: noStore({ error: "Unauthorized" }, 401) };
  if (result.status === "error")
    return {
      response: noStore({ error: "Google Calendar is unavailable" }, 503),
    };
  return { userId: result.userId };
}

async function GETHandler(request: NextRequest) {
  const auth = await principal(request);
  if ("response" in auth) return auth.response;
  try {
    if (!(await googleCalendarEnabledFor(auth.userId))) {
      return noStore({ error: "Not found" }, 404);
    }
    return noStore({
      connection: await getGoogleCalendarConnection(auth.userId),
    });
  } catch (error) {
    htLogger.error("Google Calendar connection read failed", error);
    return noStore({ error: "Google Calendar is unavailable" }, 503);
  }
}

async function PATCHHandler(request: NextRequest) {
  const auth = await principal(request);
  if ("response" in auth) return auth.response;
  if (!trustedMutationOrigin(request))
    return noStore({ error: "Forbidden" }, 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "Invalid request" }, 400);
  }
  const syncEnabled =
    body && typeof body === "object" && "syncEnabled" in body
      ? (body as { syncEnabled?: unknown }).syncEnabled
      : undefined;
  if (typeof syncEnabled !== "boolean")
    return noStore({ error: "Invalid request" }, 400);
  try {
    if (syncEnabled && !(await googleCalendarEnabledFor(auth.userId))) {
      return noStore({ error: "Not found" }, 404);
    }
    const found = await setGoogleCalendarSyncEnabled(auth.userId, syncEnabled);
    return found
      ? noStore({ success: true })
      : noStore({ error: "Google Calendar is not connected" }, 404);
  } catch (error) {
    htLogger.error("Google Calendar setting update failed", error);
    return noStore({ error: "Could not update Google Calendar" }, 503);
  }
}

async function DELETEHandler(request: NextRequest) {
  const auth = await principal(request);
  if ("response" in auth) return auth.response;
  if (!trustedMutationOrigin(request))
    return noStore({ error: "Forbidden" }, 403);
  try {
    await requestGoogleCalendarDisconnect(auth.userId);
    return noStore({ success: true });
  } catch (error) {
    htLogger.error("Google Calendar disconnect failed", error);
    return noStore({ error: "Could not disconnect Google Calendar" }, 503);
  }
}

export const GET = withAuth(GETHandler, { authenticateInHandler: true });
export const PATCH = withAuth(PATCHHandler, { authenticateInHandler: true });
export const DELETE = withAuth(DELETEHandler, { authenticateInHandler: true });
