import { createHash } from "node:crypto";

import { taskBaseUri } from "@/utils";
import { GOOGLE_CALENDAR_API_BASE, GOOGLE_CALENDAR_REVOKE_URL } from "./paths";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_EVENTS_PER_READ = 10_000;
const GOOGLE_CALENDAR_NAME = "Hypertask";
// Timed tasks occupy one hour because tasks have one due instant, not an end time.
const TIMED_EVENT_DURATION_MS = 60 * 60 * 1000;

export type GoogleCalendarTask = {
  dueDate: Date;
  id: number;
  projectId: number;
  section: string;
  ticketNumber: string | null;
  title: string;
  uniqueIndex: number;
};

type GoogleEvent = {
  extendedProperties?: { private?: Record<string, string> };
  id?: string;
  status?: string;
};

export class GoogleCalendarApiError extends Error {
  constructor(
    public readonly status: number,
    message = "Google Calendar request failed",
  ) {
    super(`${message} (${status})`);
  }
}

async function throwGoogleCalendarApiError(
  response: Response,
  message?: string,
): Promise<never> {
  await response.body?.cancel();
  throw new GoogleCalendarApiError(response.status, message);
}

async function boundedJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new Error("Google Calendar returned an invalid response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Google Calendar returned an invalid response");
    }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Google Calendar returned an invalid response");
  }
}

async function googleRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return fetcher(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function createGoogleCalendar(
  accessToken: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await googleRequest(
    "/calendars",
    accessToken,
    { method: "POST", body: JSON.stringify({ summary: GOOGLE_CALENDAR_NAME }) },
    fetcher,
  );
  if (!response.ok) return throwGoogleCalendarApiError(response);
  const data = await boundedJson(response);
  const id = typeof data.id === "string" ? data.id.trim() : "";
  const summary =
    typeof data.summary === "string"
      ? data.summary.trim()
      : GOOGLE_CALENDAR_NAME;
  if (!id || id.length > 2048)
    throw new Error("Google Calendar returned an invalid calendar");
  return { id, summary: summary || GOOGLE_CALENDAR_NAME };
}

export async function googleCalendarExists(
  calendarId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await googleRequest(
    `/calendars/${encodeURIComponent(calendarId)}`,
    accessToken,
    {},
    fetcher,
  );
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel();
    return false;
  }
  if (!response.ok) return throwGoogleCalendarApiError(response);
  await response.body?.cancel();
  return true;
}

export async function deleteGoogleCalendar(
  calendarId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await googleRequest(
    `/calendars/${encodeURIComponent(calendarId)}`,
    accessToken,
    { method: "DELETE" },
    fetcher,
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    return throwGoogleCalendarApiError(response);
  }
  await response.body?.cancel();
}

export async function throwAfterGoogleCalendarCleanup(
  calendarId: string,
  accessToken: string,
  originalError: unknown,
  fetcher: typeof fetch = fetch,
): Promise<never> {
  try {
    await deleteGoogleCalendar(calendarId, accessToken, fetcher);
  } catch (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      `Google Calendar setup failed and calendar ${calendarId} could not be removed`,
    );
  }
  throw originalError;
}

export async function revokeGoogleToken(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(GOOGLE_CALENDAR_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 400) {
    return throwGoogleCalendarApiError(
      response,
      "Google token revocation failed",
    );
  }
  await response.body?.cancel();
}

export function googleCalendarEventId(taskId: number): string {
  return `htask${taskId.toString(32)}`;
}

export function googleCalendarTaskFingerprint(
  task: GoogleCalendarTask,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        task.dueDate.toISOString(),
        task.projectId,
        task.section,
        task.ticketNumber,
        task.title,
        task.uniqueIndex,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

export function googleCalendarEventBody(task: GoogleCalendarTask) {
  const url = `${taskBaseUri}project-${task.projectId}/${task.uniqueIndex}`;
  const summary = [task.ticketNumber, task.title]
    .filter(Boolean)
    .join(" ")
    .trim();
  const fingerprint = googleCalendarTaskFingerprint(task);
  const start = { dateTime: task.dueDate.toISOString() };
  const end = {
    dateTime: new Date(
      task.dueDate.getTime() + TIMED_EVENT_DURATION_MS,
    ).toISOString(),
  };
  return {
    description: `${task.section}\n${url}`,
    end,
    extendedProperties: { private: { fingerprint, hypertask: "1" } },
    id: googleCalendarEventId(task.id),
    source: { title: "Open in Hypertask", url },
    start,
    summary,
  };
}

export async function listGoogleCalendarEvents(
  calendarId: string,
  accessToken: string,
  managedOnly: boolean,
  fetcher: typeof fetch = fetch,
  assertContinue: () => void = () => {},
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      maxResults: "250",
      showDeleted: "false",
      singleEvents: "true",
    });
    if (managedOnly) query.set("privateExtendedProperty", "hypertask=1");
    if (pageToken) query.set("pageToken", pageToken);
    const response = await googleRequest(
      `/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
      accessToken,
      {},
      fetcher,
    );
    if (!response.ok) return throwGoogleCalendarApiError(response);
    const data = await boundedJson(response);
    assertContinue();
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        events.push(item as GoogleEvent);
      }
    }
    // ponytail: keep a single reconciliation below 10,000 events. If real
    // calendars reach this ceiling, consume each page through a callback.
    if (events.length > MAX_EVENTS_PER_READ) {
      throw new Error("Google Calendar has too many events to update safely");
    }
    pageToken =
      typeof data.nextPageToken === "string" && data.nextPageToken
        ? data.nextPageToken
        : undefined;
  } while (pageToken);
  return events;
}

export async function insertGoogleCalendarEvent(
  calendarId: string,
  accessToken: string,
  body: ReturnType<typeof googleCalendarEventBody>,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  return writeGoogleCalendarEvent(
    "insert",
    calendarId,
    accessToken,
    body,
    fetcher,
    true,
  );
}

async function writeGoogleCalendarEvent(
  mode: "insert" | "update",
  calendarId: string,
  accessToken: string,
  body: ReturnType<typeof googleCalendarEventBody>,
  fetcher: typeof fetch,
  allowFallback: boolean,
): Promise<void> {
  const path =
    mode === "insert"
      ? `/calendars/${encodeURIComponent(calendarId)}/events`
      : `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(body.id)}`;
  const response = await googleRequest(
    path,
    accessToken,
    { method: mode === "insert" ? "POST" : "PUT", body: JSON.stringify(body) },
    fetcher,
  );
  if (allowFallback && mode === "insert" && response.status === 409) {
    await response.body?.cancel();
    return writeGoogleCalendarEvent(
      "update",
      calendarId,
      accessToken,
      body,
      fetcher,
      false,
    );
  }
  if (
    allowFallback &&
    mode === "update" &&
    (response.status === 404 || response.status === 410)
  ) {
    await response.body?.cancel();
    return writeGoogleCalendarEvent(
      "insert",
      calendarId,
      accessToken,
      body,
      fetcher,
      false,
    );
  }
  if (!response.ok) return throwGoogleCalendarApiError(response);
  await response.body?.cancel();
}

export async function updateGoogleCalendarEvent(
  calendarId: string,
  accessToken: string,
  body: ReturnType<typeof googleCalendarEventBody>,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  return writeGoogleCalendarEvent(
    "update",
    calendarId,
    accessToken,
    body,
    fetcher,
    true,
  );
}

export async function deleteGoogleCalendarEvent(
  calendarId: string,
  accessToken: string,
  eventId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await googleRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    { method: "DELETE" },
    fetcher,
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    return throwGoogleCalendarApiError(response);
  }
  await response.body?.cancel();
}
