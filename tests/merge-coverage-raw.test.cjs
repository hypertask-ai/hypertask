const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const script = path.join(__dirname, "..", ".github", "scripts", "merge-coverage-raw.mjs");
const load = () => import(pathToFileURL(script).href);

function lane(root, name, dumps) {
  const dir = path.join(root, name, "coverage", "raw");
  mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(dumps)) writeFileSync(path.join(dir, file), body);
  return dir;
}

function coverageDump(url) {
  return JSON.stringify({
    result: [
      {
        scriptId: "1",
        url,
        functions: [{ functionName: "", ranges: [{ startOffset: 0, endOffset: 10, count: 1 }], isBlockCoverage: true }],
      },
    ],
  });
}

test("two lanes that name a dump the same both survive the merge", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "merge-coverage-"));
  const out = path.join(root, "out");
  const first = lane(root, "coverage-lane-0", { "coverage-1-1-0.json": coverageDump("file:///one.js") });
  const second = lane(root, "coverage-lane-1", { "coverage-1-1-0.json": coverageDump("file:///two.js") });
  const { mergeCoverageRaw } = await load();

  const merged = await mergeCoverageRaw(out, [first, second]);

  assert.deepEqual(merged, { files: 2, lanes: 2 });
  const written = readdirSync(out).sort();
  assert.equal(written.length, 2);
  assert.deepEqual(written.map((name) => JSON.parse(readFileSync(path.join(out, name), "utf8")).result[0].url).sort(), [
    "file:///one.js",
    "file:///two.js",
  ]);
});

test("a merged directory stays flat because c8 reads it with one readdir", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "merge-coverage-flat-"));
  const out = path.join(root, "out");
  const only = lane(root, "coverage-lane-3", { "coverage-2-2-0.json": coverageDump("file:///three.js") });
  const { mergeCoverageRaw } = await load();

  await mergeCoverageRaw(out, [only]);

  for (const name of readdirSync(out)) {
    assert.ok(name.endsWith(".json"), `${name} is a file, not a directory`);
  }
});

test("a lane that produced no coverage is skipped, a missing lane fails loudly", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "merge-coverage-missing-"));
  const out = path.join(root, "out");
  const empty = lane(root, "coverage-lane-0", {});
  const filled = lane(root, "coverage-lane-1", { "coverage-3-3-0.json": coverageDump("file:///four.js") });
  const { mergeCoverageRaw } = await load();

  assert.deepEqual(await mergeCoverageRaw(out, [empty, filled]), { files: 1, lanes: 1 });
  await assert.rejects(
    () => mergeCoverageRaw(out, [path.join(root, "coverage-lane-9", "coverage", "raw")]),
    /missing coverage directory/,
  );
});
