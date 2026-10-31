const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, ".github/workflows");

// CODEOWNERS-protected by @valentinyeo (HYCI-15): only he may change it.
const allowlist = new Map([["parity-contract-trusted.yml", "CODEOWNERS-protected, Valentin's signoff"]]);

// Pinned values for the jobs that had no limit before HYCI-15. The floor is
// 10 minutes: three times their measured maximum (3-23 s) is under a minute,
// which a queue spike or a cold hosted checkout would trip.
const pinned = {
  "ci-images.yml": { inventory: 10 },
  "gitleaks.yml": { "secret-scan": 10 },
  "mcp-client-eval.yml": { "publish-eval-report": 10 },
  "secret-guard.yml": { "next-public-secrets": 10 },
  "skills-evals.yml": { "run-evals": 10 },
  "e2e-ai-pilot.yml": { static: 10 },
};

const fix = 'add "timeout-minutes: <minutes>" to the job, about 3x its recent max duration (10 for anything under a minute)';

// This lint reads YAML by indentation instead of js-yaml, because it runs in
// ci-prepare on every pull request, where a workflow-only change installs no
// node_modules at all. Anything it cannot read with certainty fails closed.
function jobsIn(file, text) {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const jobs = [];
  const start = lines.findIndex((line) => /^jobs:\s*(#.*)?$/.test(line));
  if (start === -1) return jobs;
  let blockScalar = -1;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const indent = line.length - line.trimStart().length;
    // A block scalar's body is data, not jobs, whatever its indentation.
    if (blockScalar >= 0 && indent > blockScalar) continue;
    blockScalar = -1;
    if (/:\s*[|>][-+]?[0-9]*\s*$/.test(line)) {
      blockScalar = indent;
      continue;
    }
    assert.equal(indent % 2, 0, `${file}: odd indentation at "${line.trim()}" - rewrite it with 2-space indents`);
    if (indent === 2) {
      const header = /^ {2}([A-Za-z0-9_.-]+):\s*(#.*)?$/.exec(line);
      assert.ok(header, `${file}: cannot read "${line.trim()}" as a job id - rewrite it as "  <job-id>:"`);
      jobs.push({ id: header[1], timeout: undefined });
      continue;
    }
    const field = /^ {4}timeout-minutes:\s*(\d+)\s*(#.*)?$/.exec(line);
    if (field) {
      assert.ok(jobs.length, `${file}: "timeout-minutes" sits outside any job`);
      jobs[jobs.length - 1].timeout ??= Number(field[1]);
    }
  }
  return jobs;
}

const workflows = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort();
const read = (file) => readFileSync(path.join(dir, file), "utf8");

test("every workflow job sets an explicit timeout-minutes", () => {
  const missing = [];
  for (const file of workflows) {
    if (allowlist.has(file)) continue;
    for (const job of jobsIn(file, read(file))) {
      if (job.timeout === undefined) missing.push(`${file}: job "${job.id}" has no timeout-minutes - ${fix}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("timeouts stay under GitHub's 360-minute default", () => {
  const tooLong = [];
  for (const file of workflows) {
    for (const job of jobsIn(file, read(file))) {
      if (job.timeout >= 360) tooLong.push(`${file}: job "${job.id}" sets ${job.timeout} minutes - a job that needs 6 hours is a hang`);
    }
  }
  assert.deepEqual(tooLong, []);
});

test("the jobs that hung without a limit keep their bound", () => {
  for (const [file, jobs] of Object.entries(pinned)) {
    const parsed = new Map(jobsIn(file, read(file)).map((job) => [job.id, job.timeout]));
    for (const [id, minutes] of Object.entries(jobs)) {
      assert.equal(parsed.get(id), minutes, `${file}: job "${id}" must keep timeout-minutes: ${minutes} - ${fix}`);
    }
  }
});

test("the workflow directory is still discovered by this lint", () => {
  assert.ok(workflows.includes("ci-tests.yml"), "the lint found no workflows, so it proves nothing");
  assert.ok(workflows.length > 20, `expected the whole workflow directory, found ${workflows.length} files`);
});

test("the indentation reader agrees with a real YAML parser", (t) => {
  let yaml;
  try {
    yaml = require("js-yaml");
  } catch {
    return t.skip("js-yaml is not installed; the workflow-file test above still ran");
  }
  for (const file of workflows) {
    const text = read(file);
    const parsed = (yaml.load(text).jobs ?? {});
    const expected = Object.entries(parsed).map(([id, job]) => [id, job["timeout-minutes"]]);
    const actual = jobsIn(file, text).map((job) => [job.id, job.timeout]);
    assert.deepEqual(actual, expected, `${file}: the indentation reader and js-yaml disagree`);
  }
});
