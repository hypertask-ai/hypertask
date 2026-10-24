process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const selfFollowFlag = "yper4-651-self-follow-quiet";
const filename = `src/lib/flags/definitions/${selfFollowFlag}.ts`;
const source = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");

test("self-follow quiet bugfix defaults to Everyone with a small release risk", async () => {
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const { definition } = parseFlagFile(source, filename);
  const flag = load(filename, {});
  assert.equal(flag.YPER4_651_SELF_FOLLOW_QUIET_FLAG, selfFollowFlag);
  assert.equal(definition.key, selfFollowFlag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-24");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.trim());
  assert.deepEqual(flag.default, definition);
});

test("self-follow flag passes the generator's definition check and rejects unsafe or malformed metadata", async () => {
  const { parseFlagFiles } = await import("../.github/scripts/feature-flag-registry.mjs");
  const check = (text) => parseFlagFiles([filename], () => text);
  assert.equal(check(source)[0].identifier, "YPER4_651_SELF_FOLLOW_QUIET_FLAG");
  assert.throws(() => check(source + '\nconsole.log("side effect");'), /use one exported key const/);
  assert.throws(() => check(source.replace("risk: \"small\"", "risk: \"invalid\"")), /releaseRisk needs risk/);
  assert.throws(() => check(source.replace(/reason: "[^"]+"/, "reason: \"\"")), /nonempty one-line reason/);
  assert.equal(check(source)[0].definition.key, selfFollowFlag);
});
