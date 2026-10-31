const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const modulePath = path.join(__dirname, "../.github/scripts/ts-route-surface.mjs");

function listing(...lines) {
  return `${lines.join("\n")}\n`;
}

const ROUTES = listing(
  "100644 aaaa1111 0\tsrc/app/page.tsx",
  "100644 bbbb2222 0\tsrc/app/api/tickets/route.ts",
  "100644 cccc3333 0\tpackage-lock.json",
);

test("the route surface is stable across listing order", async () => {
  const { routeSurface } = await import(modulePath);
  const forward = routeSurface("/repo", () => ROUTES);
  const reversed = routeSurface("/repo", () => {
    const lines = ROUTES.trim().split("\n").reverse();
    return listing(...lines);
  });
  assert.ok(forward, "a real route surface must hash");
  assert.equal(forward, reversed);
});

test("changing a route file changes the surface", async () => {
  const { routeSurface } = await import(modulePath);
  const before = routeSurface("/repo", () => ROUTES);
  const after = routeSurface("/repo", () =>
    listing(
      "100644 aaaa1111 0\tsrc/app/page.tsx",
      "100644 dddd4444 0\tsrc/app/api/tickets/route.ts",
      "100644 cccc3333 0\tpackage-lock.json",
    ),
  );
  assert.notEqual(before, after);
});

test("an empty or unlistable surface never claims a match", async () => {
  const { routeSurface, matchesCachedSurface } = await import(modulePath);
  assert.equal(routeSurface("/repo", () => ""), null);
  assert.equal(routeSurface("/repo", () => "\n"), null);
  assert.equal(matchesCachedSurface("/nonexistent/surface", null), false);
});

test("a cached surface only matches the same text", async () => {
  const { routeSurface, matchesCachedSurface, writeCachedSurface } =
    await import(modulePath);
  const directory = mkdtempSync(path.join(os.tmpdir(), "ts-route-surface-"));
  const cacheFile = path.join(directory, "nested", "route-surface");
  const surface = routeSurface("/repo", () => ROUTES);
  assert.equal(matchesCachedSurface(cacheFile, surface), false);
  assert.equal(writeCachedSurface(cacheFile, surface), true);
  assert.equal(matchesCachedSurface(cacheFile, surface), true);
  writeFileSync(cacheFile, "stale\n");
  assert.equal(matchesCachedSurface(cacheFile, surface), false);
});
