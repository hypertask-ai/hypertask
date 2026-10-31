const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync, readdirSync } = require("node:fs");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const POSTGRES_RUN = `const { spawn } = require("node:child_process");
spawn("docker", ["run", "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:00"]);`;
const REDIS_RUN = `const { spawn } = require("node:child_process");
spawn("docker", ["run", "ghcr.io/hypertask-ai/ci-redis:7-alpine@sha256:00"]);`;
const SOURCE_TEXT_GUARD = `const reference = (image) => \`ghcr.io/hypertask-ai/ci-\${image}:tag\`;
assert.equal(reference("postgres"), "ghcr.io/hypertask-ai/ci-postgres:tag");`;
const PLAIN_TEST = `assert.equal(1 + 1, 2);`;

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "shard-containers-"));
  await Promise.all(Object.entries(files).map(([name, body]) => writeFile(path.join(root, name), body)));
  return root;
}

test("a container test is found by what it runs, not by its name", async () => {
  const { fixturesNeeded } = await import("../.github/scripts/shard-containers.mjs");
  const root = await fixture({
    "htpr-7038-model-reset.test.cjs": POSTGRES_RUN,
    "mcp-transports.test.ts": REDIS_RUN,
    "ci-images.test.cjs": SOURCE_TEXT_GUARD,
    "plain.test.cjs": PLAIN_TEST,
  });
  try {
    const read = (name) => `${root}/${name}`;
    assert.deepEqual(fixturesNeeded([read("htpr-7038-model-reset.test.cjs")]), { containers: true, postgres: true });
    assert.deepEqual(fixturesNeeded([read("mcp-transports.test.ts")]), { containers: true, postgres: false });
    assert.deepEqual(fixturesNeeded([read("ci-images.test.cjs")]), { containers: false, postgres: false });
    assert.deepEqual(fixturesNeeded([read("plain.test.cjs")]), { containers: false, postgres: false });
    assert.deepEqual(fixturesNeeded([read("plain.test.cjs"), read("mcp-transports.test.ts")]), { containers: true, postgres: false });
    assert.deepEqual(fixturesNeeded([read("missing.test.cjs")]), { containers: false, postgres: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every committed postgres suite still asks for the image", async () => {
  const { fixturesNeeded } = await import("../.github/scripts/shard-containers.mjs");
  const suites = readdirSync("tests").filter((name) => name.endsWith("-postgres.test.cjs")).map((name) => path.join("tests", name));
  assert.ok(suites.length > 0, "postgres suites must exist");
  for (const suite of suites) {
    assert.equal(fixturesNeeded([suite]).postgres, true, `${suite} must pull the image`);
  }
});

test("the shard job writes the outputs it reads, from its own shard list", async () => {
  const ui = yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));
  const job = ui.jobs["ci-test"];
  const decide = job.steps.find((step) => step.id === "pg");
  assert.equal(decide.name, "Decide shard container fixtures");
  assert.equal(decide.run, 'node .github/scripts/shard-containers.mjs "ci-test-shards/shard-${{ matrix.shard }}.txt" >> "$GITHUB_OUTPUT"');
  const login = job.steps.find((step) => step.uses?.startsWith("docker/login-action@"));
  assert.equal(login.if, "steps.pg.outputs.containers == '1'");
  assert.equal(job.steps.find((step) => step.name === "Pull PostgreSQL test image").if, "steps.pg.outputs.need == '1'");
  assert.match(job.steps.find((step) => step.id === "push-test").env.HT_REQUIRE_PG_TESTS, /steps\.pg\.outputs\.need/);

  const root = await mkdtemp(path.join(tmpdir(), "shard-containers-cli-"));
  try {
    const list = path.join(root, "shard-4.txt");
    await writeFile(list, `tests/mcp-transports.test.ts\n${path.join(root, "plain.test.cjs")}\n`);
    await writeFile(path.join(root, "plain.test.cjs"), PLAIN_TEST);
    const printed = execFileSync(process.execPath, [".github/scripts/shard-containers.mjs", list], { encoding: "utf8" });
    assert.equal(printed, "containers=1\nneed=\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the printed lines are the key=value pairs $GITHUB_OUTPUT accepts", async () => {
  const { outputLines } = await import("../.github/scripts/shard-containers.mjs");
  for (const needed of [{ containers: true, postgres: true }, { containers: true, postgres: false }, { containers: false, postgres: false }]) {
    for (const line of outputLines(needed)) assert.match(line, /^[A-Za-z_]+=[^\n]*$/);
  }
});
