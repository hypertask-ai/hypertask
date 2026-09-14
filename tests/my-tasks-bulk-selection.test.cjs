const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");

const helperTs = path.join(__dirname, "../src/lib/myTasksBulkSelection.ts");
const outfile = path.join(os.tmpdir(), `my-tasks-bulk-helpers-${process.pid}.cjs`);
execFileSync(
  "npx",
  [
    "esbuild",
    helperTs,
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${outfile}`,
  ],
  { stdio: "pipe" },
);
const { sharedProjectId, visibleTaskIdsFromRows } = require(outfile);
fs.unlinkSync(outfile);

test("sharedProjectId accepts one board and rejects mixed boards", () => {
  assert.equal(sharedProjectId([]), null);
  assert.equal(
    sharedProjectId([
      { id: 1, projectId: 15 },
      { id: 2, projectId: 15 },
    ]),
    15,
  );
  assert.equal(
    sharedProjectId([
      { id: 1, projectId: 15 },
      { id: 2, projectId: 22 },
    ]),
    null,
  );
  assert.equal(sharedProjectId([{ id: 1, projectId: null }]), null);
});

test("visibleTaskIdsFromRows keeps only task rows in render order", () => {
  assert.deepEqual(
    visibleTaskIdsFromRows([
      { type: "task", task: { id: 10 } },
      { type: "more" },
      { type: "task", task: { id: 11 } },
    ]),
    [10, 11],
  );
  console.log("my-tasks bulk selection helpers passed");
});
