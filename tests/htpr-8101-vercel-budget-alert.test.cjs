const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { loadModule } = require("./helpers/loadModule.cjs");

const ROUTE = "src/app/api/integrations/vercel/budget-alert/route.ts";
const TICKET_LIB = "@/lib/ops/fileVercelBudgetTicket";
const FILING_LIB = "@/lib/ops/budgetAlertFiling";
const FLAGS_LIB = "@/lib/flags";

function sign(secret, body) {
  return createHmac("sha1", secret).update(body, "utf8").digest("hex");
}

function loadAlertLib() {
  return loadModule("src/lib/ops/vercelBudgetAlert.ts");
}

function loadFilingLib() {
  return loadModule("src/lib/ops/budgetAlertFiling.ts");
}

function loadRoute({ onFile = () => {}, flagOn = true, email = "not-needed" } = {}) {
  return loadModule(ROUTE, {
    [FLAGS_LIB]: {
      HTPR_8101_VERCEL_BUDGET_ALERTS_FLAG: "htpr-8101-vercel-budget-alerts",
      isFeatureEnabled: async () => flagOn,
    },
    [TICKET_LIB]: {
      fileVercelBudgetTicket: async (alert) => {
        onFile(alert);
        return { taskId: 4242, created: true, email };
      },
    },
    [FILING_LIB]: {
      fileBudgetAlert: async (alert) => {
        onFile(alert);
        return { taskId: 4242, created: true, email };
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

function documentedPayload(overrides = {}) {
  return {
    budgetAmount: 500,
    currentSpend: 250,
    teamId: "team_jkT8yZ3oE1u6xLo8h6dxfNc3",
    thresholdPercent: 50,
    ...overrides,
  };
}

function alert(overrides = {}) {
  const parsed = loadAlertLib().parseVercelBudgetAlert(documentedPayload(overrides));
  assert.ok(parsed, `payload not accepted: ${JSON.stringify(overrides)}`);
  return parsed;
}

function memoryStore({ createDelayMs = 0 } = {}) {
  const tickets = new Map();
  const reservations = new Set();
  const emailClaims = new Set();
  const updates = new Set();
  const calls = { create: 0, comments: 0, emails: [], releases: 0 };
  let nextId = 100;
  return {
    calls,
    async findTicket(marker) {
      return tickets.get(marker) ?? null;
    },
    async createTicket(created) {
      calls.create += 1;
      if (createDelayMs) await new Promise((resolve) => setTimeout(resolve, createDelayMs));
      const id = nextId++;
      tickets.set(loadAlertLib().budgetAlertMarkerHtml(created), id);
      return id;
    },
    async addComment() {
      calls.comments += 1;
    },
    async reserveSpend(key) {
      if (updates.has(key)) return false;
      updates.add(key);
      return true;
    },
    async releaseSpend(key) {
      updates.delete(key);
    },
    async reserve(marker) {
      if (reservations.has(marker)) return false;
      reservations.add(marker);
      return true;
    },
    async claimEmail(marker) {
      if (emailClaims.has(marker)) return "already-sent";
      emailClaims.add(marker);
      return "claimed";
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
  assert.deepEqual(loadAlertLib().parseVercelBudgetAlert(documentedPayload()), {
    budgetAmount: 500,
    currentSpend: 250,
    thresholdPercent: 50,
    teamId: "team_jkT8yZ3oE1u6xLo8h6dxfNc3",
    budgetScope: "team budget",
  });
});

test("an explicit budget scope is kept", () => {
  const parsed = loadAlertLib().parseVercelBudgetAlert(documentedPayload({ budgetScope: "ai gateway budget" }));
  assert.equal(parsed.budgetScope, "ai gateway budget");
});

test("payloads missing a spend, budget, team or threshold are refused", () => {
  const { parseVercelBudgetAlert } = loadAlertLib();
  assert.ok(parseVercelBudgetAlert(documentedPayload()));
  for (const broken of [
    { ...documentedPayload(), budgetAmount: undefined },
    { ...documentedPayload(), budgetAmount: 0 },
    { ...documentedPayload(), currentSpend: -1 },
    { ...documentedPayload(), currentSpend: "250" },
    { ...documentedPayload(), teamId: "" },
    { ...documentedPayload(), teamId: "team with spaces" },
    { ...documentedPayload(), teamId: "team_<script>" },
    { ...documentedPayload(), thresholdPercent: 50.5 },
    { ...documentedPayload(), thresholdPercent: 0 },
    { ...documentedPayload(), thresholdPercent: 5000 },
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
  const body = JSON.stringify(documentedPayload());
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
  const full = alert({ currentSpend: 375.5, thresholdPercent: 75 });
  assert.equal(budgetAlertTitle(full), "Vercel team budget at 75%: $375.50 of $500.00");
  const description = budgetAlertDescription(full);
  assert.match(description, /reached 75%/);
  assert.match(description, /Spent so far: \$375\.50 of \$500\.00/);
  assert.match(description, /Budget left: \$124\.50/);
  assert.match(description, /Vercel team: team_jkT8yZ3oE1u6xLo8h6dxfNc3/);
});

test("each threshold and budget gets its own marker", () => {
  const { budgetAlertMarker, budgetAlertMarkerHtml } = loadAlertLib();
  const base = alert();
  const marker = budgetAlertMarker(base);
  assert.equal(
    marker,
    "vercel-budget-alert:team:team_jkT8yZ3oE1u6xLo8h6dxfNc3:budget:500:threshold:50:scope:team-budget",
  );
  assert.equal(budgetAlertMarkerHtml(base), `<p>${marker}</p>`);
  assert.notEqual(marker, budgetAlertMarker(alert({ thresholdPercent: 100 })));
  assert.notEqual(marker, budgetAlertMarker(alert({ budgetAmount: 900 })));
  assert.notEqual(marker, budgetAlertMarker(alert({ budgetScope: "ai gateway budget" })));
});

test("two scopes on one team never share a ticket", () => {
  const { budgetAlertMarker } = loadAlertLib();
  const team = alert();
  const gateway = alert({ budgetScope: "ai gateway budget" });
  assert.notEqual(budgetAlertMarker(team), budgetAlertMarker(gateway));
});

test("a threshold of 10 never matches an existing 100 ticket", () => {
  const { budgetAlertMarkerHtml } = loadAlertLib();
  const stored = budgetAlertMarkerHtml(alert({ thresholdPercent: 100 }));
  assert.equal(stored.includes(budgetAlertMarkerHtml(alert({ thresholdPercent: 10 }))), false);
});

test("two deliveries of one alert file one ticket", async () => {
  const { fileBudgetAlert } = loadFilingLib();
  const store = memoryStore({ createDelayMs: 20 });
  const one = alert({ thresholdPercent: 100 });
  const results = await Promise.all([
    fileBudgetAlert(one, store),
    fileBudgetAlert(one, store),
    fileBudgetAlert(one, store),
  ]);
  assert.equal(store.calls.create, 1);
  assert.equal(new Set(results.map((result) => result.taskId)).size, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
});

test("a delivery that loses the race still records its spend", async () => {
  const { fileBudgetAlert } = loadFilingLib();
  const store = memoryStore({ createDelayMs: 20 });
  const results = await Promise.all([
    fileBudgetAlert(alert(), store),
    fileBudgetAlert(alert({ currentSpend: 300 }), store),
  ]);
  assert.equal(store.calls.create, 1);
  assert.equal(store.calls.comments, 1);
  assert.equal(results[0].taskId, results[1].taskId);
});

test("a repeat alert comments on the same ticket", async () => {
  const { fileBudgetAlert } = loadFilingLib();
  const store = memoryStore();
  const first = await fileBudgetAlert(alert(), store);
  const second = await fileBudgetAlert(alert({ currentSpend: 300 }), store);
  assert.equal(store.calls.create, 1);
  assert.equal(store.calls.comments, 1);
  assert.equal(first.taskId, second.taskId);
});

test("a failed owner email releases the claim so the next alert sends it", async () => {
  const { fileBudgetAlert } = loadFilingLib();
  const store = memoryStore();
  store.email = async () => {
    throw new Error("resend refused");
  };
  const full = alert({ currentSpend: 500, thresholdPercent: 100 });
  const failed = await fileBudgetAlert(full, store);
  assert.equal(failed.email, "failed");
  assert.equal(store.calls.releases, 1);
  const sent = [];
  store.email = async (taskId) => sent.push(taskId);
  const retried = await fileBudgetAlert(full, store);
  assert.equal(retried.email, "sent");
  assert.deepEqual(sent, [retried.taskId]);
});

test("an unconfigured webhook is refused and files nothing", async () => {
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
  const filed = [];
  const route = loadRoute({ onFile: (payload) => filed.push(payload) });
  const response = await route.POST(postRequest(JSON.stringify(documentedPayload())));
  assert.equal(response.status, 503);
  assert.equal(filed.length, 0);
});

test("an unsigned or forged alert is refused and files nothing", async () => {
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = "whsec_example";
  const filed = [];
  const route = loadRoute({ onFile: (payload) => filed.push(payload) });
  const body = JSON.stringify(documentedPayload());
  assert.equal((await route.POST(postRequest(body))).status, 401);
  assert.equal((await route.POST(postRequest(body, { "x-vercel-signature": sign("guess", body) }))).status, 401);
  assert.equal(filed.length, 0);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("a signed alert files one urgent ticket", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const filed = [];
  const route = loadRoute({ onFile: (payload) => filed.push(payload) });
  const body = JSON.stringify(documentedPayload());
  const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { taskId: 4242, created: true, email: "not-needed" });
  assert.equal(filed.length, 1);
  assert.equal(filed[0].thresholdPercent, 50);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("a full budget whose email failed answers retryable", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const route = loadRoute({ email: "failed" });
  const body = JSON.stringify(documentedPayload({ currentSpend: 500, thresholdPercent: 100 }));
  const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
  assert.equal(response.status, 503);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("an alert whose email already went out is acknowledged", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const route = loadRoute({ email: "already-sent" });
  const body = JSON.stringify(documentedPayload({ currentSpend: 500, thresholdPercent: 100 }));
  const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
  assert.equal(response.status, 200);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("a redelivered alert does not repeat its spend comment", async () => {
  const { fileBudgetAlert } = loadFilingLib();
  const store = memoryStore();
  const once = alert();
  await fileBudgetAlert(once, store);
  await fileBudgetAlert(once, store);
  assert.equal(store.calls.create, 1);
  assert.equal(store.calls.comments, 0);
  await fileBudgetAlert(alert({ currentSpend: 300 }), store);
  assert.equal(store.calls.comments, 1);
});

test("a failed comment write is retried by the next delivery", async () => {
  const { fileBudgetAlert } = loadFilingLib();
  const store = memoryStore();
  await fileBudgetAlert(alert(), store);
  store.addComment = async () => {
    throw new Error("comment write failed");
  };
  await assert.rejects(fileBudgetAlert(alert({ currentSpend: 300 }), store));
  store.addComment = async () => {
    store.calls.comments += 1;
  };
  await fileBudgetAlert(alert({ currentSpend: 300 }), store);
  assert.equal(store.calls.comments, 1);
});

test("a missing email claim is retryable, an occupied one is not", async () => {
  const { fileBudgetAlert } = loadFilingLib();
  const unavailable = memoryStore();
  unavailable.claimEmail = async () => "unavailable";
  const full = alert({ currentSpend: 500, thresholdPercent: 100 });
  assert.equal((await fileBudgetAlert(full, unavailable)).email, "failed");
  const occupied = memoryStore();
  await fileBudgetAlert(full, occupied);
  assert.equal((await fileBudgetAlert(full, occupied)).email, "already-sent");
});

test("the flag switches the intake off", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const filed = [];
  const route = loadRoute({ onFile: (payload) => filed.push(payload), flagOn: false });
  const body = JSON.stringify(documentedPayload());
  const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
  assert.equal(response.status, 503);
  assert.equal(filed.length, 0);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});

test("a signed but malformed alert is refused", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const filed = [];
  const route = loadRoute({ onFile: (payload) => filed.push(payload) });
  const body = JSON.stringify({ budgetAmount: 500, currentSpend: 250, teamId: "team_1" });
  const response = await route.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }));
  assert.equal(response.status, 400);
  assert.equal(filed.length, 0);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
});
