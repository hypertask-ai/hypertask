const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function stubPackage(name, exports) {
  const filename = require.resolve(name, { paths: [root] });
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadTaskSummaries() {
  const jiti = require("jiti")(path.join(root, "tests/task-summaries-entry.cjs"), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, "src/app/api/ai/_lib/taskSummaries.ts"));
}

test("task summary and description verdict share one model request", async () => {
  let generateCalls = 0;
  let generationError = null;
  let invalidStructuredText = null;
  let gatewayApiKey = "vck_team_hypertask";
  let gatewayLookupError = null;
  let redisAvailable = true;
  let retryScheduleBusy = false;
  let retryScheduleError = null;
  let existingSummary = null;
  const redisValues = new Map();
  const comments = [
    {
      id: 1,
      text: "<p>A concrete decision</p>",
      activity: null,
      createdAt: new Date("2026-08-08T00:00:00.000Z"),
      creator: { displayName: "Valentin", email: null },
    },
  ];
  const usageRows = [];
  const summaryWrites = [];
  const descriptionWrites = [];
  const scheduledRetries = [];

  stubPackage("ai", {
    generateObject: async (request) => {
      generateCalls += 1;
      assert.equal(request.model, "team-model");
      assert.match(request.system, /Return both the task briefing and the description-quality verdict/);
      assert.match(request.prompt, /Task description:\nA useful description/);
      assert.match(request.prompt, /A concrete decision/);
      assert.deepEqual(request.providerOptions, {
        gateway: { tags: ["summary", "team:team-hypertask"] },
      });
      assert.ok(request.abortSignal instanceof AbortSignal);
      assert.equal(request.abortSignal.aborted, false);
      if (generationError) throw generationError;
      if (invalidStructuredText !== null) {
        throw {
          name: "AI_NoObjectGeneratedError",
          text: invalidStructuredText,
          usage: { inputTokens: 130, outputTokens: 45, totalTokens: 175 },
          cause: new Error("descriptionGoodEnough must be boolean"),
        };
      }
      return {
        object: {
          summary: "## What this is\n- One call does both jobs\n\n## Recent activity\n- A concrete decision",
          descriptionGoodEnough: true,
        },
        usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
      };
    },
    NoObjectGeneratedError: {
      isInstance: (error) => error?.name === "AI_NoObjectGeneratedError",
    },
  });
  stubModule("src/lib/prisma.ts", {
    default: {
      $transaction: async (operations) => Promise.all(operations),
      task: {
        findUnique: async () => ({
          id: 42,
          userId: 6,
          agentId: null,
          projectId: 15,
          title: "Deduplicate summaries",
          ticketNumber: "HTPR-5180",
          project: {
            teamId: "team-hypertask",
            team: { aiProviderSettings: {} },
          },
          description_: { content: "<p>A useful description</p>" },
          Task_Summary: existingSummary
            ? [{ content: existingSummary }]
            : [],
          comments,
        }),
      },
      task_Summary: {
        upsert: async (args) => {
          summaryWrites.push(args);
          existingSummary = args.update.content;
        },
      },
      description: {
        updateMany: async (args) => descriptionWrites.push(args),
      },
    },
  });
  stubModule("src/lib/redis.ts", {
    getRedis: async () => {
      if (!redisAvailable) throw new Error("redis unavailable");
      return {
        set: async (key, value, ...options) => {
          if (options.includes("NX") && redisValues.has(key)) return null;
          redisValues.set(key, value);
          return "OK";
        },
        get: async (key) => redisValues.get(key) ?? null,
        eval: async (_script, _keyCount, key, token) => {
          if (redisValues.get(key) !== token) return 0;
          redisValues.delete(key);
          return 1;
        },
      };
    },
  });
  stubModule("src/lib/qstash.ts", {
    scheduleJobById: async (job) => {
      if (retryScheduleError) throw retryScheduleError;
      if (retryScheduleBusy) return undefined;
      scheduledRetries.push(job);
      return { messageId: `retry-${scheduledRetries.length}` };
    },
  });
  stubModule("src/app/api/ai/_lib/aiUsage.ts", {
    logAiUsage: async (row) => usageRows.push(row),
  });
  stubModule("src/app/api/ai/_lib/byokKeys.ts", {
    getTeamGatewayApiKey: async (lookup) => {
      assert.deepEqual(lookup, { trustedTeamId: "team-hypertask" });
      if (gatewayLookupError) throw gatewayLookupError;
      return gatewayApiKey;
    },
  });
  stubModule("src/app/api/ai/_lib/modelProvider.ts", {
    resolveAiModel: (provider, model, credential) => {
      assert.equal(provider, "gateway");
      assert.equal(model, "google/gemini-test");
      assert.equal(credential, "vck_team_hypertask");
      return "team-model";
    },
    providerOptionsForAiModel: (_model, feature, tags) => ({
      gateway: { tags: [feature, `team:${tags.teamId}`] },
    }),
  });
  stubModule("src/app/api/ai/_lib/systemModelLadder.ts", {
    resolveSystemModel: () => ({
      provider: "google",
      model: "google/gemini-test",
    }),
  });
  stubModule("src/app/api/ai/_lib/taskContent.ts", {
    convertHtmlToText: (value) => value.replace(/<[^>]+>/g, "").trim(),
    isSessionNoise: (value) => value.includes("SESSION_NOISE"),
  });

  const {
    generateAndStoreTaskSummary,
    SummaryConcurrencyUnavailableError,
    SummaryGenerationTimeoutError,
    SummaryRetryableError,
    SummaryRetrySchedulingError,
  } = loadTaskSummaries();
  const summary = await generateAndStoreTaskSummary(42);

  assert.equal(generateCalls, 1);
  assert.match(summary, /One call does both jobs/);
  assert.equal(summaryWrites.length, 1);
  assert.match(
    summaryWrites[0].update.content,
    /\[hypertask-summary-fingerprint\]: # \([a-f0-9]{64}\)$/,
  );
  assert.equal(descriptionWrites.length, 1);
  assert.equal(descriptionWrites[0].data.flaggedIncomplete, true);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].totalTokens, 160);
  assert.equal(usageRows[0].taskId, 42);
  assert.equal(usageRows[0].agentId, null);

  comments.unshift({
    id: 2,
    text: "<p>SESSION_NOISE</p>",
    activity: null,
    createdAt: new Date("2026-08-08T01:00:00.000Z"),
    creator: { displayName: "Automation", email: null },
  });
  const duplicate = await generateAndStoreTaskSummary(42);
  assert.equal(duplicate, summary);
  assert.equal(generateCalls, 1);
  assert.equal(summaryWrites.length, 1);
  assert.equal(usageRows.length, 1);

  redisValues.set("ai-summary:lock:42", "another-worker");
  const concurrentDuplicate = await generateAndStoreTaskSummary(42, {
    force: true,
  });
  assert.equal(concurrentDuplicate, null);
  assert.equal(generateCalls, 1);
  assert.equal(scheduledRetries.length, 1);
  assert.deepEqual(
    {
      jobId: scheduledRetries[0].jobId,
      path: scheduledRetries[0].path,
      body: scheduledRetries[0].body,
    },
    {
      jobId: "ai-summary-retry-for-taskId:42",
      path: "/api/queues/FAST/generateSummaryQueue",
      body: { taskId: 42 },
    },
  );
  const retryDelay = scheduledRetries[0].notBefore - Math.floor(Date.now() / 1000);
  assert.ok(retryDelay >= 44 && retryDelay <= 75);

  retryScheduleError = new Error("qstash unavailable");
  await assert.rejects(
    () => generateAndStoreTaskSummary(42, { force: true }),
    (error) =>
      error instanceof SummaryRetrySchedulingError &&
      error.cause === retryScheduleError,
  );
  assert.equal(generateCalls, 1);
  retryScheduleError = null;

  retryScheduleBusy = true;
  await assert.rejects(
    () => generateAndStoreTaskSummary(42, { force: true }),
    (error) =>
      error instanceof SummaryRetrySchedulingError &&
      error.cause instanceof Error &&
      error.cause.message.includes("scheduling lock is busy"),
  );
  assert.equal(generateCalls, 1);
  retryScheduleBusy = false;
  redisValues.delete("ai-summary:lock:42");

  redisAvailable = false;
  await assert.rejects(
    () => generateAndStoreTaskSummary(42, { force: true }),
    (error) =>
      error instanceof SummaryConcurrencyUnavailableError &&
      error instanceof SummaryRetryableError,
  );
  assert.equal(generateCalls, 1);
  redisAvailable = true;

  gatewayApiKey = undefined;
  const missingKey = await generateAndStoreTaskSummary(42, { force: true });
  assert.equal(missingKey, null);
  assert.equal(generateCalls, 1);
  assert.equal(summaryWrites.length, 1);
  assert.equal(descriptionWrites.length, 1);
  assert.equal(usageRows.length, 1);

  gatewayApiKey = "vck_team_hypertask";
  gatewayLookupError = new Error("key store unavailable");
  const keyLookupFailed = await generateAndStoreTaskSummary(42, {
    force: true,
  });
  assert.equal(keyLookupFailed, null);
  assert.equal(generateCalls, 1);
  assert.equal(summaryWrites.length, 1);
  assert.equal(descriptionWrites.length, 1);
  assert.equal(usageRows.length, 1);
  gatewayLookupError = null;

  invalidStructuredText = JSON.stringify({
    summary: "## What this is\n- Recovered from one structured call\n\n## Recent activity\n- Verdict was malformed",
    descriptionGoodEnough: "yes",
  });
  const recovered = await generateAndStoreTaskSummary(42, { force: true });

  assert.equal(generateCalls, 2);
  assert.match(recovered, /Recovered from one structured call/);
  assert.equal(summaryWrites.length, 2);
  assert.match(summaryWrites[1].update.content, /Recovered from one structured call/);
  assert.equal(descriptionWrites.length, 2);
  assert.equal(descriptionWrites[1].data.flaggedIncomplete, false);
  assert.equal(usageRows.length, 2);
  assert.equal(usageRows[1].totalTokens, 175);

  invalidStructuredText = "## What this is\n- Truncated before recent activity";
  const unavailable = await generateAndStoreTaskSummary(42, { force: true });

  assert.equal(generateCalls, 3);
  assert.equal(unavailable, null);
  assert.equal(summaryWrites.length, 2);
  assert.equal(descriptionWrites.length, 2);
  assert.equal(usageRows.length, 3);
  assert.equal(usageRows[2].totalTokens, 175);

  invalidStructuredText = null;
  generationError = { name: "TimeoutError" };
  await assert.rejects(
    () => generateAndStoreTaskSummary(42, { force: true }),
    (error) =>
      error instanceof SummaryGenerationTimeoutError &&
      error instanceof SummaryRetryableError &&
      error.cause === generationError,
  );
  assert.equal(generateCalls, 4);
  assert.equal(summaryWrites.length, 2);
  assert.equal(descriptionWrites.length, 2);
  assert.equal(redisValues.has("ai-summary:lock:42"), true);
});
