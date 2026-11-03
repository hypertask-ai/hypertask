const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { loadModule } = require("./helpers/loadModule.cjs");

const ROUTE = "src/app/api/integrations/vercel/budget-alert/route.ts";
const TICKET_LIB = "@/lib/ops/fileVercelBudgetTicket";
const FLAGS_LIB = "@/lib/flags";

function sign(secret, body) {
  return createHmac("sha1", secret).update(body, "utf8").digest("hex");
}

function loadAlertLib() {
  return loadModule("src/lib/ops/vercelBudgetAlert.ts");
}

function loadFilerLib() {
  return loadModule("src/lib/ops/fileVercelBudgetTicket.ts");
}

function loadRoute({ onFile = () => {}, flagOn = true } = {}) {
  return loadModule(ROUTE, {
    [FLAGS_LIB]: {
      HTPR_8101_VERCEL_BUDGET_ALERTS_FLAG: "htpr-8101-vercel-budget-alerts",
      isFeatureEnabled: async () => flagOn,
    },
    [TICKET_LIB]: {
      fileVercelBudgetTicket: async (alert) => {
        onFile(alert);
        return { taskId: 4242, created: true, emailed: false };
      },
      BudgetAlertRaceError: class BudgetAlertRaceError extends Error {},
    },
  });
}

function postRequest(body, headers = {}) {
  return new Request("https://app.hypertask.ai/api/integrations/vercel/budget-alert", {
    method: "POST",
    headers,
    body,
  });
}

function documentedAlert(overrides = {}) {
  return {
    budgetAmount: 500,
    currentSpend: 250,
    teamId: "team_jkT8yZ3oE1u6xLo8h6dxfNc3",
    thresholdPercent: 50,
    ...overrides,
  };
}

function memoryStore({ createDelayMs = 0 } = {}) {
  const tickets = new Map();
  const reservations = new Set();
  const emailClaims = new Set();
  const calls = { create: 0, comments: 0, emails: [], releases: 0 };
  let nextId = 100;
  return {
    calls,
    async findTicket(marker) {
      return tickets.get(marker) ?? null;
    },
    async createTicket(alert) {
      calls.create += 1;
      if (createDelayMs) await new Promise((resolve) => setTimeout(resolve, createDelayMs));
      const id = nextId++;
      tickets.set(loadAlertLib().budgetAlertMarkerHtml(alert), id);
      return id;
    },
    async addComment() {
      calls.comments += 1;
    },
    async reserve(marker) {
      if (reservations.has(marker)) return false;
      reservations.add(marker);
      return true;
    },
    async claimEmail(marker) {
      if (emailClaims.has(marker)) return false;
      emailClaims.add(marker);
      return true;
    },
    async releaseEmail(marker) {
      calls.releases += 1;
      emailClaims.delete(marker);
    },
    async email(taskId) {
      calls.emails.push(taskId);
    },
  };
}

test("documented Vercel spend payload is accepted", () => {
  const alert = loadAlertLib().parseVercelBudgetAlert(documentedAlert());
  assert.deepEqual(alert, {
    budgetAmount: 500,
    currentSpend: 250,
    thresholdPercent: 50,
    teamId: "team_jkT8yZ3oE1u6xLo8h6dxfNc3",
    budgetScope: "team budget",
  });
});

test("an explicit budget scope is kept", () => {
  const alert = loadAlertLib().parseVercelBudgetAlert(documentedAlert({ budgetScope: "ai gateway budget" }));
  assert.equal(alert.budgetScope, "ai gateway budget");
});

test("payloads missing a spend, budget, team or threshold are refused", () => {
  const { parseVercelBudgetAlert } = loadAlertLib();
  assert.ok(parseVercelBudgetAlert(documentedAlert()));
  for (const broken of [
    { ...documentedAlert(), budgetAmount: undefined },
    { ...documentedAlert(), budgetAmount: 0 },
    { ...documentedAlert(), currentSpend: -1 },
    { ...documentedAlert(), currentSpend: "250" },
    { ...documentedAlert(), teamId: "" },
    { ...documentedAlert(), teamId: "team with spaces" },
    { ...documentedAlert(), teamId: "team_<script>" },
    { ...documentedAlert(), thresholdPercent: 50.5 },
    { ...documentedAlert(), thresholdPercent: 0 },
    { ...documentedAlert(), thresholdPercent: 5000 },
    null,
    "not-json-object",
    [],
  ]) {
    assert.equal(parseVercelBudgetAlert(broken), null, JSON.stringify(broken));
  }
});

test("only the raw-body sha1 of the shared secret verifies", () => {
  const { verifyVercelSignature } = loadAlertLib();
  const secret = "whsec_example";
  const body = JSON.stringify(documentedAlert());
  assert.equal(verifyVercelSignature(body, sign(secret, body), secret), true);
  assert.equal(verifyVercelSignature(body, sign(secret, body).toUpperCase(), secret), true);
  assert.equal(verifyVercelSignature(body, sign("another-secret", body), secret), false);
  assert.equal(verifyVercelSignature(body, sign(secret, `${body} `), secret), false);
  assert.equal(verifyVercelSignature(body, null, secret), false);
  assert.equal(verifyVercelSignature(body, sign(secret, body), undefined), false);
  assert.equal(verifyVercelSignature(body, "sha1=abc", secret), false);
});

test("the ticket names the limit, the spend and the budget left", () => {
  const { budgetAlertDescription, budgetAlertTitle } = loadAlertLib();
  const alert = documentedAlert({ currentSpend: 375.5, thresholdPercent: 75 });
  assert.equal(budgetAlertTitle(alert), "Vercel team budget at 75%: $375.50 of $500.00");
  const description = budgetAlertDescription(alert);
  assert.match(description, /reached 75%/);
  assert.match(description, /Spent so far: \$375\.50 of \$500\.00/);
  assert.match(description, /Budget left: \$124\.50/);
  assert.match(description, /Vercel team: team_jkT8yZ3oE1u6xLo8h6dxfNc3/);
});

test("each threshold and budget gets its own marker", () => {
  const { budgetAlertMarker, budgetAlertMarkerHtml } = loadAlertLib();
  const base = documentedAlert();
  const marker = budgetAlertMarker(base);
  assert.equal(marker, "vercel-budget-alert:team:team_jkT8yZ3oE1u6xLo8h6dxfNc3:budget:500:threshold:50");
  assert.equal(budgetAlertMarkerHtml(base), `<p>${marker}</p>`);
  assert.notEqual(marker, budgetAlertMarker({ ...base, thresholdPercent: 100 }));
  assert.notEqual(marker, budgetAlertMarker({ ...base, budgetAmount: 900 }));
});

test("a threshold of 10 never matches an existing 100 ticket", () => {
  const { budgetAlertMarkerHtml } = loadAlertLib();
  const stored = `${budgetAlertMarkerHtml(documentedAlert({ thresholdPercent: 100 }))}`;
  const wanted = budgetAlertMarkerHtml(documentedAlert({ thresholdPercent: 10 }));
  assert.equal(stored.includes(wanted), false);
});

test("two deliveries of one alert file one ticket", async () => {
  const { fileBudgetAlert } = loadFilerLib();
  const store = memoryStore({ createDelayMs: 20 });
  const alert = documentedAlert({ thresholdPercent: 100 });
  const results = await Promise.all([
    fileBudgetAlert(alert, store),
    fileBudgetAlert(alert, store),
    fileBudgetAlert(alert, store),
  ]);
  assert.equal(store.calls.create, 1);
  assert.equal(results.length, 3);
  assert.equal(new Set(results.map((result) => result.taskId)).size, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
});

test("a repeat alert comments on the same ticket", async () => {
  const { fileBudgetAlert } = loadFilerLib();
  const store = memoryStore();
  const first = await fileBudgetAlert(documentedAlert(), store);
  const second = await fileBudgetAlert(documentedAlert({ currentSpend: 300 }), store);
  assert.equal(store.calls.create, 1);
  assert.equal(store.calls.comments, 1);
  assert.equal(first.taskId, second.taskId);
});

test("a release of the email claim lets the next alert send it", async () => {
  const { fileBudgetAlert } = loadFilerLib();
  const store = memoryStore();
  store.email = async () => {
    throw new Error("resend refused");
  };
  const alert = documentedAlert({ currentSpend: 500, thresholdPercent: 100 });
  const failed = await fileBudgetAlert(alert, store);
  assert.equal(failed.emailed, false);
  assert.equal(store.calls.releases, 1);
  const sent = [];
  store.email = async (taskId) => sent.push(taskId);
  const retried = await fileBudgetAlert(alert, store);
  assert.equal(retried.emailed, true);
  assert.deepEqual(sent, [retried.taskId]);
});

test("an unconfigured webhook is refused and files nothing", async () => {
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
  const filed = [];
  const route = loadRoute({ onFile: (alert) => filed.push(alert) });
  const response = await route.POST(postRequest(JSON.stringify(documentedAlert())));
  assert.equal(response.status, 503);
  assert.equal(filed.length, 0);
});

test("an unsigned or forged alert is refused and files nothing", async () => {
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = "whsec_example";
  const filed = [];
  const route = loadRoute({ onFile: (alert) => filed.push(alert) });
  const body = JSON.stringify(documentedAlert());
  assert.equal((await route.POST(postRequest(body))).status, 401);
  assert.equal((await route.POST(postRequest(body, { "x-vercel-signature": sign("guess", body) }))).status, 401);
  assert.equal(filed.length, 0);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("a signed alert files one urgent ticket", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const filed = [];
  const route = loadRoute({ onFile: (alert) => filed.push(alert) });
  const body = JSON.stringify(documentedAlert({ currentSpend: 500, thresholdPercent: 100 }));
  const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { taskId: 4242, created: true, emailed: false });
  assert.equal(filed.length, 1);
  assert.equal(filed[0].thresholdPercent, 100);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("the flag switches the intake off", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const filed = [];
  const route = loadRoute({ onFile: (alert) => filed.push(alert), flagOn: false });
  const body = JSON.stringify(documentedAlert());
  const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
  assert.equal(response.status, 503);
  assert.equal(filed.length, 0);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("a signed but malformed alert is refused", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const filed = [];
  const route = loadRoute({ onFile: (alert) => filed.push(alert) });
  const body = JSON.stringify({ budgetAmount: 500, currentSpend: 250, teamId: "team_1" });
  const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
  assert.equal(response.status, 400);
  assert.equal(filed.length, 0);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});
