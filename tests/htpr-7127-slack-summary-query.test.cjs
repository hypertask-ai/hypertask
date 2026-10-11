const test = require("node:test");
const assert = require("node:assert/strict");
const { actor, loadTs } = require("./slack-app-fixtures.cjs");

const FIELD_REF = { fieldRef: "lastMessageTs" };

function harness({ flagOn, rows }) {
  const queries = [];
  const { GET } = loadTs("src/app/api/cron/slack-thread-summaries/route.ts", {
    "@/lib/cronAuthorization": { hasValidCronAuthorization: () => true },
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 77 } },
    "@/lib/crypto/byokCipher": { decryptSecret: () => "token" },
    "@/lib/flags": { HTPR_7127_SLACK_SUMMARY_QUERY_FLAG: "htpr-7127-slack-summary-query", isFeatureEnabled: async () => flagOn },
    "@/utils/controllers/comments/createCommentService": { createCommentService: async () => {} },
    "@/lib/slack/threadSummary": { buildSlackThreadSummaryComment: async () => "Summary" },
    "@/lib/prisma": { __esModule: true, default: {
      slackWatchedThread: { fields: { lastMessageTs: FIELD_REF }, findMany: async (query) => { queries.push(query); return rows; }, update: async () => {} },
      user: { findUnique: async () => ({ id: 77 }) },
      task: { findMany: async () => [{ id: 10, projectId: 15, userId: 42 }] },
    } },
  });
  return { GET, queries };
}

const thread = { id: "t1", lastMessageTs: "1.0", lastSummarizedTs: null, matchedTaskIds: [10], channelId: "C1", threadTs: "1.0", install: { teamId: actor.teamId, installedByUserId: 6, encryptedBotToken: "x", team: { aiProviderSettings: {} } } };

test("flag on: the query excludes threads that are already summarized", async () => {
  const { GET, queries } = harness({ flagOn: true, rows: [thread] });
  assert.equal((await GET(new Request("https://app.hypertask.ai/api/cron/slack-thread-summaries"))).status, 200);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].where.OR, [
    { lastSummarizedTs: null },
    { lastSummarizedTs: { lt: FIELD_REF } },
  ]);
  assert.ok(queries[0].where.lastMessageTs.lte);
  assert.equal(queries[0].take, 50);
});

test("flag off: the old query shape is kept", async () => {
  const { GET, queries } = harness({ flagOn: false, rows: [thread] });
  await GET(new Request("https://app.hypertask.ai/api/cron/slack-thread-summaries"));
  assert.equal(queries[0].where.OR, undefined);
});

test("the JS guard still drops a returned thread that is not due", async () => {
  const done = { ...thread, lastSummarizedTs: "1.0" };
  const { GET } = harness({ flagOn: true, rows: [done] });
  const body = await (await GET(new Request("https://app.hypertask.ai/api/cron/slack-thread-summaries"))).json();
  assert.equal(body.candidates, 0);
});
