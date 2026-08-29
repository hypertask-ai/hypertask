const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  createAiTitleEditTracker,
  recordBoardMemorySignal,
  shouldLearnBoardMemoryFromAiMode,
  shouldLearnBoardMemoryFromEditedTitle,
} = jiti(path.join(root, "src/lib/ai/boardMemoryClient.ts"));

const signal = {
  type: "edited_ai_title",
  originalText: "Customer import",
  correctedText: "Member import",
};

function response(status, retryAfter = null) {
  return new Response(null, {
    status,
    headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
  });
}

test("board memory learns corrections only from Task Writer mode", () => {
  assert.equal(shouldLearnBoardMemoryFromAiMode("AiTaskWriter"), true);
  assert.equal(shouldLearnBoardMemoryFromAiMode("WriteWithAI"), false);
});

test("board memory learns case-only edits to an AI title", () => {
  assert.equal(
    shouldLearnBoardMemoryFromEditedTitle("Oauth setup", "OAuth setup"),
    true,
  );
  assert.equal(
    shouldLearnBoardMemoryFromEditedTitle(" Member import ", "Member import"),
    false,
  );
  assert.equal(
    shouldLearnBoardMemoryFromEditedTitle(null, "Member import"),
    false,
  );
});

test("accepted AI titles emit one learning signal only after an edit", () => {
  const tracker = createAiTitleEditTracker();

  tracker.record("Customer  import");
  assert.equal(tracker.takeSignal("Customer  import"), null);

  tracker.record("Customer import");
  assert.deepEqual(tracker.takeSignal("Member import"), {
    type: "edited_ai_title",
    originalText: "Customer import",
    correctedText: "Member import",
  });
  assert.equal(tracker.takeSignal("Another title"), null);
});

test("board memory client retries a busy response using Retry-After", async () => {
  const responses = [response(503, "2"), response(200)];
  const waits = [];
  const requests = [];

  await recordBoardMemorySignal(15, signal, {
    fetcher: async (url, init) => {
      requests.push({ url, init });
      return responses.shift();
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(waits, [2_000]);
  assert.equal(requests[0].url, "/api/ai/project/memory");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(requests[0].init.headers, {
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    projectId: 15,
    ...signal,
  });
});

test("board memory client retries a rate-limited signal after its window", async () => {
  const responses = [response(429, "12"), response(200)];
  const waits = [];

  await recordBoardMemorySignal(15, signal, {
    fetcher: async () => responses.shift(),
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.deepEqual(waits, [12_000]);
  assert.equal(responses.length, 0);
});

test("board memory client retries transient server and gateway failures", async () => {
  const responses = [500, 502, 504, 200].map((status) => response(status));
  const waits = [];

  await recordBoardMemorySignal(15, signal, {
    fetcher: async () => responses.shift(),
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.deepEqual(waits, [1_000, 2_000, 4_000]);
  assert.equal(responses.length, 0);
});

test("board memory client does not retry a permanent response", async () => {
  let requests = 0;

  await recordBoardMemorySignal(15, signal, {
    fetcher: async () => {
      requests += 1;
      return response(400);
    },
    wait: async () => assert.fail("permanent errors must not wait"),
  });

  assert.equal(requests, 1);
});

test("board memory client retries a transient network failure", async () => {
  let requests = 0;
  const waits = [];

  await recordBoardMemorySignal(15, signal, {
    fetcher: async () => {
      requests += 1;
      if (requests === 1) throw new Error("temporary network failure");
      return response(200);
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(requests, 2);
  assert.deepEqual(waits, [1_000]);
});

test("board memory client stops after six transient failures", async () => {
  let requests = 0;
  const waits = [];

  await recordBoardMemorySignal(15, signal, {
    fetcher: async () => {
      requests += 1;
      return response(503, "1");
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(requests, 6);
  assert.deepEqual(waits, [1_000, 1_000, 1_000, 1_000, 1_000]);
});
