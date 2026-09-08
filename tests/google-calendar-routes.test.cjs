const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let sessionUserId;
let enabled;
let disconnectedUserId;
let syncChange;
let eligibilityError;

function stub(file, exports) {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () =>
    sessionUserId ? { userId: sessionUserId } : null,
});
stub("src/lib/googleCalendar/connection.ts", {
  getGoogleCalendarConnection: async () => null,
  googleCalendarEnabledFor: async () => {
    if (eligibilityError) throw eligibilityError;
    return enabled;
  },
  requestGoogleCalendarDisconnect: async (userId) => {
    disconnectedUserId = userId;
    return true;
  },
  setGoogleCalendarSyncEnabled: async (userId, syncEnabled) => {
    syncChange = { syncEnabled, userId };
    return true;
  },
});

const route = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
})(path.join(root, "src/app/api/google-calendar/connection/route.ts"));

const request = (method, body, origin = "https://app.hypertask.ai") =>
  new NextRequest("https://app.hypertask.ai/api/google-calendar/connection", {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      origin,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test.beforeEach(() => {
  sessionUserId = 6;
  enabled = true;
  disconnectedUserId = null;
  syncChange = null;
  eligibilityError = null;
});

test("flag lookup failures return a controlled service response", async () => {
  eligibilityError = new Error("flag unavailable");
  assert.equal(
    (await route.PATCH(request("PATCH", { syncEnabled: true }))).status,
    503,
  );
});

test("connection routes require a signed user and same-origin mutations", async () => {
  sessionUserId = null;
  assert.equal((await route.GET(request("GET"))).status, 401);
  assert.equal(
    (await route.PATCH(request("PATCH", { syncEnabled: false }))).status,
    401,
  );
  assert.equal((await route.DELETE(request("DELETE"))).status, 401);
  assert.equal(syncChange, null);
  assert.equal(disconnectedUserId, null);
  sessionUserId = 6;
  assert.equal(
    (
      await route.PATCH(
        request("PATCH", { syncEnabled: false }, "https://evil.example"),
      )
    ).status,
    403,
  );
  assert.equal(
    (await route.DELETE(request("DELETE", null, "https://evil.example")))
      .status,
    403,
  );
  assert.equal(syncChange, null);
  assert.equal(disconnectedUserId, null);
});

test("flag off blocks enabling but still allows cleanup and disconnect", async () => {
  enabled = false;
  assert.equal((await route.GET(request("GET"))).status, 404);
  assert.equal(
    (await route.PATCH(request("PATCH", { syncEnabled: true }))).status,
    404,
  );
  assert.equal(
    (await route.PATCH(request("PATCH", { syncEnabled: false }))).status,
    200,
  );
  assert.deepEqual(syncChange, { syncEnabled: false, userId: 6 });
  assert.equal((await route.DELETE(request("DELETE"))).status, 200);
  assert.equal(disconnectedUserId, 6);
});
