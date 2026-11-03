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

function fakeRedis() {
  const kv = new Map();
  return {
    kv,
    async set(key, value, _mode, _ttl, nx) {
      if (nx === "NX" && kv.has(key)) return null;
      kv.set(key, value);
      return "OK";
    },
    async get(key) {
      return kv.get(key) ?? null;
    },
    async del(key) {
      kv.delete(key);
    },
  };
}

function fakeBoard() {
  const descriptions = [];
  const comments = [];
  const state = { createFails: false, creates: 0 };
  const prisma = {
    task: {
      async findFirst({ where }) {
        const marker = where.description_.is.content.contains;
        const found = descriptions.findIndex((text) => text.includes(marker));
        return found === -1 ? null : { id: 100 + found };
      },
    },
    project: {
      async findFirst() {
        return {
          uniqueIdentifier: "HTPR",
          section: [{ id: 4389, section_title: "Bugs" }],
          labels: [{ id: "label-infra" }],
        };
      },
    },
    comment: {
      async create({ data }) {
        comments.push(data);
        return data;
      },
    },
  };
  const createProvisionedTaskCore = async (options) => {
    if (state.createFails) throw new Error("board unavailable");
    state.creates += 1;
    descriptions.push(options.description);
    return { task: { id: 99 + descriptions.length }, description: {} };
  };
  return { prisma, createProvisionedTaskCore, comments, state };
}

function loadFiler({ redis = fakeRedis(), board = fakeBoard(), send = null } = {}) {
  const sent = [];
  return loadModule("src/lib/ops/fileVercelBudgetTicket.ts", {
    "@/lib/prisma": { default: board.prisma },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/email/sendEmail": {
      sendEmail: async (message) => {
        sent.push(message);
        if (send) return send(message, sent.length);
        return { id: "email" };
      },
    },
    "@/utils/controllers/tasks/createTaskCore": {
      createProvisionedTaskCore: board.createProvisionedTaskCore,
    },
  }).fileVercelBudgetTicket;
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
      BudgetAlertRaceError: class BudgetAlertRaceError extends Error {},
      BudgetAlertPendingError: class BudgetAlertPendingError extends Error {},
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

test("each threshold, budget and scope gets its own marker", () => {
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

test("two deliveries of one alert file one ticket", async () => {
  const board = fakeBoard();
  const filer = loadFiler({ board });
  const one = alert({ thresholdPercent: 100 });
  const results = await Promise.all([filer(one), filer(one)]);
  assert.equal(board.state.creates, 1);
  assert.equal(new Set(results.map((result) => result.taskId)).size, 1);
  assert.equal(results.filter((result) => result.created).length, 1);
});

test("a repeat alert records the new spend once", async () => {
  const board = fakeBoard();
  const filer = loadFiler({ board });
  const first = await filer(alert());
  assert.equal(board.comments.length, 0);
  const second = await filer(alert({ currentSpend: 300 }));
  assert.equal(first.taskId, second.taskId);
  assert.equal(board.comments.length, 1);
  await filer(alert({ currentSpend: 300 }));
  assert.equal(board.comments.length, 1);
});

test("an alert whose comment write failed is retried by the next delivery", async () => {
  const board = fakeBoard();
  const filer = loadFiler({ board });
  await filer(alert());
  const create = board.prisma.comment.create;
  board.prisma.comment.create = async () => {
    throw new Error("comment write failed");
  };
  await assert.rejects(filer(alert({ currentSpend: 300 })));
  board.prisma.comment.create = create;
  await filer(alert({ currentSpend: 300 }));
  assert.equal(board.comments.length, 1);
});

test("a failed ticket write releases its claims so a retry files", async () => {
  const board = fakeBoard();
  const filer = loadFiler({ board });
  board.state.createFails = true;
  await assert.rejects(filer(alert()));
  board.state.createFails = false;
  const retried = await filer(alert());
  assert.equal(retried.created, true);
  assert.equal(board.state.creates, 1);
});

test("a full budget emails the owner once", async () => {
  const sent = [];
  const board = fakeBoard();
  const filer = loadFiler({
    board,
    send: async (message) => {
      sent.push(message);
      return { id: "email" };
    },
  });
  const full = alert({ currentSpend: 500, thresholdPercent: 100 });
  assert.equal((await filer(full)).email, "sent");
  assert.equal((await filer(full)).email, "already-sent");
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /100%/);
  assert.match(sent[0].text, /\$500\.00 of \$500\.00/);
});

test("a failed owner email is retried, not swallowed", async () => {
  const board = fakeBoard();
  let attempts = 0;
  const filer = loadFiler({
    board,
    send: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("resend refused");
      return { id: "email" };
    },
  });
  const full = alert({ currentSpend: 500, thresholdPercent: 100 });
  assert.equal((await filer(full)).email, "failed");
  assert.equal((await filer(full)).email, "sent");
  assert.equal(attempts, 2);
});

test("below the full budget no email is sent", async () => {
  const sent = [];
  const filer = loadFiler({ send: async (message) => sent.push(message) });
  assert.equal((await filer(alert({ thresholdPercent: 75 }))).email, "not-needed");
  assert.equal(sent.length, 0);
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

test("a failed owner email answers retryable, a sent one does not", async () => {
  const secret = "whsec_example";
  process.env.VERCEL_BUDGET_WEBHOOK_SECRET = secret;
  const body = JSON.stringify(documentedPayload({ currentSpend: 500, thresholdPercent: 100 }));
  const failed = loadRoute({ email: "failed" });
  assert.equal((await failed.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }))).status, 503);
  const sent = loadRoute({ email: "already-sent" });
  assert.equal((await sent.POST(postRequest(body, { "x-vercel-signature": sign(secret, body) }))).status, 200);
  delete process.env.VERCEL_BUDGET_WEBHOOK_SECRET;
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
