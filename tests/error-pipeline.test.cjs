const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const Redis = require("ioredis");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/error-pipeline.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  errorTicketMinimumOccurrences,
  errorFingerprint,
  isWithinErrorTicketCap,
} = jiti(path.join(root, "src/lib/errors/errorFingerprint.ts"));
const { claimThresholdErrorTicket } = jiti(
  path.join(root, "src/lib/errors/errorTicketThreshold.ts"),
);
const { selectErrorBoardSection } = jiti(
  path.join(root, "src/lib/errors/errorBoardTarget.ts"),
);

async function waitForUnixSocket(socketPath, server, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(socketPath)) {
    if (server.exitCode !== null) {
      throw new Error(`redis-server exited before creating ${socketPath}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `redis-server did not create ${socketPath} within ${timeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("error dedupe uses the message and first meaningful stack frame", () => {
  const first = errorFingerprint(
    "Boom",
    "Error: Boom\n    at run (/app/a.js:1:2)\n    at next (/app/b.js:3:4)",
  );
  const same = errorFingerprint(
    "Boom",
    "Error: Boom\n    at run (/app/a.js:1:2)\n    at other (/app/c.js:5:6)",
  );
  const different = errorFingerprint(
    "Boom",
    "Error: Boom\n    at run (/app/d.js:1:2)",
  );

  assert.equal(first, same);
  assert.notEqual(first, different);
});

test("error ticket hourly cap allows five and rejects the sixth", () => {
  assert.equal(isWithinErrorTicketCap(5), true);
  assert.equal(isWithinErrorTicketCap(6), false);
});

test("error ticket thresholds default to immediate reporting", () => {
  assert.equal(errorTicketMinimumOccurrences(), 1);
  assert.equal(errorTicketMinimumOccurrences(0), 1);
  assert.equal(errorTicketMinimumOccurrences(1), 1);
  assert.equal(errorTicketMinimumOccurrences(1.5), 1);
});

test("auto-error routing selects Bugs independently of board column order", () => {
  const sections = [
    { id: 10, section_title: "CLI/MCP/API/AI CHAT/HYPER AI" },
    { id: 20, section_title: "Bugs" },
    { id: 30, section_title: "Features" },
  ];

  assert.deepEqual(selectErrorBoardSection(sections), sections[1]);
  assert.deepEqual(selectErrorBoardSection(sections, "Features"), sections[2]);
  assert.throws(
    () => selectErrorBoardSection(sections, "Missing"),
    /exactly one visible section named "Missing"; found 0/,
  );
  assert.throws(
    () => selectErrorBoardSection([...sections, sections[1]]),
    /exactly one visible section named "Bugs"; found 2/,
  );
});

test("auto-error routing is revalidated for every ticket", () => {
  const reportErrorSource = fs.readFileSync(
    path.join(root, "src/lib/errors/reportError.ts"),
    "utf8",
  );

  assert.doesNotMatch(reportErrorSource, /boardTargetCache/);
  assert.match(
    reportErrorSource,
    /const sections = await prisma\.section\.findMany/,
  );
});

test("thresholded errors preserve the configured occurrence", () => {
  assert.equal(errorTicketMinimumOccurrences(50), 50);
});

test("threshold claim is one atomic Redis evaluation with one absolute expiry", async () => {
  const calls = [];
  const redis = {
    async eval(...args) {
      calls.push(args);
      return [50, 1];
    },
  };

  const result = await claimThresholdErrorTicket(
    redis,
    "fingerprint",
    50,
    86400,
  );
  assert.deepEqual(result, {
    occurrenceCount: 50,
    claimed: true,
  });
  assert.equal(calls.length, 1);
  const [script, keyCount, occurrenceKey, claimKey, threshold, ttl] = calls[0];
  assert.equal(keyCount, 2);
  assert.equal(occurrenceKey, "errors:occurrences:fingerprint");
  assert.equal(claimKey, "errors:threshold-claim:fingerprint");
  assert.equal(threshold, 50);
  assert.equal(ttl, 86400);
  assert.match(script, /redis\.call\('INCR', KEYS\[1\]\)/);
  assert.match(script, /redis\.call\('PEXPIRETIME', KEYS\[1\]\)/);
  assert.match(
    script,
    /'SET',[\s\S]*KEYS\[2\],[\s\S]*'NX',[\s\S]*'PXAT',[\s\S]*expiresAtMilliseconds/,
  );
  assert.doesNotMatch(script, /'SET',[\s\S]*'NX',[\s\S]*'PX',/);
});

test("threshold claim shares the occurrence window boundary in Redis", async (t) => {
  if (spawnSync("redis-server", ["--version"]).status !== 0) {
    t.skip("redis-server is not installed");
    return;
  }

  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "hypertask-error-threshold-"),
  );
  const socketPath = path.join(temporaryDirectory, "redis.sock");
  const server = spawn(
    "redis-server",
    [
      "--port",
      "0",
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      temporaryDirectory,
      "--unixsocket",
      socketPath,
      "--unixsocketperm",
      "700",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const redis = new Redis(socketPath, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  t.after(async () => {
    redis.disconnect();
    server.kill("SIGTERM");
    if (server.exitCode === null) {
      await once(server, "exit");
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  await waitForUnixSocket(socketPath, server);
  await redis.connect();

  for (let occurrence = 1; occurrence < 50; occurrence += 1) {
    assert.deepEqual(
      await claimThresholdErrorTicket(redis, "live-fingerprint", 50, 2),
      { occurrenceCount: occurrence, claimed: false },
    );
  }
  assert.deepEqual(
    await claimThresholdErrorTicket(redis, "live-fingerprint", 50, 2),
    { occurrenceCount: 50, claimed: true },
  );
  assert.deepEqual(
    await claimThresholdErrorTicket(redis, "live-fingerprint", 50, 2),
    { occurrenceCount: 51, claimed: false },
  );

  const occurrenceExpiry = await redis.pexpiretime(
    "errors:occurrences:live-fingerprint",
  );
  const claimExpiry = await redis.pexpiretime(
    "errors:threshold-claim:live-fingerprint",
  );
  assert.equal(claimExpiry, occurrenceExpiry);
});

test("invalid threshold Redis results fail closed", async () => {
  const redis = {
    async eval() {
      return null;
    },
  };
  await assert.rejects(
    claimThresholdErrorTicket(redis, "fingerprint", 50),
    /invalid error-threshold result/,
  );
});

test("empty-completion reporting uses a stable key and explicit retry failure state", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );
  assert.match(route, /fingerprintKey: "ai-chat-empty-completion"/);
  assert.match(route, /let emptyCompletionRetryFailed = false/);
  assert.match(route, /emptyCompletionRetryFailed = true/);
  assert.match(
    route,
    /reportEmptyCompletion\(\s*emptyCompletionRetryFailed,\s*emptyCompletionError\s*\)/,
  );
});
