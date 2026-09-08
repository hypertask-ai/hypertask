const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";
const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const client = jiti(path.join(root, "src/lib/googleCalendar/client.ts"));
const oauth = jiti(path.join(root, "src/lib/googleCalendar/oauth.ts"));

test("OAuth attempts bind user, state, nonce, PKCE, expiry, and return path", () => {
  const attempt = oauth.createGoogleCalendarOAuthAttempt(
    42,
    "/settings/calendar?connected=1",
    "client-secret",
    1000,
  );
  const verified = oauth.verifyGoogleCalendarOAuthAttempt(
    attempt.cookieValue,
    attempt.state,
    "client-secret",
    2000,
  );
  assert.equal(verified.userId, 42);
  assert.equal(verified.returnTo, "/settings/calendar?connected=1");
  assert.equal(verified.nonce, attempt.nonce);
  assert.match(attempt.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    oauth.verifyGoogleCalendarOAuthAttempt(
      attempt.cookieValue,
      attempt.state,
      "different-secret",
      2000,
    ),
    null,
  );
  const tamperedCookie = `${attempt.cookieValue.slice(0, -1)}${
    attempt.cookieValue.endsWith("a") ? "b" : "a"
  }`;
  assert.equal(
    oauth.verifyGoogleCalendarOAuthAttempt(
      tamperedCookie,
      attempt.state,
      "client-secret",
      2000,
    ),
    null,
  );
  assert.equal(
    oauth.verifyGoogleCalendarOAuthAttempt(
      attempt.cookieValue,
      `${attempt.state}x`,
      "client-secret",
      2000,
    ),
    null,
  );
  assert.equal(
    oauth.verifyGoogleCalendarOAuthAttempt(
      attempt.cookieValue,
      attempt.state,
      "client-secret",
      10 * 60 * 1000 + 1001,
    ),
    null,
  );
});

test("OAuth return paths reject external and internal API destinations", () => {
  for (const value of [
    "https://evil.example/task",
    "//evil.example/task",
    "/api/google-calendar/connection",
    "/%61pi/google-calendar/connection",
    "/_next/data/build/page.json",
    "/\\evil.example/task",
  ]) {
    assert.equal(oauth.safeGoogleCalendarReturnTo(value), "/settings/calendar");
  }
});

test("failed setup reports a calendar that could not be cleaned up", async () => {
  const setupError = new Error("database unavailable");
  await assert.rejects(
    client.throwAfterGoogleCalendarCleanup(
      "calendar-id",
      "access-token",
      setupError,
      async () => new Response(null, { status: 204 }),
    ),
    (error) => error === setupError,
  );
  await assert.rejects(
    client.throwAfterGoogleCalendarCleanup(
      "calendar-id",
      "access-token",
      setupError,
      async () => new Response(null, { status: 503 }),
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.includes(setupError) &&
      error.message.includes("calendar-id"),
  );
});

test("calendar task events have stable IDs, fingerprints, and one-hour times", () => {
  const task = {
    dueDate: new Date("2026-09-08T12:30:00.000Z"),
    id: 19353,
    projectId: 15,
    section: "In Progress",
    ticketNumber: "HTPR-3533",
    title: "Google Calendar Integration",
    uniqueIndex: 3533,
  };
  const body = client.googleCalendarEventBody(task);
  assert.match(body.id, /^[a-v0-9]{5,1024}$/);
  assert.equal(body.start.dateTime, "2026-09-08T12:30:00.000Z");
  assert.equal(body.end.dateTime, "2026-09-08T13:30:00.000Z");
  assert.equal(body.extendedProperties.private.hypertask, "1");
  assert.equal(
    body.source.url,
    "https://app.hypertask.ai/detail/project-15/3533",
  );
  assert.equal(
    body.extendedProperties.private.fingerprint,
    client.googleCalendarTaskFingerprint(task),
  );
  assert.notEqual(
    client.googleCalendarTaskFingerprint({ ...task, title: "Changed" }),
    client.googleCalendarTaskFingerprint(task),
  );
});

test("midnight due times remain timed events", () => {
  const body = client.googleCalendarEventBody({
    dueDate: new Date("2026-09-08T00:00:00.000Z"),
    id: 8,
    projectId: 15,
    section: "Features",
    ticketNumber: null,
    title: "Midnight task",
    uniqueIndex: 8,
  });
  assert.equal(body.start.dateTime, "2026-09-08T00:00:00.000Z");
  assert.equal(body.end.dateTime, "2026-09-08T01:00:00.000Z");
  assert.equal(body.start.date, undefined);
});

test("event writes make one bounded insert-to-update recovery attempt", async () => {
  const calls = [];
  const body = client.googleCalendarEventBody({
    dueDate: new Date("2026-09-08T00:00:00.000Z"),
    id: 7,
    projectId: 15,
    section: "Features",
    ticketNumber: null,
    title: "Task",
    uniqueIndex: 7,
  });
  await assert.rejects(
    client.insertGoogleCalendarEvent(
      "calendar",
      "token",
      body,
      async (url, init) => {
        calls.push({ url: String(url), method: init.method });
        return new Response(null, { status: calls.length === 1 ? 409 : 404 });
      },
    ),
    (error) =>
      error instanceof client.GoogleCalendarApiError && error.status === 404,
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST", "PUT"],
  );
});

test("calendar existence checks consume missing responses", async () => {
  const response = new Response("missing", { status: 404 });
  assert.equal(
    await client.googleCalendarExists(
      "calendar",
      "token",
      async () => response,
    ),
    false,
  );
  assert.equal(response.bodyUsed, true);
});

test("event pagination stops before aggregate memory can grow without bound", async () => {
  let page = 0;
  await assert.rejects(
    client.listGoogleCalendarEvents("calendar", "token", true, async () => {
      page += 1;
      return Response.json({
        items: Array.from({ length: 250 }, (_, index) => ({
          id: `event-${page}-${index}`,
        })),
        nextPageToken: `page-${page + 1}`,
      });
    }),
    /too many events/,
  );
  assert.equal(page, 41);
});
