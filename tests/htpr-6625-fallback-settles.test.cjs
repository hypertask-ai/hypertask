// HTPR-6625: a failed planning refresh must not release the poll guard
// while the board refresh is still running.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("board fallback waits for both refreshes before clearing the guard", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/hooks/realtime/useBoardRealtime.ts"),
    "utf8",
  );
  const start = source.indexOf("const runFallbackCycle");
  const end = source.indexOf("const stopFallback");
  assert.ok(start > 0 && end > start);
  const cycle = source.slice(start, end);
  assert.match(cycle, /Promise\.allSettled\(/);
  assert.doesNotMatch(cycle, /Promise\.all\(/);
  assert.match(cycle, /fallbackInFlight = false/);
});
