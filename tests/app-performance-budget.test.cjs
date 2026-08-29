const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const checker = path.join(root, "scripts/check-app-performance-budget.mjs");
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(root, "config/app-project-performance-baseline.json"),
    "utf8",
  ),
);
const mobileMetrics = Object.fromEntries(
  Object.entries(baseline.devices.mobile).filter(
    ([key]) => key !== "viewport" && key !== "cpuThrottle",
  ),
);

const runChecker = (trace) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ht-perf-budget-"));
  const tracePath = path.join(directory, "trace.json");
  fs.writeFileSync(tracePath, JSON.stringify(trace));
  try {
    return spawnSync(process.execPath, [checker, tracePath], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

test("the current mobile resource baseline passes", () => {
  const result = runChecker({ deviceClass: "mobile", ...mobileMetrics });
  assert.equal(result.status, 0, result.stderr);
});

test("null, string, and negative measurements fail closed", () => {
  for (const invalid of [null, "0", -1]) {
    const result = runChecker({
      deviceClass: "mobile",
      ...mobileMetrics,
      scriptCount: invalid,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /finite, non-negative number/);
  }
});
