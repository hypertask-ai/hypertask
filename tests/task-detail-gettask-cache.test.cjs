// HTPR-6281 QA fail #2: getTask was answering as a public CDN-cacheable
// response while comments used private no-store. Activity updated; the side
// panel kept a stale snapshot.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("getTask sets private no-store and Vary Cookie like comments", () => {
  const source = read("src/pages/api/tasks/getTask.ts");
  assert.match(source, /Cache-Control["'],\s*["']private, no-store["']/);
  assert.match(source, /Vary["'],\s*["']Cookie["']/);
});

test("detailMeta sets private no-store so priority/label satellite fetches cannot be CDN-shared", () => {
  const source = read("src/pages/api/tasks/detailMeta.ts");
  assert.match(source, /Cache-Control["'],\s*["']private, no-store["']/);
  assert.match(source, /Vary["'],\s*["']Cookie["']/);
});

test("realtime getTask URL includes a cache-bust query", () => {
  const source = read("src/hooks/realtime/useTaskCommentsRealtime.ts");
  assert.match(
    source,
    /\/api\/tasks\/getTask\?project=project-\$\{projectId\}&uniqueIndex=\$\{uniqueIndex\}&_=\$\{Date\.now\(\)\}/
  );
});
