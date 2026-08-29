const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { decodeSourceMap, symbolicateStack } = jiti(
  path.join(root, "src/lib/errors/symbolicateStack.ts"),
);

const rawMap = JSON.stringify({
  version: 3,
  sources: [
    "webpack://_N_E/./src/components/Board/Card.tsx\n)",
    "webpack://_N_E/./src/hooks/useBoard.ts",
  ],
  names: ["renderCard"],
  mappings: "AAWGA,wCAQK;ACfR",
});
const origins = new Set(["https://app.hypertask.ai"]);
const chunk = "https://app.hypertask.ai/_next/static/chunks/4821-9f0c1b.js";

test("minified client frames resolve to original source locations", async () => {
  const map = decodeSourceMap(rawMap);
  assert.ok(map);
  const tail = `\n${"x".repeat(8000)}tail`;
  const result = await symbolicateStack(
    `TypeError: e\n    at u (${chunk}:1:45)\n    at o (${chunk}:2:1)\n    at p (${chunk}:2:10)${tail}`,
    {
      origins,
      fetchMap: async () => map,
    },
  );

  assert.deepEqual(result, {
    stack:
      "TypeError: e\n" +
      "    at u (src/components/Board/Card.tsx__:20:9)\n" +
      "    at o (src/hooks/useBoard.ts:5:1)\n" +
      `    at p (src/hooks/useBoard.ts:5:1)${tail}`,
    resolvedFrames: 3,
  });
});

test("missing maps and non-app scripts leave stacks untouched", async () => {
  assert.equal(decodeSourceMap("not json"), null);
  const minified = `TypeError: e\n    at u (${chunk}:1:45)`;
  const invalidMap = decodeSourceMap(
    JSON.stringify({ version: 3, sources: [], names: [], mappings: "AAAA" }),
  );
  assert.ok(invalidMap);
  assert.deepEqual(
    await symbolicateStack(minified, {
      origins,
      fetchMap: async () => invalidMap,
    }),
    { stack: minified, resolvedFrames: 0 },
  );
  assert.deepEqual(
    await symbolicateStack(minified, {
      origins,
      fetchMap: async () => null,
    }),
    { stack: minified, resolvedFrames: 0 },
  );
  const foreign =
    "TypeError: e\n    at u (https://evil.example/_next/static/a.js:1:1)";
  let fetched = false;
  const refused = await symbolicateStack(foreign, {
    origins,
    fetchMap: async () => {
      fetched = true;
      return decodeSourceMap(rawMap);
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(refused, { stack: foreign, resolvedFrames: 0 });
});

test("default map loading strips chunk queries/fragments and refuses redirects", async () => {
  const queried = `${chunk}?dpl=deployment#release`;
  const stack = `Error: e\n    at u (${queried}:1:45)`;
  const previousBypass = process.env.SOURCE_MAP_BYPASS_SECRET;
  process.env.SOURCE_MAP_BYPASS_SECRET = "unit-test-bypass";
  let requested;
  let requestedBypass;
  const fetchImpl = async (url, options) => {
    requested = url;
    assert.equal(options.redirect, "error");
    requestedBypass = new Headers(options.headers).get(
      "x-vercel-protection-bypass",
    );
    throw new TypeError("redirect rejected");
  };
  const result = await symbolicateStack(stack, { origins, fetchImpl }).finally(
    () => {
      if (previousBypass === undefined)
        delete process.env.SOURCE_MAP_BYPASS_SECRET;
      else process.env.SOURCE_MAP_BYPASS_SECRET = previousBypass;
    },
  );
  assert.deepEqual(result, { stack, resolvedFrames: 0 });
  assert.equal(requested, `${chunk}.map`);
  assert.equal(requestedBypass, "unit-test-bypass");
});

test("concurrent reports bound map work without evicting in-flight requests", async () => {
  const stacks = Array.from(
    { length: 21 },
    (_, index) =>
      `Error: e\n    at u (${chunk.replace("4821-9f0c1b", `concurrent-${index}`)}:1:45)`,
  );
  let requests = 0;
  let active = 0;
  let peak = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetchImpl = async () => {
    requests += 1;
    active += 1;
    peak = Math.max(peak, active);
    await gate;
    active -= 1;
    return new Response(rawMap);
  };
  const reportStacks = [...stacks.slice(0, 4), stacks[0], ...stacks.slice(4)];
  const reports = reportStacks.map((stack) =>
    symbolicateStack(stack, { origins, fetchImpl }),
  );
  release();
  const results = await Promise.all(reports);
  assert.equal(requests, 20);
  assert.equal(peak, 4);
  assert.equal(
    results.filter(({ resolvedFrames }) => resolvedFrames === 1).length,
    21,
  );
});
