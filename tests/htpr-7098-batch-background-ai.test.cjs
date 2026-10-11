// HTPR-7098: Slack summaries and smart label backfills wait in a half-price gateway batch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const load = createJiti(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false, interopDefault: true });
const FLAG = "htpr-7098-batch-background-ai";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const jobs = load(path.join(root, "src/lib/ai/batch/batchJobs.ts"));
const { needsSlackThreadSummary } = load(path.join(root, "src/lib/slack/idle.ts"));
const { modelCostUsd } = load(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"));

const SUMMARY_JSON = JSON.stringify({ outcome: "Ship on Friday", bullets: ["Docs first", "QA signs off"] });
const succeeded = (id, text, usage = {}) => ({ id, status: "succeeded", text, usage: { inputTokens: 1000, outputTokens: 100, inputTokenDetails: usage } });

test("flag: feature kind, release risk, default Owner + QA, key exported", () => {
  const keys = load(path.join(root, "src/lib/flags/keys.ts"));
  assert.equal(keys.HTPR_7098_BATCH_BACKGROUND_AI_FLAG, FLAG);
  const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7098-batch-background-ai.ts"));
  assert.equal(definition.default?.key ?? definition.key, FLAG);
  const source = read("src/lib/flags/definitions/htpr-7098-batch-background-ai.ts");
  assert.match(source, /kind: "feature"/);
  assert.match(source, /shippedOn: "2026-10-11"/);
  assert.match(source, /releaseRisk/);
  assert.doesNotMatch(source, /defaultMode/); // no override: the registry default applies
  assert.match(read("src/lib/flags.ts"), /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
});

test("flag gate reads the flag for the real user and counts a failed read as Off", () => {
  const source = read("src/app/api/ai/_lib/planGate.ts");
  assert.match(source, /isFeatureEnabled\(HTPR_7098_BATCH_BACKGROUND_AI_FLAG, userId \?\? 0\)/);
  assert.match(source, /batchBackgroundAiEnabled[\s\S]*?catch \{\s*return false;/);
  assert.match(read("src/app/api/cron/slack-thread-summaries/route.ts"), /batchBackgroundAiEnabled\(thread\.install\.installedByUserId\)/);
  assert.match(read("src/lib/ai/labelClassifier.ts"), /batchBackgroundAiEnabled\(userId\)/);
});

test("slack request: same prompt as the instant path plus a JSON instruction, tagged like the instant call", () => {
  const { SLACK_SUMMARY_SYSTEM, slackSummaryPrompt } = load(path.join(root, "src/lib/slack/threadSummaryPrompt.ts"));
  const providerOptions = jobs.batchProviderOptions("summary", { teamId: "team-1", projectId: 9, userId: 4 });
  const request = jobs.buildSlackSummaryBatchRequest({ id: "thread-1", model: "anthropic/claude-haiku-5.5", transcript: "[1] Ann: hi", providerOptions });
  assert.equal(request.id, "thread-1");
  assert.equal(request.type, "text");
  assert.equal(request.model, "anthropic/claude-haiku-5.5");
  assert.equal(request.maxOutputTokens, 400);
  assert.equal(request.prompt, slackSummaryPrompt("[1] Ann: hi"));
  assert.ok(request.instructions.startsWith(SLACK_SUMMARY_SYSTEM));
  assert.match(request.instructions, /ONLY a JSON object/);
  // System features carry the included tag and never a user tag.
  assert.deepEqual(request.providerOptions, { gateway: { tags: ["summary", "included-with-hypertask", "team:team-1", "board:9"] } });
});

test("label request: same prompt as classifyTaskAgainstLabels, user tag kept", () => {
  const { LABEL_CLASSIFIER_INSTRUCTIONS, labelClassifierPrompt } = load(path.join(root, "src/lib/ai/labelClassifierOutput.ts"));
  const definitions = [{ labelId: "L1", prompt: "Anything about billing" }];
  const task = { title: "Fix invoice", description: "x".repeat(5000) };
  const request = jobs.buildSmartLabelBatchRequest({
    id: "t7", model: "google/gemini-3.1-flash-lite", task, definitions,
    providerOptions: jobs.batchProviderOptions("smart-label", { teamId: "team-1", projectId: 2, userId: 4 }),
  });
  assert.equal(request.instructions, LABEL_CLASSIFIER_INSTRUCTIONS);
  assert.equal(request.prompt, labelClassifierPrompt(task, definitions));
  assert.equal(request.maxOutputTokens, 500);
  assert.ok(request.prompt.length < 5000 + 400); // description still cut at 2,000 characters
  assert.deepEqual(request.providerOptions.gateway.tags, ["smart-label", "team:team-1", "board:2", "user:4"]);
  // The instant path sends the same text.
  const classifier = read("src/lib/ai/labelClassifier.ts");
  assert.match(classifier, /prompt: labelClassifierPrompt\(task, definitions\)/);
});

test("grouping: one batch per team and model, at most 1,000 requests each", () => {
  const groups = jobs.groupByKey([{ k: "a" }, { k: "b" }, { k: "a" }], (entry) => entry.k);
  assert.deepEqual([...groups.keys()], ["a", "b"]);
  assert.equal(groups.get("a").length, 2);
  const chunks = jobs.chunkForBatch(Array.from({ length: 2300 }, (_, index) => index));
  assert.deepEqual(chunks.map((chunk) => chunk.length), [1000, 1000, 300]);
});

test("results: succeeded keeps usage and cache tokens, missing items count as failed", () => {
  const outcomes = jobs.outcomesForItems(["a", "b", "c", "d"], [
    succeeded("a", SUMMARY_JSON, { cacheReadTokens: 600, cacheWriteTokens: 200 }),
    { id: "b", status: "failed" },
    { id: "c", status: "expired" },
  ]);
  assert.equal(outcomes[0].status, "succeeded");
  assert.deepEqual(outcomes[0].usage, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 600, cacheWriteInputTokens: 200 });
  assert.deepEqual(outcomes.slice(1).map(({ status }) => status), ["failed", "expired", "failed"]);
  assert.equal(jobs.outcomesForItems(["a"], [succeeded("a", "x")])[0].usage.cachedInputTokens, null);
});

test("slack apply mapping: valid JSON becomes the same comment HTML, failed/expired/garbage retry", () => {
  const item = { participants: ["Ann"], permalink: "https://example.slack.com/archives/C1/p1" };
  const ok = jobs.slackActionForOutcome({ id: "a", status: "succeeded", text: "```json\n" + SUMMARY_JSON + "\n```", usage: {} }, item);
  assert.equal(ok.type, "comment");
  const { renderSlackSummaryComment } = load(path.join(root, "src/lib/slack/threadSummaryPrompt.ts"));
  assert.equal(ok.html, renderSlackSummaryComment(JSON.parse(SUMMARY_JSON), ["Ann"], item.permalink));
  assert.match(ok.html, /<strong>Ship on Friday\.<\/strong>/);
  for (const status of ["failed", "expired", "cancelled"]) {
    assert.deepEqual(jobs.slackActionForOutcome({ id: "a", status }, item), { type: "retry" });
  }
  for (const text of ["not json", '{"outcome":"x","bullets":["only one"]}', "{}"]) {
    assert.deepEqual(jobs.slackActionForOutcome({ id: "a", status: "succeeded", text, usage: {} }, item), { type: "retry" });
  }
});

test("summarized mark only moves forward", () => {
  assert.equal(jobs.nextSummarizedTs(null, "100.000001"), "100.000001");
  assert.equal(jobs.nextSummarizedTs("100.000001", "200.000001"), "200.000001");
  assert.equal(jobs.nextSummarizedTs("300.000001", "200.000001"), "300.000001");
});

test("label apply mapping: verdict keeps the stored prompt, failures and unparsable output skip", () => {
  const item = { labelId: "L1", promptAtSubmit: "Billing" };
  const verdict = jobs.labelActionForOutcome({ id: "t1", status: "succeeded", text: '["L1","other"]', usage: {} }, item);
  assert.deepEqual(verdict, { type: "verdict", matchingLabelIds: ["L1"], definitions: [{ labelId: "L1", prompt: "Billing" }] });
  const none = jobs.labelActionForOutcome({ id: "t1", status: "succeeded", text: "[]", usage: {} }, item);
  assert.deepEqual(none.matchingLabelIds, []);
  assert.deepEqual(jobs.labelActionForOutcome({ id: "t1", status: "succeeded", text: "nope", usage: {} }, item), { type: "skip" });
  for (const status of ["failed", "expired", "cancelled"]) {
    assert.deepEqual(jobs.labelActionForOutcome({ id: "t1", status }, item), { type: "skip" });
  }
  // The collector hands the stored snapshot time to the same verdict function, so its stale check stays intact.
  const collector = read("src/lib/ai/batch/collectBatches.ts");
  assert.match(collector, /contentHash: item\.contentHash/);
  assert.match(read("src/lib/ai/labelClassifier.ts"), /export async function applyAiLabelVerdict/);
});

test("cost: half of the normal price, cache tokens priced first, unknown stays unknown", () => {
  const pricing = { inputUsdPerToken: 0.000003, outputUsdPerToken: 0.000015 };
  const normal = modelCostUsd(pricing, 1000, 100, 600, 200);
  assert.equal(jobs.batchCostUsd(normal), normal * 0.5);
  assert.equal(jobs.batchCostUsd(0), 0);
  assert.equal(jobs.batchCostUsd(null), null);
  const row = jobs.buildBatchUsageRow({
    kind: "slack-summary", userId: 4, teamId: "t", projectId: 9, taskId: 12, model: "anthropic/claude-haiku-5.5",
    usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 600, cacheWriteInputTokens: 200 }, normalCostUsd: normal,
  });
  assert.equal(row.provider, "gateway-batch");
  assert.equal(row.feature, "summary");
  assert.equal(row.costUsd, normal * 0.5);
  assert.equal(row.cachedInputTokens, 600);
  assert.equal(row.cacheWriteInputTokens, 200);
  assert.equal(row.totalTokens, 1100);
  assert.equal(jobs.buildBatchUsageRow({ kind: "smart-label", userId: 4, teamId: "t", projectId: null, taskId: null, model: "m", usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: null, cacheWriteInputTokens: null }, normalCostUsd: null }).feature, "smart-label");
});

test("only platform-managed keys batch; shared (capped) and customer keys keep the instant path", () => {
  assert.equal(jobs.batchEligibleFunding("managed"), true);
  assert.equal(jobs.batchEligibleFunding("shared"), false);
  assert.equal(jobs.batchEligibleFunding("customer"), false);
  assert.match(read("src/lib/slack/threadSummaryBatch.ts"), /batchEligibleFunding\(gatewayFundingSourceForApiKey/);
  assert.match(read("src/lib/ai/labelClassifier.ts"), /batchEligibleFunding\(gatewayFundingSourceForApiKey/);
});

test("only Anthropic models batch; other models stay on the instant path", () => {
  assert.equal(jobs.batchEligibleModel("anthropic/claude-haiku-5.5"), true);
  assert.equal(jobs.batchEligibleModel("google/gemini-3.1-flash-lite"), false);
  assert.equal(jobs.batchEligibleModel("openai/gpt-6-luna"), false);
  assert.match(read("src/lib/slack/threadSummaryBatch.ts"), /!batchEligibleModel\(model\)/);
  assert.match(read("src/lib/ai/labelClassifier.ts"), /if \(!batchEligibleModel\(model\)\) return false;/);
});

test("a bad Slack item runs the instant path once and is not batched again", async () => {
  const item = { participants: ["Ann"], permalink: "https://example.slack.com/archives/C1/p1" };
  const bad = [
    { id: "a", status: "failed" },
    { id: "a", status: "expired" },
    { id: "a", status: "cancelled" },
    { id: "a", status: "succeeded", text: "not json", usage: {} },
  ];
  for (const outcome of bad) {
    let calls = 0;
    const result = await jobs.slackHtmlWithInstantFallback(outcome, item, async () => { calls += 1; return "<p>instant</p>"; });
    assert.deepEqual(result, { type: "comment", html: "<p>instant</p>", via: "instant" });
    assert.equal(calls, 1);
  }
  // A good item never touches the instant path.
  let goodCalls = 0;
  const good = await jobs.slackHtmlWithInstantFallback({ id: "a", status: "succeeded", text: SUMMARY_JSON, usage: {} }, item, async () => { goodCalls += 1; return "x"; });
  assert.equal(good.via, "batch");
  assert.equal(goodCalls, 0);
  // Instant failure: reported as failed (the cron's behavior), nothing thrown, nothing posted.
  assert.deepEqual(await jobs.slackHtmlWithInstantFallback(bad[0], item, async () => { throw new Error("boom"); }), { type: "failed" });
  assert.deepEqual(await jobs.slackHtmlWithInstantFallback(bad[0], item, async () => null), { type: "empty" });
  // The collector uses the normal instant builder and never re-queues a batch.
  const collector = read("src/lib/ai/batch/collectBatches.ts");
  assert.match(collector, /buildSlackThreadSummaryComment\(/);
  assert.doesNotMatch(collector, /threadSummaryBatch|submitBatch|prepareSlackSummaryForBatch/);
});

test("stuck batches rotate and stale errors are final (review 1)", () => {
  const collector = read("src/lib/ai/batch/collectBatches.ts");
  // Least recently checked first, never-checked first, and the look is recorded before any gateway call.
  assert.match(collector, /orderBy: \{ lastCheckedAt: \{ sort: "asc", nulls: "first" \} \}/);
  assert.ok(collector.indexOf("data: { lastCheckedAt: new Date() }") < collector.indexOf("await planBatch(batch, itemIds, stale)"));
  // Any error from the key, status or results calls is rethrown only while the batch is fresh.
  assert.match(collector, /catch \(error\) \{\s*\/\/[^\n]*\n\s*if \(!stale\) throw error;[\s\S]*?finalStatus: "cancelled"/);
  // A cancelled stale batch still runs the apply step, which clears every thread's summaryBatchId.
  assert.match(collector, /await applySlackBatch\(batch, items, plan\.outcomes\)/);
  assert.match(read("src/prisma/schema.prisma"), /lastCheckedAt\s+DateTime\?/);
  const sql = read("src/prisma/migrations/20261011120000_htpr_7098_ai_batch/migration.sql");
  assert.match(sql, /"lastCheckedAt" TIMESTAMP\(3\)/);
  assert.match(sql, /"claimedAt" TIMESTAMP\(3\)/);
  assert.match(sql, /SlackWatchedThread_summaryBatchId_idx/);
});

test("label batch verdicts are judged by content, not updatedAt (review 2)", () => {
  const same = jobs.labelTaskContentHash({ title: "Fix invoice", description: "Customer asks" });
  assert.equal(same, jobs.labelTaskContentHash({ title: "Fix invoice", description: "Customer asks" }));
  assert.notEqual(same, jobs.labelTaskContentHash({ title: "Fix invoice!", description: "Customer asks" }));
  assert.notEqual(same, jobs.labelTaskContentHash({ title: "Fix invoice", description: "Customer asks more" }));
  const classifier = read("src/lib/ai/labelClassifier.ts");
  // Hash mode skips the updatedAt comparison and the updatedAt lock clause; instant mode keeps both.
  assert.match(classifier, /if \(currentHash !== contentHash\) return;\s*\} else if \(currentTask\.updatedAt\.getTime\(\) > snapshotAt\.getTime\(\)\) return;/);
  assert.match(classifier, /const lockedTasks = contentHash\s*\?[\s\S]*?:[\s\S]*?"updatedAt" <= \$\{snapshotAt\}/);
  assert.match(read("src/lib/ai/labelClassifierBatch.ts"), /contentHash: labelTaskContentHash\(task\)/);
});

test("slack comment is checked against the batch mark before posting (review 4)", () => {
  const collector = read("src/lib/ai/batch/collectBatches.ts");
  const slack = collector.slice(collector.indexOf("async function applySlackBatch"), collector.indexOf("async function applyLabelBatch"));
  const check = slack.indexOf("marked?.summaryBatchId !== batch.id");
  assert.ok(check > 0);
  assert.ok(check < slack.indexOf("createCommentService({"));
  assert.ok(check < slack.indexOf("await logUsage"));
  assert.equal(slack.includes("thread?.summaryBatchId !== batch.id"), false); // no late check left
});

test("submit is idempotent per chunk (review 5)", () => {
  const requests = [{ id: "b", prompt: "two" }, { id: "a", prompt: "one" }];
  const key = jobs.batchIdempotencyKey("slack-summary", "team-1", requests);
  assert.equal(key, jobs.batchIdempotencyKey("slack-summary", "team-1", [...requests].reverse())); // order independent
  assert.match(key, /^htpr-7098:slack-summary:team-1:[0-9a-f]{32}$/);
  assert.notEqual(key, jobs.batchIdempotencyKey("smart-label", "team-1", requests));
  assert.notEqual(key, jobs.batchIdempotencyKey("slack-summary", "team-2", requests));
  assert.notEqual(key, jobs.batchIdempotencyKey("slack-summary", "team-1", [{ id: "a", prompt: "one grew" }, requests[0]]));
  assert.match(read("src/lib/ai/batch/gatewayBatch.ts"), /providerOptions: \{ gateway: \{ idempotencyKey \} \}/);
  assert.match(read("src/lib/ai/batch/submitBatch.ts"), /batchIdempotencyKey\(args\.kind, args\.teamId, args\.requests\)/);
  assert.match(read("src/lib/ai/batch/submitBatch.ts"), /prisma\.aiBatch\.upsert/); // a replayed start reuses the recorded row
});

test("applying claim, time budget and partial results of a failed batch (review 3, 6)", () => {
  const collector = read("src/lib/ai/batch/collectBatches.ts");
  assert.match(collector, /data: \{ status: "applying", claimedAt: new Date\(\) \}/);
  assert.match(collector, /APPLY_RECLAIM_MS = 15 \* 60 \* 1000/);
  assert.match(collector, /Date\.now\(\) - nowMs > MAX_RUN_MS/);
  assert.match(collector, /MAX_RUN_MS = 240 \* 1000/);
  assert.match(collector, /state === "failed"[\s\S]*?gatewayBatchOutcomes\([^)]*\)\.catch\(\(\) => allFailed\)/);
});

test("stale batches: older than 25 hours are cancelled and released", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  assert.equal(jobs.isBatchStale(new Date(now - 24 * 3600e3), now), false);
  assert.equal(jobs.isBatchStale(new Date(now - 25 * 3600e3 - 1), now), true);
  const collector = read("src/lib/ai/batch/collectBatches.ts");
  assert.match(collector, /cancelGatewayBatch/);
  assert.match(collector, /data: \{ status: plan\.finalStatus, completedAt/);
});

test("needsSlackThreadSummary skips threads already waiting in a batch", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const old = String((now - 3 * 3600e3) / 1000);
  assert.equal(needsSlackThreadSummary({ lastMessageTs: old, lastSummarizedTs: null }, now), true);
  assert.equal(needsSlackThreadSummary({ lastMessageTs: old, lastSummarizedTs: null, summaryBatchId: null }, now), true);
  assert.equal(needsSlackThreadSummary({ lastMessageTs: old, lastSummarizedTs: null, summaryBatchId: "batch-1" }, now), false);
  // The cron also leaves pending threads out of its 50-thread page.
  assert.match(read("src/app/api/cron/slack-thread-summaries/route.ts"), /summaryBatchId: null/);
});

test("schema, migration and cron are wired", () => {
  const schema = read("src/prisma/schema.prisma");
  assert.match(schema, /model AiBatch \{[\s\S]*gatewayBatchId String\s+@unique/);
  assert.match(schema, /summaryBatchId\s+String\?/);
  const dirs = fs.readdirSync(path.join(root, "src/prisma/migrations")).filter((name) => name.includes("htpr_7098"));
  assert.equal(dirs.length, 1);
  const sql = read(`src/prisma/migrations/${dirs[0]}/migration.sql`);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "AiBatch"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "summaryBatchId"/);
  assert.match(sql, /lock_timeout/); // does not queue Slack queries behind the ALTER (HTPR-7076 lesson)
  assert.doesNotMatch(sql, /^ALTER TABLE/m); // only inside the guarded block
  const cron = JSON.parse(read("vercel.json")).crons.find((entry) => entry.path === "/api/cron/ai-batches");
  assert.equal(cron.schedule, "*/5 * * * *");
  assert.match(read("src/app/api/cron/ai-batches/route.ts"), /hasValidCronAuthorization/);
});
