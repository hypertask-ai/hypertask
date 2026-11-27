const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = readFileSync(path.join(root, "next.config.js"), "utf8");

function loadConfig(env = {}) {
  const configRequire = (specifier) => {
    if (specifier === "node:child_process" || specifier === "child_process") {
      return { execFileSync: () => Buffer.from(""), execSync: () => Buffer.from("") };
    }
    if (["@next/bundle-analyzer", "next-pwa"].includes(specifier)) return () => (config) => config;
    if (specifier === "./scripts/build-memory-plugin.cjs") return require("../scripts/build-memory-plugin.cjs");
    assert.equal(specifier, "@posthog/nextjs-config");
    return { withPostHogConfig: (config) => config };
  };
  const resolveFromConfig = createRequire(path.join(root, "next.config.js")).resolve;
  configRequire.resolve = (specifier) =>
    specifier === "react-joyride"
      ? path.join(root, "node_modules", "react-joyride", "index.js")
      : resolveFromConfig(specifier);
  const configModule = { exports: {} };
  new Function("require", "module", "process", "__dirname", source)(
    configRequire,
    configModule,
    { env: { BUILD_ID: "next-dev-hydration-test", ...env }, execPath: process.execPath },
    root,
  );
  return configModule.exports;
}

test("the React debug channel stays off so the inline Flight payload resolves in dev", () => {
  const config = loadConfig();
  assert.equal(
    config.experimental?.reactDebugChannel,
    false,
    "Keep experimental.reactDebugChannel false. Next 16 defaults it on, and with it on the dev flight client waits for React stack chunks the dev HTML never sends, so the inline payload never resolves, hydrateRoot never runs, and the board stalls on \"Loading board…\" (HTPR-9750).",
  );
});

test("a PostHog-wrapped config still carries the dev hydration switch", () => {
  const config = loadConfig({
    POSTHOG_PERSONAL_API_KEY: "test-only",
    POSTHOG_SERVER_PROJECT_ID: "test-project",
  });
  assert.equal(config.experimental?.reactDebugChannel, false);
});
