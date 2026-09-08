const assert = require("node:assert/strict");
const test = require("node:test");
const { readFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

process.env.HYPERTASK_MCP_TOKEN = "test-token";
process.env.CORE_SMOKE_PROJECT_ID = "71";
process.env.CORE_SMOKE_TASK_ID = "81";
process.env.CORE_SMOKE_BASE_SECTION_ID = "91";
process.env.CORE_SMOKE_ALT_SECTION_ID = "92";
process.env.CORE_SMOKE_AGENT_ID = "00000000-0000-4000-8000-000000000001";

const scriptUrl = pathToFileURL(
  `${process.cwd()}/.github/scripts/core-actions-smoke.mjs`,
).href;

test("the probe target cannot be redirected away from production", async () => {
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({
      result: {
        ok: true,
        kind: "pass",
        action: "complete",
        detail: "all actions passed",
        steps: [],
        cleanup: [],
      },
    });
  };

  try {
    const { run } = await import(scriptUrl);
    await run();
    assert.equal(new URL(requestedUrl).origin, "https://app.hypertask.ai");
  } finally {
    global.fetch = originalFetch;
  }
});

test("a truncated probe response is unrunnable, never green", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => Response.json({ result: { ok: true } });

  try {
    const { run } = await import(scriptUrl);
    await assert.rejects(run(), /malformed result/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rollback is limited to application failures after a production push", async () => {
  const {
    ApiRequestError,
    classifyProbeStartFailure,
    sameApplicationFailure,
    shouldRollback,
  } = await import(scriptUrl);

  assert.equal(
    shouldRollback({ kind: "application", rollbackEligible: true }, "push"),
    true,
  );
  assert.equal(shouldRollback({ kind: "application" }, "push"), false);
  assert.equal(shouldRollback({ kind: "unrunnable" }, "push"), false);
  assert.equal(shouldRollback({ kind: "application" }, "schedule"), false);
  assert.equal(
    shouldRollback({ kind: "application" }, "workflow_dispatch"),
    false,
  );
  const upstreamFailure = classifyProbeStartFailure(
    new ApiRequestError(
      "/api/ops/core-actions-smoke",
      503,
      "gateway unavailable",
    ),
  );
  assert.equal(upstreamFailure.kind, "unrunnable");
  assert.equal(shouldRollback(upstreamFailure, "push"), false);
  assert.equal(
    sameApplicationFailure(
      { kind: "application", action: "open task", status: 400, detail: "a" },
      { kind: "application", action: "open task", status: 400, detail: "b" },
    ),
    false,
  );
});

test("rollback needs the same application failure twice", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return Response.json({
      result: {
        ok: false,
        kind: "application",
        action: "open task",
        status: 500,
        detail: "route failed",
        steps: ["open board"],
        cleanup: [],
      },
    });
  };

  try {
    const { run, shouldRollback } = await import(scriptUrl);
    const result = await run({ sleep: async () => undefined });
    assert.equal(calls, 2);
    assert.equal(result.rollbackEligible, true);
    assert.equal(shouldRollback(result, "push"), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a transient application failure passes on confirmation without rollback", async () => {
  const originalFetch = global.fetch;
  const results = [
    {
      ok: false,
      kind: "application",
      action: "open task",
      status: 500,
      detail: "route failed",
      steps: ["open board"],
      cleanup: [],
    },
    {
      ok: true,
      kind: "pass",
      action: "complete",
      detail: "all actions passed",
      steps: [],
      cleanup: [],
    },
  ];
  global.fetch = async () => Response.json({ result: results.shift() });

  try {
    const { run, shouldRollback } = await import(scriptUrl);
    const result = await run({ sleep: async () => undefined });
    assert.equal(result.ok, true);
    assert.match(result.detail, /passed confirmation retry/);
    assert.equal(shouldRollback(result, "push"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("an unrunnable probe stays failed and cannot request rollback", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    Response.json({
      result: {
        ok: false,
        kind: "unrunnable",
        action: "check feature flag",
        detail: "the core-actions smoke flag is disabled for this user",
        steps: [],
        cleanup: [],
      },
    });

  try {
    const { run, shouldRollback } = await import(scriptUrl);
    const result = await run();
    assert.equal(result.ok, false);
    assert.equal(result.action, "check feature flag");
    assert.equal(shouldRollback(result, "push"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("the workflow schedules and serializes the production fixture", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const scheduled = await readFile(
    ".github/workflows/core-actions-smoke.yml",
    "utf8",
  );

  assert.match(workflow, /cron: "\*\/30 \* \* \* \*"/);
  assert.match(scheduled, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(workflow, /group: prod-health\s+cancel-in-progress: false/);
  assert.match(
    scheduled,
    /group: scheduled-core-actions-smoke\s+cancel-in-progress: false/,
  );
  assert.equal(
    [workflow, scheduled]
      .join("\n")
      .match(/group: production-core-actions-smoke-fixture/g)?.length,
    3,
  );
  assert.doesNotMatch(scheduled, /emergency-rollback|VERCEL_TOKEN/);
  assert.match(
    workflow,
    /name: Roll back a confirmed post-deploy application failure\s+if: .*github\.event_name == 'push'/,
  );
  assert.match(
    workflow,
    /provision-core-actions:[\s\S]*github\.ref == 'refs\/heads\/production'/,
  );
  assert.match(
    workflow,
    /name: core-actions-fixture-\$\{\{ github\.run_id \}\}/,
  );
  assert.doesNotMatch(workflow, /gh variable set CORE_SMOKE_/);
  assert.match(workflow, /SUMMARY=.*gsub/);
});

test("a failed parent-ticket report does not suppress the incident report", async () => {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method: init.method || "GET", path: url.pathname, body });

    if (
      url.pathname === "/api/mcp/comments" &&
      body?.ticket_number === "HTPR-6225"
    ) {
      return Response.json({ message: "parent unavailable" }, { status: 500 });
    }
    if (url.pathname === "/api/mcp/tasks") return Response.json({ tasks: [] });
    if (url.pathname === "/api/mcp/projects") {
      return Response.json({
        projects: [{ id: 15, sections: [{ id: 12, section_title: "Bugs" }] }],
      });
    }
    if (url.pathname === "/api/mcp/tasks/create") {
      return Response.json({ task: { id: 777 } });
    }
    if (url.pathname === "/api/mcp/comments" && body?.task_id === 777) {
      return Response.json({ success: true });
    }
    return Response.json({ message: "unhandled request" }, { status: 500 });
  };

  try {
    const { report } = await import(scriptUrl);
    await assert.rejects(
      report({
        kind: "application",
        action: "open task",
        status: 500,
        detail: "response details omitted",
      }),
      /1 core-smoke report destination\(s\) failed/,
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.ok(
    requests.some((request) => request.path === "/api/mcp/tasks/create"),
  );
  assert.ok(
    requests.some(
      (request) =>
        request.path === "/api/mcp/comments" && request.body?.task_id === 777,
    ),
  );
});
