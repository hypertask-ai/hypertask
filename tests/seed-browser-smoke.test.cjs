const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts/seed-browser-smoke.mjs"), "utf8");
const start = source.indexOf("  if (allFlagsOn) {", source.indexOf("try {"));
const end = source.indexOf("  const flags =", start);

// Execute the real seed branch without starting a browser or touching a database.
test("local browser smoke persists per-flag defaults and respects flag overrides", async () => {
  assert.ok(start >= 0 && end > start);
  const { localFlagModes } = await import("../scripts/premerge-local-flags.mjs");
  const defaults = { feature: "OWNER_AND_QA", bugfix: "EVERYONE", explicit: "OFF", owner: "OWNER_ONLY", released: "OFF" };
  for (const overrides of [[], ["--flag", "bugfix=OFF", "--flag", "explicit=OWNER_AND_QA"]]) {
    const stored = {};
    let saved;
    const run = new (Object.getPrototypeOf(async function () {}).constructor)(
      "jiti", "path", "root", "process", "localFlagModes", "readPlainQaFlags", "writeFile", "stateFile", "prisma",
      `const allFlagsOn = false, liveLikeControl = false, localPremerge = true; let modes = {};\n${source.slice(start, end)}\nreturn modes;`,
    );
    const modes = await run(
      () => ({ FEATURE_FLAG_KEYS: Object.keys(defaults), defaultFeatureFlagMode: key => defaults[key] }),
      path, root, { argv: ["node", "seed-browser-smoke.mjs", ...overrides] }, localFlagModes,
      async () => ({ released: true, bugfix: false }),
      async (_file, content) => { saved = JSON.parse(content).modes; }, path.join(root, "e2e/smoke/.state/test/state.json"),
      { featureFlag: { upsert: async ({ where, create, update }) => {
        assert.equal(create.key, where.key);
        assert.equal(create.mode, update.mode);
        stored[where.key] = create.mode;
      } } },
    );
    assert.deepEqual(modes, {
      ...defaults, released: "EVERYONE",
      ...(overrides.length ? { bugfix: "OFF", explicit: "OWNER_AND_QA" } : {}),
    });
    assert.deepEqual(stored, modes);
    assert.deepEqual(saved, modes);
  }
});
