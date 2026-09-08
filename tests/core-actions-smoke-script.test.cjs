const assert = require("node:assert/strict");
const test = require("node:test");
const { readFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

process.env.HYPERTASK_MCP_TOKEN = "test-token";

const scriptUrl = pathToFileURL(
  `${process.cwd()}/.github/scripts/core-actions-smoke.mjs`,
).href;


const BOARD_TITLE = "Hypertask production core-actions smoke";
const TASK_TITLE = "Core actions smoke fixture";
const AGENT_NAME = "Core Actions Smoke Agent";
const AGENT_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = 71;
const TASK_ID = 81;
const BASE_SECTION_ID = 91;
const ALT_SECTION_ID = 92;

// The probe resolves its fixture by name on every run, so any mock has to
// answer the whole resolution conversation, not just the probe call.
function fixtureFetch({ probeResult, onRequest, overrides = {} } = {}) {
  return async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (onRequest) onRequest(url, init);
    if (overrides[path]) return overrides[path](url, init);
    if (path === "/api/mcp/user/context")
      return Response.json({
        user: { id: 6 },
        teams: [{ id: "team-1", title: "Hypertask" }],
        projects: [{ id: PROJECT_ID, title: BOARD_TITLE, ownerId: 6 }],
      });
    if (path === "/api/mcp/tasks")
      return Response.json({
        tasks: [
          { id: TASK_ID, title: TASK_TITLE, labels: [{ name: "qa-fixture" }] },
        ],
      });
    if (path === "/api/mcp/agents")
      return Response.json({
        agents: [
          {
            id: AGENT_ID,
            display_name: AGENT_NAME,
            revoked: false,
            boards: [{ id: PROJECT_ID }],
          },
        ],
      });
    if (path === "/api/mcp/assignees/assign") return Response.json({});
    if (path === "/api/mcp/projects")
      return Response.json({
        projects: [
          {
            id: PROJECT_ID,
            sections: [
              { id: BASE_SECTION_ID, section_title: "Baseline" },
              { id: ALT_SECTION_ID, section_title: "Alternate" },
            ],
          },
        ],
      });
    if (path === "/api/ops/core-actions-smoke")
      return Response.json({
        result: probeResult ?? {
          ok: true,
          kind: "pass",
          action: "complete",
          detail: "all actions passed",
          steps: [],
          cleanup: [],
        },
      });
    throw new Error(`unexpected request to ${path}`);
  };
}

test("the probe target cannot be redirected away from production", async () => {
  const originalFetch = global.fetch;
  const origins = new Set();
  global.fetch = fixtureFetch({ onRequest: (url) => origins.add(url.origin) });

  try {
    const { run } = await import(scriptUrl);
    await run();
    assert.deepEqual([...origins], ["https://app.hypertask.ai"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a truncated probe response is unrunnable, never green", async () => {
  const originalFetch = global.fetch;
  global.fetch = fixtureFetch({
    overrides: {
      "/api/ops/core-actions-smoke": async () =>
        Response.json({ result: { ok: true } }),
    },
  });

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
  global.fetch = fixtureFetch({
    onRequest: (url) => {
      if (url.pathname === "/api/ops/core-actions-smoke") calls += 1;
    },
    probeResult: {
      ok: false,
      kind: "application",
      action: "open task",
      status: 500,
      detail: "route failed",
      steps: ["open board"],
      cleanup: [],
    },
  });

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
  global.fetch = fixtureFetch({
    overrides: {
      "/api/ops/core-actions-smoke": async () =>
        Response.json({ result: results.shift() }),
    },
  });

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
  global.fetch = fixtureFetch({
    probeResult: {
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

test("the probe resolves its fixture by name, never from a stored id", async () => {
  const originalFetch = global.fetch;
  let sent;
  global.fetch = fixtureFetch({
    onRequest: (url, init) => {
      if (url.pathname === "/api/ops/core-actions-smoke")
        sent = JSON.parse(init.body);
    },
  });

  try {
    const { run } = await import(scriptUrl);
    const result = await run();
    assert.equal(result.ok, true);
    assert.equal(sent.projectId, PROJECT_ID);
    assert.equal(sent.taskId, TASK_ID);
    assert.equal(sent.baseSectionId, BASE_SECTION_ID);
    assert.equal(sent.altSectionId, ALT_SECTION_ID);
    assert.equal(sent.agentId, AGENT_ID);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolution does not need a team once the fixture board exists", async () => {
  const originalFetch = global.fetch;
  const requested = [];
  global.fetch = fixtureFetch({
    onRequest: (url) => requested.push(url.pathname),
    overrides: {
      "/api/mcp/user/context": async () =>
        Response.json({
          user: { id: 6 },
          teams: [],
          projects: [{ id: PROJECT_ID, title: BOARD_TITLE, ownerId: 6 }],
        }),
    },
  });

  try {
    const { run } = await import(scriptUrl);
    const result = await run();
    assert.equal(result.ok, true);
    assert.equal(
      requested.some((path) => path.includes("/boards")),
      false,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("the fixture board is created with the qa-fixture label so agents skip it", async () => {
  const originalFetch = global.fetch;
  let manifest;
  global.fetch = fixtureFetch({
    onRequest: (url, init) => {
      if (url.pathname.endsWith("/boards")) manifest = JSON.parse(init.body);
    },
    overrides: {
      "/api/mcp/user/context": async () =>
        Response.json({
          user: { id: 6 },
          teams: [{ id: "team-1", title: "Hypertask" }],
          projects: [],
        }),
      "/api/mcp/teams/team-1/boards": async () =>
        Response.json({
          board: { id: PROJECT_ID, title: BOARD_TITLE },
          sections: [],
          tasks: [{ id: TASK_ID, title: TASK_TITLE }],
        }),
    },
  });

  try {
    const { run } = await import(scriptUrl);
    await run();
    assert.deepEqual(manifest.labels, [{ name: "qa-fixture" }]);
    assert.deepEqual(manifest.tasks[0].label_names, ["qa-fixture"]);
    assert.deepEqual(
      manifest.sections.map((section) => section.title),
      ["Baseline", "Alternate"],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("a fixture that cannot be resolved is unrunnable and never rolls back", async () => {
  const originalFetch = global.fetch;
  global.fetch = fixtureFetch({
    overrides: {
      "/api/mcp/user/context": async () =>
        Response.json({ user: { id: 6 }, teams: [], projects: [] }),
    },
  });

  try {
    const { run, classifyProbeStartFailure, shouldRollback } =
      await import(scriptUrl);
    let result;
    try {
      result = await run();
    } catch (error) {
      result = classifyProbeStartFailure(error);
    }
    assert.equal(result.ok, false);
    assert.equal(result.kind, "unrunnable");
    assert.equal(result.action, "start core-actions probe");
    assert.equal(shouldRollback(result, "push"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("the workflow schedules and serializes the production fixture", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");

  assert.match(workflow, /cron: "\*\/30 \* \* \* \*"/);
  assert.match(workflow, /cron: "3-58\/5 \* \* \* \*"/);
  assert.match(workflow, /group: prod-health\s+cancel-in-progress: false/);
  assert.match(
    workflow,
    /drift:[\s\S]*github\.event\.schedule == '\*\/30 \* \* \* \*'/,
  );
  assert.match(
    workflow,
    /core-actions:[\s\S]*github\.event\.schedule == '3-58\/5 \* \* \* \*'/,
  );
  assert.equal(
    workflow.match(/group: production-core-actions-smoke-fixture/g)?.length,
    2,
  );
  await assert.rejects(
    readFile(".github/workflows/core-actions-smoke.yml", "utf8"),
    { code: "ENOENT" },
  );
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

test("the monitor runs the probe unconditionally and stays loud when it fails", async () => {
  for (const file of [".github/workflows/prod-health.yml"]) {
    const text = await readFile(file, "utf8");
    // No preflight gate: a fixture that is absent is provisioned by the probe,
    // never a reason to skip the check (HTPR-6255, HTPR-6258).
    assert.doesNotMatch(text, /check-settings/);
    assert.doesNotMatch(text, /steps\.settings\.outputs\.configured/);
    assert.doesNotMatch(text, /vars\.CORE_SMOKE_PROJECT_ID/);
    assert.match(
      text,
      /name: Run the logged-in core actions and restore the fixture\s+id: probe\s+continue-on-error: true/,
    );
    assert.match(
      text,
      /name: Report a failed or unrunnable check\s+if: \$\{\{ !cancelled\(\) && steps\.probe\.outcome == 'failure' \}\}/,
    );
    assert.match(
      text,
      /name: Keep failed monitoring visible[\s\S]*?steps\.probe\.outcome == 'failure'[\s\S]*?exit 1/,
    );
  }
});

test("an existing fixture task without the qa-fixture label is refused", async () => {
  // Labels are only settable at creation, so a pre-existing unlabelled task
  // cannot be relabelled here; driving it anyway risks colliding with an agent.
  const originalFetch = global.fetch;
  global.fetch = fixtureFetch({
    overrides: {
      "/api/mcp/tasks": async () =>
        Response.json({ tasks: [{ id: TASK_ID, title: TASK_TITLE, labels: [] }] }),
    },
  });

  try {
    const { run, classifyProbeStartFailure, shouldRollback } =
      await import(scriptUrl);
    let result;
    try {
      result = await run();
    } catch (error) {
      result = classifyProbeStartFailure(error);
    }
    assert.equal(result.kind, "unrunnable");
    assert.match(result.detail, /missing the qa-fixture label/);
    // Needs a human, so it is red and loud but never a board report.
    assert.equal(result.setupError, true);
    assert.equal(shouldRollback(result, "push"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a credential problem fails the job without spamming the board", async () => {
  const { classifyProbeStartFailure, isSetupFailure, report, shouldRollback } =
    await import(scriptUrl);

  assert.equal(
    isSetupFailure(
      new Error("HYPERTASK_MCP_TOKEN must be a user token, not an agent token"),
    ),
    true,
  );
  assert.equal(
    isSetupFailure(new Error("HYPERTASK_MCP_TOKEN is required")),
    true,
  );
  assert.equal(isSetupFailure(new Error("route failed")), false);

  const result = classifyProbeStartFailure(
    new Error("HYPERTASK_MCP_TOKEN must be a user token, not an agent token"),
  );
  assert.equal(result.kind, "unrunnable");
  assert.equal(result.setupError, true);
  // Still red and still un-rollbackable; just not a new ticket every 5 minutes.
  assert.equal(shouldRollback(result, "push"), false);

  const originalFetch = global.fetch;
  let posted = 0;
  global.fetch = async () => {
    posted += 1;
    return Response.json({});
  };
  try {
    await report(result);
    assert.equal(posted, 0);
  } finally {
    global.fetch = originalFetch;
  }
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
        projects: [
          {
            id: 15,
            sections: [{ id: 4389, section_title: "Bugs" }],
          },
        ],
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

test("an invalid report destination names the attempted section", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : null;

    if (url.pathname === "/api/mcp/comments" && body?.ticket_number) {
      return Response.json({ success: true });
    }
    if (url.pathname === "/api/mcp/tasks") return Response.json({ tasks: [] });
    if (url.pathname === "/api/mcp/projects") {
      return Response.json({
        projects: [
          { id: 15, sections: [{ id: 228, section_title: "Bugs" }] },
        ],
      });
    }
    return Response.json({ message: "unhandled request" }, { status: 500 });
  };

  try {
    const { report } = await import(scriptUrl);
    await assert.rejects(
      report({
        kind: "unrunnable",
        action: "start core-actions probe",
        detail: "fixture settings absent",
      }),
      /section 4389 \(Bugs\) is missing from project 15/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
