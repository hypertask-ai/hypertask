const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, `tests/htpr-8101-jiti-entry-${++jitiEntryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

function sign(secret, body) {
  return createHmac("sha1", secret).update(body, "utf8").digest("hex");
}

async function withStubbedBudgetLibs(stubs, run) {
  const libPaths = [
    path.join(root, "src/lib/ops/fileVercelBudgetTicket.ts"),
    path.join(root, "src/lib/ops/vercelBudgetAlert.ts"),
  ];
  const routePath = path.join(root, "src/app/api/integrations/vercel/budget-alert/route.ts");
  const touched = [...libPaths, routePath];
  const previous = new Map(touched.map((modulePath) => [modulePath, require.cache[modulePath]]));

  for (const modulePath of touched) delete require.cache[modulePath];
  for (const [relativePath, exports] of Object.entries(stubs)) {
    const modulePath = path.join(root, relativePath);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }

  try {
    return await run(loadTs("src/app/api/integrations/vercel/budget-alert/route.ts"));
  } finally {
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
}

function postRequest(body, headers = {}) {
  return new Request("https://app.hypertask.ai/api/integrations/vercel/budget-alert", {
    method: "POST",
    headers,
    body,
  });
}

test("documented Vercel spend payload is accepted", async () => {
  const lib = loadTs("src/lib/ops/vercelBudgetAlert.ts");
  const alert = lib.parseVercelBudgetAlert({
    budgetAmount: 500,
    currentSpend: 375.5,
    teamId: "team_jkT8yZ3oE1u6xLo8h6dxfNc3",
    thresholdPercent: 75,
  });
  assert.deepEqual(alert, {
    budgetAmount: 500,
    currentSpend: 375.5,
    thresholdPercent: 75,
    teamId: "team_jkT8yZ3oE1u6xLo8h6dxfNc3",
    budgetScope: "team budget",
  });
});

test("an explicit budget scope is kept", async () => {
  const lib = loadTs("src/lib/ops/vercelBudgetAlert.ts");
  const alert = lib.parseVercelBudgetAlert({
    budgetAmount: 20,
    currentSpend: 20,
    teamId: "team_1",
    thresholdPercent: 100,
    budgetScope: "ai gateway budget",
  });
  assert.equal(alert.budgetScope, "ai gateway budget");
});

test("payloads missing a spend, budget, team or threshold are refused", async () => {
  const lib = loadTs("src/lib/ops/vercelBudgetAlert.ts");
  const documented = {
    budgetAmount: 500,
    currentSpend: 250,
    teamId: "team_jkT8yZ3oE1u6xLo8h6dxfNc3",
    thresholdPercent: 50,
  };
  assert.ok(lib.parseVercelBudgetAlert(documented));
  for (const broken of [
    { ...documented, budgetAmount: undefined },
    { ...documented, budgetAmount: 0 },
    { ...documented, currentSpend: -1 },
    { ...documented, currentSpend: "250" },
    { ...documented, teamId: "" },
    { ...documented, teamId: "team with spaces" },
    { ...documented, teamId: "team_<script>" },
    { ...documented, thresholdPercent: 50.5 },
    { ...documented, thresholdPercent: 0 },
    { ...documented, thresholdPercent: 5000 },
    null,
    "not-json-object",
    [],
  ]) {
    assert.equal(lib.parseVercelBudgetAlert(broken), null, JSON.stringify(broken));
  }
});

test("only the raw-body sha1 of the shared secret verifies", async () => {
  const lib = loadTs("src/lib/ops/vercelBudgetAlert.ts");
  const secret = "whsec_example";
  const body = JSON.stringify({ budgetAmount: 500, currentSpend: 250, teamId: "team_1", thresholdPercent: 50 });
  assert.equal(lib.verifyVercelSignature(body, sign(secret, body), secret), true);
  assert.equal(lib.verifyVercelSignature(body, sign(secret, body).toUpperCase(), secret), true);
  assert.equal(lib.verifyVercelSignature(body, sign("another-secret", body), secret), false);
  assert.equal(lib.verifyVercelSignature(body, sign(secret, `${body} `), secret), false);
  assert.equal(lib.verifyVercelSignature(body, null, secret), false);
  assert.equal(lib.verifyVercelSignature(body, sign(secret, body), undefined), false);
  assert.equal(lib.verifyVercelSignature(body, "sha1=abc", secret), false);
});

test("the ticket names the limit, the spend and the budget left", async () => {
  const lib = loadTs("src/lib/ops/vercelBudgetAlert.ts");
  const alert = {
    budgetAmount: 500,
    currentSpend: 375.5,
    thresholdPercent: 75,
    teamId: "team_jkT8yZ3oE1u6xLo8h6dxfNc3",
    budgetScope: "team budget",
  };
  assert.equal(lib.budgetAlertTitle(alert), "Vercel team budget at 75%: $375.50 of $500.00");
  const description = lib.budgetAlertDescription(alert);
  assert.match(description, /reached 75%/);
  assert.match(description, /Spent so far: \$375\.50 of \$500\.00/);
  assert.match(description, /Budget left: \$124\.50/);
  assert.match(description, /Vercel team: team_jkT8yZ3oE1u6xLo8h6dxfNc3/);
  assert.ok(description.includes("vercel-budget-alert:team_jkT8yZ3oE1u6xLo8h6dxfNc3:500:75"));
});

test("each threshold and budget gets its own marker", async () => {
  const lib = loadTs("src/lib/ops/vercelBudgetAlert.ts");
  const base = { budgetAmount: 500, currentSpend: 250, teamId: "team_1", thresholdPercent: 50, budgetScope: "team budget" };
  assert.equal(lib.budgetAlertMarker(base), "vercel-budget-alert:team_1:500:50");
  assert.notEqual(lib.budgetAlertMarker(base), lib.budgetAlertMarker({ ...base, thresholdPercent: 75 }));
  assert.notEqual(lib.budgetAlertMarker(base), lib.budgetAlertMarker({ ...base, budgetAmount: 900 }));
});

test("an unconfigured webhook is refused", async () => {
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
  let filed = 0;
  await withStubbedBudgetLibs(
    {
      "src/lib/ops/fileVercelBudgetTicket.ts": {
        fileVercelBudgetTicket: async () => {
          filed += 1;
          return { taskId: 1, created: true, emailed: false };
        },
      },
    },
    async (route) => {
      const response = await route.POST(postRequest(JSON.stringify({ budgetAmount: 500, currentSpend: 250, teamId: "team_1", thresholdPercent: 50 })));
      assert.equal(response.status, 503);
    },
  );
  assert.equal(filed, 0);
});

test("an unsigned alert is refused and files nothing", async () => {
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = "whsec_example";
  let filed = 0;
  await withStubbedBudgetLibs(
    {
      "src/lib/ops/fileVercelBudgetTicket.ts": {
        fileVercelBudgetTicket: async () => {
          filed += 1;
          return { taskId: 1, created: true, emailed: false };
        },
      },
    },
    async (route) => {
      const body = JSON.stringify({ budgetAmount: 500, currentSpend: 250, teamId: "team_1", thresholdPercent: 50 });
      const unsigned = await route.POST(postRequest(body));
      assert.equal(unsigned.status, 401);
      const forged = await route.POST(postRequest(body, { "x-vercel-signature": sign("guess", body) }));
      assert.equal(forged.status, 401);
    },
  );
  assert.equal(filed, 0);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("a signed alert files the urgent ticket once", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const filed = [];
  await withStubbedBudgetLibs(
    {
      "src/lib/ops/fileVercelBudgetTicket.ts": {
        fileVercelBudgetTicket: async (alert) => {
          filed.push(alert);
          return { taskId: 4242, created: true, emailed: false };
        },
      },
    },
    async (route) => {
      const body = JSON.stringify({ budgetAmount: 500, currentSpend: 500, teamId: "team_1", thresholdPercent: 100 });
      const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { taskId: 4242, created: true, emailed: false });
    },
  );
  assert.equal(filed.length, 1);
  assert.equal(filed[0].thresholdPercent, 100);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("a signed but malformed alert is refused", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  let filed = 0;
  await withStubbedBudgetLibs(
    {
      "src/lib/ops/fileVercelBudgetTicket.ts": {
        fileVercelBudgetTicket: async () => {
          filed += 1;
          return { taskId: 1, created: true, emailed: false };
        },
      },
    },
    async (route) => {
      const body = JSON.stringify({ budgetAmount: 500, currentSpend: 250, teamId: "team_1" });
      const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
      assert.equal(response.status, 400);
    },
  );
  assert.equal(filed, 0);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});
