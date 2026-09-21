const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const scriptUrl = pathToFileURL(
  path.resolve(__dirname, "../.github/scripts/production-gate.mjs"),
).href;
const sha = "a".repeat(40);

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function evaluate({ mergeFreeze = "", runs = [], jobs = [] } = {}) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.endsWith("/commits/production")) return response({ sha });
    if (url.includes("/actions/workflows?")) {
      return response({
        workflows: [{ id: 42, path: ".github/workflows/prod-health.yml" }],
      });
    }
    if (url.includes("/actions/workflows/42/runs?")) {
      return response({ workflow_runs: runs });
    }
    if (url.includes("/actions/runs/99/jobs?")) return response({ jobs });
    throw new Error(`unexpected request: ${url}`);
  };
  const { productionGate } = await import(scriptUrl);
  const result = await productionGate({
    repository: "hypertask-ai/hypertask",
    token: "test-token",
    mergeFreeze,
    fetchImpl,
  });
  return { result, requests };
}

test("a non-empty merge freeze blocks merging", async () => {
  const { result } = await evaluate({ mergeFreeze: "maintenance" });
  assert.deepEqual(result, { blocked: true, reason: "MERGE_FREEZE is set" });
});

test("a failed smoke job for production HEAD blocks merging", async () => {
  const { result, requests } = await evaluate({
    runs: [{ id: 99, status: "completed" }],
    jobs: [{ name: "smoke", conclusion: "failure" }],
  });
  assert.deepEqual(result, { blocked: true, reason: "production smoke failed" });
  assert.ok(
    requests.some((url) =>
      url.endsWith(`/actions/workflows/42/runs?head_sha=${sha}&status=completed&per_page=1`),
    ),
  );
});

test("no completed production health run does not block merging", async () => {
  const { result, requests } = await evaluate();
  assert.deepEqual(result, { blocked: false, reason: "" });
  assert.equal(requests.some((url) => url.includes("/jobs?")), false);
});

test("a successful smoke job does not block merging", async () => {
  const { result } = await evaluate({
    runs: [{ id: 99, status: "completed" }],
    jobs: [{ name: "smoke", conclusion: "success" }],
  });
  assert.deepEqual(result, { blocked: false, reason: "" });
});

test("GitHub API failures fail closed", async () => {
  const { productionGate } = await import(scriptUrl);
  await assert.rejects(
    productionGate({
      repository: "hypertask-ai/hypertask",
      token: "test-token",
      fetchImpl: async () => response({}, 503),
    }),
    /HTTP 503/,
  );
});
