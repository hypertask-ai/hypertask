const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.join(__dirname, "..", ".github", "scripts", "published-baseline.mjs"),
).href;

const load = () => import(moduleUrl);

const SHA = "8dc0889ac0000000000000000000000000000000";

const artifact = (overrides = {}) => ({
  id: 11,
  expired: false,
  created_at: "2026-11-02T08:00:00Z",
  workflow_run: { id: 900, head_branch: "production", head_sha: SHA },
  ...overrides,
});

const run = (overrides = {}) => ({
  path: ".github/workflows/visual-regression.yml",
  head_branch: "production",
  head_sha: SHA,
  status: "completed",
  conclusion: "success",
  ...overrides,
});

test("a production baseline for the base commit is reused", async () => {
  const { selectPublishedBaseline } = await load();
  assert.deepEqual(selectPublishedBaseline([artifact()]), { artifactId: 11, runId: 900 });
});

test("a baseline uploaded by a pull request branch is refused", async () => {
  const { selectPublishedBaseline } = await load();
  const poisoned = artifact({ id: 12, workflow_run: { id: 901, head_branch: "runner-9/poison", head_sha: SHA } });
  assert.equal(selectPublishedBaseline([poisoned]), null);
});

test("a baseline captured from another production commit is reused, because the name carries the render source", async () => {
  const { selectPublishedBaseline } = await load();
  const other = artifact({ id: 13, workflow_run: { id: 902, head_branch: "production", head_sha: "0".repeat(40) } });
  assert.deepEqual(selectPublishedBaseline([other]), { artifactId: 13, runId: 902 });
});

test("the newest trusted baseline wins and expired ones are skipped", async () => {
  const { selectPublishedBaseline } = await load();
  const older = artifact({ id: 20, created_at: "2026-11-01T08:00:00Z" });
  const newer = artifact({ id: 21, created_at: "2026-11-02T09:00:00Z" });
  const expired = artifact({ id: 22, expired: true, created_at: "2026-11-02T10:00:00Z" });
  assert.deepEqual(selectPublishedBaseline([older, expired, newer]), { artifactId: 21, runId: 900 });
});

test("an empty artifact list selects nothing", async () => {
  const { selectPublishedBaseline } = await load();
  assert.equal(selectPublishedBaseline([]), null);
  assert.equal(selectPublishedBaseline(undefined), null);
});

test("a failing run did not validate the screenshots it published", async () => {
  const { isTrustedProducer } = await load();
  assert.equal(isTrustedProducer(run({ conclusion: "failure" })), false);
  assert.equal(isTrustedProducer(run({ status: "in_progress", conclusion: null })), false);
});

test("a run of another workflow does not publish the production baseline", async () => {
  const { isTrustedProducer } = await load();
  assert.equal(isTrustedProducer(run({ path: ".github/workflows/ci-tests.yml" })), false);
  assert.equal(isTrustedProducer(run({ path: ".github/workflows/visual-regression.yml@refs/heads/topic" })), false);
});

test("the producer run must be a successful production push of this workflow", async () => {
  const { isTrustedProducer } = await load();
  assert.equal(isTrustedProducer(run({ head_branch: "runner-9/poison" })), false);
  assert.equal(isTrustedProducer(run()), true);
  assert.equal(isTrustedProducer(null), false);
});
