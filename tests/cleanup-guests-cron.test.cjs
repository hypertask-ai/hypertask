// HTPR-6509: the hourly guest sweep runs a few cascades at once instead of one
// after another. The result must stay the same as the sequential loop: every
// stale guest is attempted, a failing guest does not stop the others, and the
// failures come back in input order. Parallelism must also stay bounded so the
// sweep cannot take every pooled database connection.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadRoute({ staleIds, failingIds = [] }) {
  const calls = { attempted: [], maxInFlight: 0 };
  let inFlight = 0;
  for (const relativePath of [
    "src/app/api/cron/cleanup-guests/route.ts",
    "src/lib/demo/cleanupGuest.ts",
    "src/lib/cronAuthorization.ts",
  ]) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule("src/lib/cronAuthorization.ts", {
    hasValidCronAuthorization: (header, secret) => header === `Bearer ${secret}`,
  });
  stubModule("src/lib/demo/cleanupGuest.ts", {
    findStaleGuestIds: async () => staleIds,
    deleteGuestCascade: async (guestId) => {
      calls.attempted.push(guestId);
      inFlight += 1;
      calls.maxInFlight = Math.max(calls.maxInFlight, inFlight);
      // Uneven delays so a chunk finishes out of order.
      await new Promise((resolve) => setTimeout(resolve, (guestId % 3) * 2));
      inFlight -= 1;
      if (failingIds.includes(guestId)) throw new Error(`boom ${guestId}`);
    },
  });
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-cleanup-guests-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false },
  );
  return { route: jiti(path.join(root, "src/app/api/cron/cleanup-guests/route.ts")), calls };
}

const request = () =>
  new NextRequest("https://app.hypertask.ai/api/cron/cleanup-guests", {
    headers: { authorization: "Bearer test-secret" },
  });

test.beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
});

test("every stale guest is attempted and failures keep input order", async () => {
  const staleIds = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const failingIds = [20, 13, 17];
  const { route, calls } = loadRoute({ staleIds, failingIds });
  const originalError = console.error;
  console.error = () => {};
  let body;
  try {
    body = await (await route.GET(request())).json();
  } finally {
    console.error = originalError;
  }

  // Same numbers the sequential loop produced for this input.
  assert.deepEqual(body, { deleted: 8, failed: [13, 17, 20] });
  assert.deepEqual([...calls.attempted].sort((a, b) => a - b), staleIds);
  assert.ok(calls.maxInFlight > 1, "guests should be deleted in parallel");
  assert.ok(
    calls.maxInFlight <= 4,
    `at most 4 cascades at once, saw ${calls.maxInFlight}`,
  );
});

test("an empty sweep deletes nothing", async () => {
  const { route, calls } = loadRoute({ staleIds: [] });
  assert.deepEqual(await (await route.GET(request())).json(), { deleted: 0, failed: [] });
  assert.deepEqual(calls.attempted, []);
});

test("an unauthorized caller deletes nothing", async () => {
  const { route, calls } = loadRoute({ staleIds: [1, 2] });
  const response = await route.GET(
    new NextRequest("https://app.hypertask.ai/api/cron/cleanup-guests"),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(calls.attempted, []);
});
