const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const helperSource = fs.readFileSync(
  path.join(root, "src/utils/helperFunctions/chunkLoadRecovery.ts"),
  "utf8",
);
const javascript = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", "require", javascript)(
  loaded,
  loaded.exports,
  require,
);

const {
  buildChunkRecoveryUrl,
  nextChunkRecoveryAttempt,
  stripChunkRecoveryParam,
} = loaded.exports;

test("chunk recovery is capped and tolerates a corrupt session value", () => {
  assert.equal(nextChunkRecoveryAttempt(null), 1);
  assert.equal(nextChunkRecoveryAttempt("1"), 2);
  assert.equal(nextChunkRecoveryAttempt("2"), null);
  assert.equal(nextChunkRecoveryAttempt("not-a-number"), 1);
  assert.equal(nextChunkRecoveryAttempt("-1"), 1);
});

test("chunk recovery cache-busts the current document without losing route state", () => {
  const recovered = new URL(
    buildChunkRecoveryUrl(
      "https://app.hypertask.ai/project?id=15&view=android-native#task",
      1,
      1234,
    ),
  );

  assert.equal(recovered.pathname, "/project");
  assert.equal(recovered.searchParams.get("id"), "15");
  assert.equal(recovered.searchParams.get("view"), "android-native");
  assert.equal(recovered.searchParams.get("__ht_chunk_reload"), "1-1234");
  assert.equal(recovered.hash, "#task");
});

test("a successful mount can remove only the recovery marker", () => {
  assert.equal(
    stripChunkRecoveryParam(
      "https://app.hypertask.ai/project?id=15&__ht_chunk_reload=2-99&view=android-native",
    ),
    "https://app.hypertask.ai/project?id=15&view=android-native",
  );
  assert.equal(
    stripChunkRecoveryParam("https://app.hypertask.ai/project?id=15"),
    null,
  );
});

test("global recovery reports only after a safe recovery cannot proceed", () => {
  const globalError = fs.readFileSync(
    path.join(root, "src/app/global-error.tsx"),
    "utf8",
  );
  const providers = fs.readFileSync(
    path.join(root, "src/utils/Providers.tsx"),
    "utf8",
  );

  assert.match(globalError, /if \(isChunkLoadError\(error\)\)/);
  assert.match(globalError, /canReachPage\(recoveryUrl\)/);
  assert.match(globalError, /window\.location\.replace\(recoveryUrl\)/);
  assert.match(globalError, /if \(!reachable\) \{\s*report\(\)/);
  assert.match(providers, /CHUNK_RECOVERY_STABLE_MS = 30 \* 1000/);
  assert.match(
    providers,
    /setTimeout\(\(\) => \{[\s\S]*removeItem\(CHUNK_RELOAD_STORAGE_KEY\)/,
  );
  assert.match(providers, /return \(\) => window\.clearTimeout\(stableTimer\)/);
  assert.match(providers, /stripChunkRecoveryParam\(window\.location\.href\)/);
});
