const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// HTPR-6047: the readiness effect's rAF+MutationObserver path can silently
// lose its scheduled check across a tab freeze/resume (backgrounding,
// sleep/wake, OS-level suspension) - reproduced live via CDP
// Page.setWebLifecycleState. A plain setInterval poll keeps firing across
// that gap and catches usability even when the primary path drops its
// pending check, so the mark - and the app_task_detail_readiness event -
// still fires instead of hitting the 30s usable_state_timeout.
const source = fs.readFileSync(
  path.join(__dirname, "../src/app/detail/[...slug]/TaskDetailComp.tsx"),
  "utf8",
);

test("the readiness effect has a fallback poll for checkReady", () => {
  assert.match(source, /let poll: ReturnType<typeof setInterval> \| undefined;/);
  assert.match(source, /poll = setInterval\(checkReady, 250\);/);
});

test("cleanup always clears the fallback poll", () => {
  const readinessEffectMatch = source.match(
    /let poll: ReturnType<typeof setInterval> \| undefined;[\s\S]*?return cleanup;/,
  );
  assert.ok(readinessEffectMatch, "readiness effect body not found");
  const cleanupMatch = readinessEffectMatch[0].match(
    /const cleanup = \(\) => \{[\s\S]*?\n {4}\};/,
  );
  assert.ok(cleanupMatch, "cleanup() body not found");
  assert.match(cleanupMatch[0], /if \(poll\) clearInterval\(poll\);/);
});

test("the poll is armed before the effect returns cleanup", () => {
  const readinessEffectMatch = source.match(
    /observer = new MutationObserver\(scheduleCheck\);[\s\S]*?return cleanup;/,
  );
  assert.ok(readinessEffectMatch, "readiness effect wiring not found");
  const wiring = readinessEffectMatch[0];
  const pollIndex = wiring.indexOf("poll = setInterval(checkReady, 250);");
  const returnIndex = wiring.indexOf("return cleanup;");
  assert.ok(pollIndex > -1 && pollIndex < returnIndex);
});
