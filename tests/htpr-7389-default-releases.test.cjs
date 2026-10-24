const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const key = "htpr-7389-default-release";
const protectedKey = "htpr-7389-protected";
const now = Date.parse("2026-10-24T12:00:00Z");
const releasedAt = new Date(now - 40 * 60_000);
const releases = {};
let rows;
let writes;
let locks;
function stub(relative, exports) {
  const filename = path.join(root, relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const prisma = {
  $transaction: async (run) => run(prisma),
  $executeRaw: async (_sql, namespace, lockedKey) => {
    assert.equal(namespace, 6193);
    locks.push(lockedKey);
  },
  featureFlag: {
    findUnique: async ({ where }) => {
      assert.equal(locks.at(-1), where.key);
      return rows.get(where.key) ?? null;
    },
    upsert: async (query) => {
      writes.push(query);
      rows.set(query.where.key, { ...(rows.get(query.where.key) ?? query.create), ...query.update });
    },
  },
};
stub("src/lib/prisma.ts", { __esModule: true, default: prisma });
stub("src/lib/flags/definitions.ts", { FEATURE_FLAG_DEFINITIONS: [
  { key, defaultMode: "EVERYONE" },
  { key: protectedKey, defaultMode: "OWNER_AND_QA" },
] });
stub("src/lib/flags/definitions/index.generated.ts", { PRODUCTION_FLAG_RELEASES: releases });
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { recordDefaultFeatureFlagReleases } = jiti(path.join(root, "src/lib/flags.ts"));

test.beforeEach((t) => {
  t.mock.method(Date, "now", () => now);
  for (const name of Object.keys(releases)) delete releases[name];
  releases[key] = releasedAt.toISOString();
  rows = new Map(); writes = []; locks = [];
});

test("default-on release receives its server build timestamp under the mode lock", async () => {
  await recordDefaultFeatureFlagReleases();
  assert.deepEqual(locks, [key]);
  assert.deepEqual(writes, [{ where: { key }, create: { key, mode: "EVERYONE", releasedAt }, update: { releasedAt } }]);
  assert.deepEqual(rows.get(key), { key, mode: "EVERYONE", releasedAt });
  await recordDefaultFeatureFlagReleases();
  assert.equal(writes.length, 1);
});

test("existing Everyone row without a timestamp receives the same trusted metadata", async () => {
  rows.set(key, { mode: "EVERYONE", releasedAt: null });
  await recordDefaultFeatureFlagReleases();
  assert.equal(writes.length, 1);
  assert.deepEqual(rows.get(key), { mode: "EVERYONE", releasedAt });
});

for (const mode of ["OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"]) {
  test(`enrollment never overwrites ${mode} or an established release time`, async () => {
    const row = { mode, releasedAt: mode === "EVERYONE" ? new Date(now - 5 * 60_000) : null };
    rows.set(key, row);
    await recordDefaultFeatureFlagReleases();
    assert.equal(writes.length, 0);
    assert.equal(rows.get(key), row);
  });
}

for (const release of ["invalid", new Date(now + 1).toISOString(), new Date(now - 71 * 60_000).toISOString()]) {
  test(`invalid, future or stale server metadata is not enrolled: ${release}`, async () => {
    releases[key] = release;
    await recordDefaultFeatureFlagReleases();
    assert.equal(writes.length, 0);
    assert.equal(locks.length, 0);
  });
}

test("protected defaults, undeclared flags and missing metadata are not enrolled", async () => {
  delete releases[key];
  releases[protectedKey] = releasedAt.toISOString();
  releases["htpr-7389-unknown"] = releasedAt.toISOString();
  await recordDefaultFeatureFlagReleases();
  assert.equal(writes.length, 0);
  assert.equal(locks.length, 0);
});

test("production metadata is bound to the build commit, excludes shallow roots and is absent in previews", async (t) => {
  const { productionFlagReleases } = await import("../scripts/generate-flag-index.mjs");
  const sha = "a".repeat(40);
  const env = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "production", VERCEL_GIT_COMMIT_SHA: sha };
  const calls = [];
  const git = (command, args, options) => {
    calls.push(args);
    assert.equal(command, "git");
    assert.equal(options.cwd, root);
    return args[0] === "rev-parse" ? sha : `${releasedAt.getTime() / 1000}\n\nsrc/lib/flags/definitions/${key}.ts\nsrc/lib/flags/definitions/index.generated.ts\n`;
  };
  assert.deepEqual(productionFlagReleases(root, env, git), { [key]: releasedAt.toISOString() });
  assert.ok(calls[1].includes("--min-parents=1"));
  assert.ok(calls[1].includes("--first-parent"));
  assert.ok(calls[1].includes("--diff-filter=A"));
  const refuseGit = () => { throw new Error("Git must not run"); };
  for (const changed of [{ VERCEL_ENV: "preview" }, { VERCEL_GIT_COMMIT_REF: "feature" }, { VERCEL_GIT_COMMIT_SHA: "bad" }]) {
    assert.deepEqual(productionFlagReleases(root, { ...env, ...changed }, refuseGit), {});
  }
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  assert.deepEqual(productionFlagReleases(root, env, () => "b".repeat(40)), {});
  assert.deepEqual(productionFlagReleases(root, env, refuseGit), {});
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((message) => message.includes("default-on flags will not be enrolled")));
  assert.deepEqual(productionFlagReleases(root, env, (_command, args) => args[0] === "rev-parse" ? sha : ""), {});
});
