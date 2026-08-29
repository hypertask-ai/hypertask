const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const modulePath = path.join(
  __dirname,
  "../.github/scripts/relocate-eslint-cache.mjs",
);

test("relocates absolute ESLint cache paths between self-hosted runners", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "eslint-cache-relocate-"));
  const cachePath = path.join(directory, ".eslintcache");
  const oldWorkspace = "/home/runner-5/_work/hypertasks/hypertasks";
  const newWorkspace = "/home/runner-3/_work/hypertasks/hypertasks";
  const cache = [
    {
      [path.join(oldWorkspace, "eslint.config.mjs")]: "1",
      [path.join(oldWorkspace, "src/example.ts")]: "2",
      "/outside/workspace.ts": "3",
    },
    { size: 123 },
  ];
  writeFileSync(cachePath, JSON.stringify(cache));

  const { relocateEslintCache } = await import(modulePath);
  const result = relocateEslintCache(cachePath, newWorkspace);
  const relocated = JSON.parse(readFileSync(cachePath, "utf8"));

  assert.deepEqual(result, { status: "relocated", relocated: 2 });
  assert.equal(relocated[0][path.join(newWorkspace, "eslint.config.mjs")], "1");
  assert.equal(relocated[0][path.join(newWorkspace, "src/example.ts")], "2");
  assert.equal(relocated[0]["/outside/workspace.ts"], "3");
  assert.equal(relocated[0][path.join(oldWorkspace, "src/example.ts")], undefined);
  assert.deepEqual(relocated[1], { size: 123 });
});
