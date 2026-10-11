const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const script = readFileSync(path.join(__dirname, "..", "scripts", "premerge-local.sh"), "utf8");

test("premerge-local caps the Node heap at 3 GB by default so builds stay under the 6 GB watchdog (YPER4-302)", () => {
  assert.match(script, /export NODE_OPTIONS="\$\{PREMERGE_NODE_OPTIONS:---max-old-space-size=3072\}"/);
});

test("the clean environment passes PREMERGE_NODE_OPTIONS through so callers can override the heap", () => {
  assert.match(script, /env -i [^\n]*PREMERGE_NODE_OPTIONS="\$\{PREMERGE_NODE_OPTIONS:-\}"/);
});

test("the heap default is set after the clean-environment re-exec, before any build step", () => {
  const exec = script.indexOf('PREMERGE_CLEAN_ENV="$root" bash');
  const heap = script.indexOf("export NODE_OPTIONS=");
  const build = script.indexOf("npx --no-install next build");
  assert.ok(exec > 0 && heap > exec && build > heap);
});

test("premerge-local regenerates the flag index before the seed and the build (YPER4-303)", () => {
  const generate = script.indexOf("npm run -s flags:generate");
  assert.ok(generate > 0);
  assert.ok(generate < script.indexOf("node scripts/seed-browser-smoke.mjs"));
  assert.ok(generate < script.indexOf("npx --no-install next build"));
});
