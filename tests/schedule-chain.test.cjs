const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { handOff, standDown, linkStart, runInFlight } = require("../.github/scripts/schedule-chain.cjs");

const WORKFLOW = "production-watch.yml";
const REPO = "hypertask-ai/hypertask";

function api(responses) {
  const calls = [];
  const fake = async (path, method = "GET", fields = undefined) => {
    calls.push({ path, method, fields });
    const response = responses[path];
    if (response instanceof Error) throw response;
    if (response === undefined) return {};
    return response;
  };
  fake.calls = calls;
  return fake;
}

const liveRun = (id, status = "in_progress") => ({ workflow_runs: [{ id, status }] });

test("a link starts the next one and reports the ref it dispatched", async () => {
  const fake = api({ [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: liveRun(1) });

  const result = await handOff(REPO, { workflowFile: WORKFLOW, ownRunId: 1, api: fake });

  assert.deepEqual(result, { dispatched: true, ref: "production" });
  const dispatch = fake.calls.find(call => call.path.endsWith("/dispatches"));
  assert.equal(dispatch.method, "POST");
  assert.deepEqual(dispatch.fields, { ref: "production" });
});

test("the link that dispatched is never counted as the link in flight", async () => {
  const fake = api({ [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: liveRun(77) });

  const result = await handOff(REPO, { workflowFile: WORKFLOW, ownRunId: "77", api: fake });

  assert.equal(result.dispatched, true);
});

test("the gap is measured from when the link started, so a slow link waits less", async () => {
  const fake = api({ [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: { workflow_runs: [] } });
  const slept = [];

  await handOff(REPO, {
    workflowFile: WORKFLOW,
    startMs: 1_000_000,
    gapMs: 600_000,
    now: () => 1_000_000 + 540_000,
    api: fake,
    sleep: async ms => slept.push(ms),
  });

  assert.deepEqual(slept, [60_000]);
});

test("a link whose own checks already outran the gap starts the next one at once", async () => {
  const fake = api({ [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: { workflow_runs: [] } });
  const slept = [];

  await handOff(REPO, {
    workflowFile: WORKFLOW,
    startMs: 1_000_000,
    gapMs: 600_000,
    now: () => 1_700_000,
    api: fake,
    sleep: async ms => slept.push(ms),
  });

  assert.deepEqual(slept, []);
});

test("a link waits out the link it found instead of dropping the chain", async () => {
  const listPath = `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`;
  let reads = 0;
  const fake = async (path, method = "GET") => {
    if (path !== listPath) return {};
    reads += 1;
    return reads < 3 ? liveRun(9, "queued") : { workflow_runs: [] };
  };
  const slept = [];

  const result = await handOff(REPO, {
    workflowFile: WORKFLOW,
    ownRunId: 1,
    api: fake,
    sleep: async ms => slept.push(ms),
  });

  assert.equal(result.dispatched, true);
  assert.deepEqual(slept, [60_000, 60_000]);
});

test("a link that never stops waiting is reported, not thrown", async () => {
  const fake = api({ [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: liveRun(9) });

  const result = await handOff(REPO, { workflowFile: WORKFLOW, api: fake, sleep: async () => {} });

  assert.equal(result.dispatched, false);
  assert.match(result.reason, /another link is still in_progress after 4 tries/);
});

test("an unreadable run list never dispatches a second chain", async () => {
  const fake = api({
    [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: new Error("gh api runs failed: HTTP 502"),
  });

  const result = await handOff(REPO, { workflowFile: WORKFLOW, api: fake });

  assert.equal(result.dispatched, false);
  assert.match(result.reason, /the run list could not be read: gh api runs failed: HTTP 502/);
  assert.equal(fake.calls.some(call => call.path.endsWith("/dispatches")), false);
});

test("a refused dispatch is reported with the reason GitHub gave", async () => {
  const fake = async path => {
    if (path.endsWith("/dispatches")) throw new Error("gh api dispatches failed: HTTP 403");
    return { workflow_runs: [] };
  };

  const result = await handOff(REPO, { workflowFile: WORKFLOW, api: fake });

  assert.equal(result.dispatched, false);
  assert.match(result.reason, /the next link was not dispatched: .*HTTP 403/);
});

test("a backstop stands down while another link is alive and never on a quiet chain", async () => {
  const busy = await standDown(REPO, {
    workflowFile: WORKFLOW,
    ownRunId: 1,
    api: api({ [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: liveRun(2) }),
  });
  assert.equal(busy.id, 2);

  const quiet = await standDown(REPO, {
    workflowFile: WORKFLOW,
    ownRunId: 1,
    api: api({ [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: liveRun(1) }),
  });
  assert.equal(quiet, null);
});

test("an unreadable run list leaves a backstop running its own pass", async () => {
  const busy = await standDown(REPO, {
    workflowFile: WORKFLOW,
    api: api({
      [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: new Error("gh api runs failed: HTTP 500"),
    }),
  });

  assert.equal(busy, null);
});

test("the link start is read from GitHub's own run record", async () => {
  const started = await linkStart(REPO, 5, api({ [`/repos/${REPO}/actions/runs/5`]: { run_started_at: "2026-11-02T04:00:00Z" } }));
  assert.equal(started, Date.parse("2026-11-02T04:00:00Z"));

  const unknown = await linkStart(REPO, 5, api({ [`/repos/${REPO}/actions/runs/5`]: {} }));
  assert.equal(unknown, null);
});

test("only a queued or running link counts as in flight", async () => {
  const completed = await runInFlight(REPO, WORKFLOW, null, api({
    [`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`]: { workflow_runs: [{ id: 3, status: "completed" }] },
  }));
  assert.equal(completed, null);
});

test("the command line stands a scheduled backstop down and dispatches from a chain link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "schedule-chain-"));
  const log = join(directory, "calls.log");
  const bin = join(directory, "bin");
  try {
    await chmod(directory, 0o755);
    await writeFile(log, "");
    await rm(bin, { recursive: true, force: true });
    await writeFile(join(directory, "gh"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"workflows/production-watch.yml/runs"*) printf '%s' "$GH_RUNS"; exit 0 ;;
  *dispatches*) exit "\${GH_DISPATCH_EXIT:-0}" ;;
esac
printf '{}'
`, { mode: 0o755 });
    const base = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      REPO,
      GITHUB_RUN_ID: "11",
    };

    const backstop = spawnSync(process.execPath, [".github/scripts/schedule-chain.cjs", "hand-off", "--workflow", WORKFLOW], {
      encoding: "utf8",
      env: { ...base, GITHUB_EVENT_NAME: "schedule", GH_RUNS: '{"workflow_runs":[{"id":12,"status":"in_progress"}]}' },
    });
    assert.equal(backstop.status, 0, backstop.stdout + backstop.stderr);
    assert.match(backstop.stdout, /this backstop stood down: link 12 is already in_progress/);
    assert.doesNotMatch(await readFile(log, "utf8"), /dispatches/);

    const link = spawnSync(process.execPath, [".github/scripts/schedule-chain.cjs", "hand-off", "--workflow", WORKFLOW], {
      encoding: "utf8",
      env: { ...base, GITHUB_EVENT_NAME: "workflow_dispatch", GH_RUNS: '{"workflow_runs":[{"id":11,"status":"in_progress"}]}' },
    });
    assert.equal(link.status, 0, link.stdout + link.stderr);
    assert.match(link.stdout, /the next production-watch\.yml link is dispatched on production/);
    assert.match(await readFile(log, "utf8"), /-X POST .*workflows\/production-watch\.yml\/dispatches -f ref=production/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a chain that cannot start the next link fails loudly so the backstop is due", async () => {
  const directory = await mkdtemp(join(tmpdir(), "schedule-chain-fail-"));
  try {
    await writeFile(join(directory, "gh"), `#!/usr/bin/env bash
case "$*" in
  *"workflows/production-watch.yml/runs"*) printf '%s' '{"workflow_runs":[]}'; exit 0 ;;
  *dispatches*) exit 1 ;;
esac
printf '{}'
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [".github/scripts/schedule-chain.cjs", "hand-off", "--workflow", WORKFLOW], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, REPO, GITHUB_RUN_ID: "11", GITHUB_EVENT_NAME: "workflow_dispatch" },
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /the chain stopped: the next link was not dispatched/);
    assert.match(result.stdout, /The backstop cron restarts it/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
