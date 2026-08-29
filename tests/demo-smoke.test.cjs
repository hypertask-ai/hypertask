const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const seedTitles = ["Seed one", "Seed two"];
const calls = {
  cleanup: [],
  provision: [],
  report: [],
};
let taskTitles = [...seedTitles];

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  delete require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

class NextRequest extends Request {}

class NextResponse {
  static json(body, init) {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  }
}

const nextServerPath = require.resolve("next/server");
require.cache[nextServerPath] = {
  id: nextServerPath,
  filename: nextServerPath,
  loaded: true,
  exports: { NextRequest, NextResponse },
};

stubModule("src/lib/cronAuthorization.ts", {
  hasValidCronAuthorization: (authorization, secret) =>
    authorization === `Bearer ${secret}`,
});
stubModule("src/lib/demo/cleanupGuest.ts", {
  deleteGuestCascade: async (userId) => calls.cleanup.push(userId),
});
stubModule("src/lib/demo/guestSeedTasks.ts", {
  GUEST_SEED_TASK_TITLES: seedTitles,
});
stubModule("src/lib/demo/provisionGuest.ts", {
  provisionGuest: async (purpose) => {
    calls.provision.push(purpose);
    return { userId: 900, projectId: 901 };
  },
});
stubModule("src/lib/errors/reportError.ts", {
  reportError: async (report) => calls.report.push(report),
});
stubModule("src/lib/prisma.ts", {
  default: {
    task: {
      findMany: async () => taskTitles.map((title) => ({ title })),
    },
  },
});

process.env.CRON_SECRET = "secret";
const jiti = require("jiti")(
  path.join(root, "tests/demo-smoke-jiti.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);
const { GET } = jiti(path.join(root, "src/app/api/cron/demo-smoke/route.ts"));

function request(authorized = true) {
  return new NextRequest("https://app.hypertask.ai/api/cron/demo-smoke", {
    headers: authorized ? { authorization: "Bearer secret" } : {},
  });
}

test.beforeEach(() => {
  taskTitles = [...seedTitles];
  calls.cleanup.length = 0;
  calls.provision.length = 0;
  calls.report.length = 0;
});

test("the demo smoke check provisions, validates, and deletes a guest", async () => {
  const response = await GET(request());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: 1, failed: [] });
  assert.deepEqual(calls.provision, [""]);
  assert.deepEqual(calls.cleanup, [900]);
  assert.deepEqual(calls.report, []);
});

test("a failed seed assertion cleans up and reports one ticket per signature", async () => {
  taskTitles = [seedTitles[0]];

  const firstResponse = await GET(request());
  const secondResponse = await GET(request());

  assert.equal(firstResponse.status, 500);
  assert.deepEqual(await firstResponse.json(), {
    deleted: 1,
    failed: ["Demo board is missing seed tasks: Seed two"],
  });
  assert.equal(secondResponse.status, 500);
  assert.deepEqual(calls.cleanup, [900, 900]);
  assert.equal(calls.report.length, 1);
  assert.deepEqual(calls.report[0].extra, {
    errorName: "Error",
    errorMessage: "Demo board is missing seed tasks: Seed two",
    prismaCode: null,
  });
});

test("the demo smoke check rejects an unauthorized request", async () => {
  const response = await GET(request(false));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.deepEqual(calls.provision, []);
  assert.deepEqual(calls.cleanup, []);
});
