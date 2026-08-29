const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/settings-ai-usage-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const {
  aggregateGatewayByModel,
  aggregateGatewaySystemSpend,
  aggregateGatewayTeamUsage,
  aggregateGatewayByUserTag,
  buildGatewayMemberUsage,
  buildDisplayModelUsage,
  computePersonalTeamSharePct,
  gatewayBillingPeriodRange,
  reconcileLegacySystemUserSpend,
} = jiti(path.join(root, "src/app/api/settings/ai-usage/gatewayUsage.ts"));

test("aggregates daily per-team AI Gateway report rows", () => {
  assert.deepEqual(
    aggregateGatewayTeamUsage({
      results: [
        {
          cached_input_tokens: 10,
          input_tokens: 100,
          output_tokens: 20,
          reasoning_tokens: 5,
          request_count: 2,
          total_cost: 0.25,
        },
        {
          cached_input_tokens: 4,
          input_tokens: 50,
          output_tokens: 10,
          reasoning_tokens: 0,
          request_count: 1,
          total_cost: 0.1,
        },
      ],
    }),
    {
      cachedInputTokens: 14,
      inputTokens: 150,
      outputTokens: 30,
      reasoningTokens: 5,
      requestCount: 3,
      totalCost: 0.35,
    },
  );
});

test("aggregates and sorts AI Gateway usage by model", () => {
  assert.deepEqual(
    aggregateGatewayByModel({
      results: [
        { model: "google/gemini-flash", total_cost: "0.20" },
        { model: "anthropic/claude-sonnet", total_cost: 0.45 },
        { model: "google/gemini-flash", total_cost: 0.2 },
      ],
    }),
    [
      { model: "anthropic/claude-sonnet", totalCost: 0.45 },
      { model: "google/gemini-flash", totalCost: 0.4 },
    ],
  );
});

test("groups user tags and ignores feature and unknown tags", () => {
  assert.deepEqual(
    aggregateGatewayByUserTag({
      results: [
        { tag: "user:12", total_cost: "0.20" },
        { tag: "chat", total_cost: 0.45 },
        { tag: "user:7", total_cost: 0.4 },
        { tag: "user:12", total_cost: 0.15 },
        { tag: "user:not-a-number", total_cost: 5 },
      ],
    }),
    [
      { userId: 7, totalCost: 0.4 },
      { userId: 12, totalCost: 0.35 },
    ],
  );
});

test("returns no user usage when the tag report has no accrued data", () => {
  assert.deepEqual(aggregateGatewayByUserTag({ results: [] }), []);
});

test("system spend uses legacy feature tags without double-counting the stable tag", () => {
  assert.equal(
    aggregateGatewaySystemSpend({
      results: [
        { tag: "included-with-hypertask", total_cost: 0.4 },
        { tag: "summary", total_cost: 0.3 },
        { tag: "task-questions", total_cost: 0.1 },
        { tag: "chat", total_cost: 2 },
      ],
    }),
    0.4,
  );
  assert.equal(
    aggregateGatewaySystemSpend({
      results: [
        { tag: "summary", total_cost: 0.25 },
        { tag: "task-questions", total_cost: 0.15 },
      ],
    }),
    0.4,
  );
});

test("removes legacy automatic spend from member attribution", () => {
  const adjusted = reconcileLegacySystemUserSpend(
    [
      { userId: 7, totalCost: 6 },
      { userId: 12, totalCost: 4 },
    ],
    2,
  );

  assert.equal(
    adjusted.reduce((total, row) => total + row.totalCost, 0),
    8,
  );
  assert.ok(Math.abs(adjusted[0].totalCost - 4.8) < Number.EPSILON * 10);
  assert.equal(adjusted[1].totalCost, 3.2);
});

test("stable system spend does not reduce already-clean member tags", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          { tag: "user:7", total_cost: 5 },
          { tag: "summary", total_cost: 2 },
          { tag: "included-with-hypertask", total_cost: 2 },
        ],
      }),
    );

  try {
    const usage = await computePersonalTeamSharePct({
      allowanceUsd: 40,
      gatewayKey: "gateway-key",
      memberIds: [7],
      teamId: "team-1",
      userId: 7,
    });
    assert.equal(usage.userSharePct, 13);
  } finally {
    global.fetch = originalFetch;
  }
});

test("puts unknown users and unattributed spend into Other / agents", () => {
  assert.deepEqual(
    buildGatewayMemberUsage(
      [
        { displayName: "Alex", userId: 7 },
        { displayName: "Sam", userId: 12 },
      ],
      [
        { userId: 7, totalCost: 5 },
        { userId: 99, totalCost: 10 },
      ],
      20,
      20,
    ),
    [
      { displayName: "Other / agents", sharePct: 75, userId: null },
      { displayName: "Alex", sharePct: 25, userId: 7 },
      { displayName: "Sam", sharePct: 0, userId: 12 },
    ],
  );
});

test("keeps every member visible at zero spend when no tags have accrued", () => {
  assert.deepEqual(
    buildGatewayMemberUsage(
      [
        { displayName: "Alex", userId: 7 },
        { displayName: "Sam", userId: 12 },
      ],
      [],
      0,
      20,
    ),
    [
      { displayName: "Alex", sharePct: 0, userId: 7 },
      { displayName: "Sam", sharePct: 0, userId: 12 },
    ],
  );
});

test("shows tiny nonzero spend as at least 1%, never a flat 0%", () => {
  assert.deepEqual(
    buildGatewayMemberUsage(
      [{ displayName: "Alex", userId: 7 }],
      [{ userId: 7, totalCost: 0.009 }],
      0.009,
      8,
    ),
    [{ displayName: "Alex", sharePct: 1, userId: 7 }],
  );
});

test("computes personal team share from the shared gateway reports", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) =>
    new Response(
      JSON.stringify(
        String(url).includes("group_by=day")
          ? { results: [{ total_cost: 10 }] }
          : { results: [{ tag: "user:7", total_cost: 5 }] },
      ),
    );

  try {
    assert.deepEqual(
      await computePersonalTeamSharePct({
        gatewayKey: "gateway-key",
        memberIds: [7, 12],
        members: [
          { displayName: "Alex", userId: 7 },
          { displayName: "Sam", userId: 12 },
        ],
        teamId: "team-1",
        userId: 7,
      }),
      {
        memberCount: 2,
        memberUsage: [
          { displayName: "Alex", sharePct: 25, userId: 7 },
          { displayName: "Other / agents", sharePct: 25, userId: null },
          { displayName: "Sam", sharePct: 0, userId: 12 },
        ],
        userSharePct: 25,
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("builds the current calendar month-to-date UTC report range", () => {
  assert.deepEqual(
    gatewayBillingPeriodRange(new Date("2026-07-10T18:00:00Z")),
    {
      endDate: "2026-07-10",
      startDate: "2026-07-01",
    },
  );
});

test("labels direct BYOK models on the customer key", () => {
  assert.deepEqual(
    buildDisplayModelUsage(
      [
        { model: "openai/gpt-5.4-mini", totalCost: 0.75 },
        { model: "moonshotai/kimi-k2.5", totalCost: 0.25 },
      ],
      [
        "moonshotai/kimi-k2.5",
        { model: "@cf/meta/llama", provider: "byok:custom" },
      ],
    ),
    [
      { label: "gpt-5.4-mini", onYourKey: false, pct: 75 },
      { label: "kimi-k2.5", onYourKey: true, pct: 25 },
      { label: "@cf/meta/llama", onYourKey: true, pct: null },
    ],
  );
});
