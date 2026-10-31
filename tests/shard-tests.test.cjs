const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, readFile, rm, writeFile, mkdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("count split covers every file once and stays within one file across shards", async () => {
  const { partition, assertPartition } = await import("../.github/scripts/shard-tests.mjs");
  const files = ["tests/b.test.cjs", "tests/a.test.cjs", "tests/c.test.ts", "tests/a.test.cjs"];
  assert.throws(() => partition(files, 2), /duplicate test file tests\/a\.test\.cjs/);
  const once = ["tests/b.test.cjs", "tests/a.test.cjs", "tests/c.test.ts", "tests/d.test.cjs", "tests/e.test.ts"];
  const shards = partition(once, 2);
  const summary = assertPartition([...once].sort(), shards);
  assert.deepEqual(summary.sizes, [3, 2]);
  assert.deepEqual(shards[0], ["tests/a.test.cjs", "tests/c.test.ts", "tests/e.test.ts"]);
  assert.deepEqual(shards[1], ["tests/b.test.cjs", "tests/d.test.cjs"]);
  assert.deepEqual(partition(once, 2), partition([...once].reverse(), 2));
  assert.throws(() => partition(once, 0), /positive integer/);
  const withEmpty = partition(["tests/only.test.cjs"], 2);
  assert.deepEqual(withEmpty.map((shard) => shard.length), [1, 0]);
  assertPartition(["tests/only.test.cjs"], withEmpty);
});

test("an empty list is refused instead of skipping the suite", () => {
  const result = spawnSync(process.execPath, [
    ".github/scripts/shard-tests.mjs",
    "--count", "2",
    "--out", path.join(tmpdir(), "shard-empty"),
  ], { input: "\n", encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /empty test list/);
});

test("the real tests directory splits once with no duplicates", async () => {
  const { discoverSupportedTests, partition, assertPartition, writePartition, readPartition } = await import("../.github/scripts/shard-tests.mjs");
  const files = await discoverSupportedTests();
  assert.ok(files.length > 1000, `expected the full suite, got ${files.length}`);
  const shards = partition(files, Number(process.env.CI_TEST_SHARDS || 2));
  const summary = assertPartition([...files].sort(), shards);
  assert.equal(summary.files, files.length);
  assert.ok(Math.max(...summary.sizes) - Math.min(...summary.sizes) <= 1);
  const dir = await mkdtemp(path.join(tmpdir(), "shard-tests-"));
  try {
    await writePartition(dir, shards);
    const read = await readPartition(dir);
    assertPartition(read.all, read.shards);
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.files, files.length);
    assert.deepEqual(manifest.sizes, summary.sizes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proof reads the shard artifacts and rejects a dropped or repeated file", async () => {
  const { writePartition, proveResults, partition } = await import("../.github/scripts/shard-tests.mjs");
  const files = ["tests/a.test.cjs", "tests/b.test.ts", "tests/c.test.cjs"];
  const shards = partition(files, 2);
  const planned = await mkdtemp(path.join(tmpdir(), "shard-planned-"));
  const results = await mkdtemp(path.join(tmpdir(), "shard-results-"));
  try {
    await writePartition(planned, shards);
    for (let index = 0; index < shards.length; index += 1) {
      const dir = path.join(results, `ci-test-shard-${index}`);
      await mkdir(dir);
      const body = shards[index].length ? `${shards[index].join("\n")}\n` : "";
      await writeFile(path.join(dir, `shard-${index}.txt`), body);
      const cjs = shards[index].filter((file) => file.endsWith(".test.cjs")).length;
      const ts = shards[index].filter((file) => file.endsWith(".test.ts")).length;
      const log = shards[index].length === 0
        ? `shard ${index} empty\n`
        : `Test inventory: ${cjs} Node tests, ${ts} TypeScript tests.\n`;
      await writeFile(path.join(dir, `shard-${index}.log`), log);
    }
    const summary = await proveResults(planned, results);
    assert.equal(summary.files, 3);
    assert.deepEqual(summary.sizes, [2, 1]);

    const logPath = path.join(results, "ci-test-shard-0", "shard-0.log");
    await writeFile(logPath, "Test inventory: 1 Node tests, 0 TypeScript tests.\n");
    await assert.rejects(proveResults(planned, results), /inventory 1 != 2/);

    await writeFile(logPath, "Test inventory: 9 Node tests, 0 TypeScript tests.\nTest inventory: 2 Node tests, 0 TypeScript tests.\n");
    await assert.rejects(proveResults(planned, results), /one test inventory line/);

    await writeFile(path.join(results, "ci-test-shard-0", "shard-0.txt"), "tests/a.test.cjs\n");
    await writeFile(logPath, "Test inventory: 2 Node tests, 0 TypeScript tests.\n");
    await assert.rejects(proveResults(planned, results), /different file list/);
  } finally {
    await rm(planned, { recursive: true, force: true });
    await rm(results, { recursive: true, force: true });
  }
});

test("balances shards by measured work instead of file count, deterministically", async () => {
  const { partition, assertPartition, workOf, readDurationWeights } = await import("../.github/scripts/shard-tests.mjs");
  const weights = readDurationWeights(JSON.stringify({
    defaultWorkMs: 250,
    files: {
      "tests/slow.test.cjs": 9000,
      "tests/medium.test.cjs": 4000,
      "tests/serial.test.ts": 3000,
      "tests/quick.test.cjs": 500,
    },
  }));
  const files = ["tests/slow.test.cjs", "tests/medium.test.cjs", "tests/serial.test.ts", "tests/quick.test.cjs", "tests/added.test.cjs"];
  const shards = partition(files, 2, weights);
  const work = workOf(shards, weights);
  assert.ok(Math.max(...work) - Math.min(...work) <= weights.defaultWorkMs + 500,
    `shards are unbalanced: ${work.join(",")}`);
  assert.deepEqual(partition([...files].reverse(), 2, weights), shards);
  assertPartition([...files].sort(), shards, weights);
  assert.throws(() => partition(files, 0, weights), /positive integer/);

  const moved = [shards[0].slice(1), [...shards[0].slice(0, 1), ...shards[1]]];
  assert.throws(() => assertPartition([...files].sort(), moved, weights), /measured work split/);
});

test("an unreadable or empty weights file is refused instead of silently unbalancing", async () => {
  const { readDurationWeights } = await import("../.github/scripts/shard-tests.mjs");
  assert.throws(() => readDurationWeights(JSON.stringify({ files: {} })), /defaultWorkMs/);
  assert.throws(() => readDurationWeights("{}"), /files object/);
  assert.throws(() => readDurationWeights(JSON.stringify({ defaultWorkMs: 10, files: { "tests/a.test.cjs": -1 } })), /bad measured work/);
});
