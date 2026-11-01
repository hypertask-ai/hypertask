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
  canReachPage,
  nextChunkRecoveryAttempt,
  stripChunkRecoveryParam,
} = loaded.exports;

function mockBrowser(t, { userAgent, online = true, fetchPage }) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: online, userAgent },
  });
  globalThis.fetch = fetchPage;
  t.after(() => {
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
    globalThis.fetch = originalFetch;
  });
}

test("chunk recovery is capped and tolerates a corrupt session value", () => {
  assert.equal(nextChunkRecoveryAttempt(null), 1);
  assert.equal(nextChunkRecoveryAttempt("1"), 2);
  assert.equal(nextChunkRecoveryAttempt("2"), null);
  assert.equal(nextChunkRecoveryAttempt("not-a-number"), 1);
  assert.equal(nextChunkRecoveryAttempt("-1"), 1);
});

test("desktop chunk recovery does not depend on a second network probe", async (t) => {
  let requests = 0;
  mockBrowser(t, {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148.0.0.0",
    fetchPage: async () => {
      requests += 1;
      throw new Error("timed out");
    },
  });

  assert.equal(await canReachPage("https://app.hypertask.ai/login", 1), true);
  assert.equal(requests, 0);
});

test("native chunk recovery still requires a reachable document", async (t) => {
  let requests = 0;
  mockBrowser(t, {
    userAgent: "Mozilla/5.0 Android 16 wv HypertaskApp",
    fetchPage: async () => {
      requests += 1;
      throw new Error("timed out");
    },
  });

  assert.equal(await canReachPage("https://app.hypertask.ai/login", 1), false);
  assert.equal(requests, 1);
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
