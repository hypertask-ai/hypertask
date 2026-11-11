const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { loadModule } = require("./helpers/loadModule.cjs");

function fixture() {
  let calls = 0;
  const result = { scanned: 100, switched: 12, failed: [], remaining: 1141 };
  const route = loadModule("src/app/api/cron/saved-model-auto/route.ts", {
    "@/lib/ai/htpr9019ModelChoiceAuto": {
      sweepHtpr9019ModelChoices: async () => { calls++; return result; },
    },
  });
  return { route, result, calls: () => calls };
}

const request = (token) => new NextRequest("https://app.hypertask.ai/api/cron/saved-model-auto", {
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

test("saved-model cron rejects missing and wrong credentials but allows the scheduler", async () => {
  const before = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "cron-test-secret";
    const { route, result, calls } = fixture();
    for (const token of [undefined, "wrong"]) {
      const response = await route.GET(request(token));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
    assert.equal(calls(), 0);
    const response = await route.GET(request("cron-test-secret"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), result);
    assert.equal(calls(), 1);
    delete process.env.CRON_SECRET;
    assert.equal((await route.GET(request("undefined"))).status, 401);
    assert.equal(calls(), 1);
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});
