const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = readFileSync(path.join(__dirname, "..", "next.config.js"), "utf8");

for (const smoke of [false, true]) {
  for (const posthog of [false, true]) {
    test(`build memory limits survive smoke=${smoke} and PostHog=${posthog}`, async () => {
      const configModule = { exports: {} };
      let wrapped = false;
      const env = {
        BUILD_ID: "build-memory-test",
        CORE_APP_SMOKE: String(smoke),
        ...(posthog ? {
          POSTHOG_PERSONAL_API_KEY: "test-only",
          POSTHOG_SERVER_PROJECT_ID: "test-project",
        } : {}),
      };
      const configRequire = (specifier) => {
        if (specifier === "node:child_process") return { execFileSync: (_node, args, options) => {
          assert.deepEqual(args, ["scripts/generate-flag-index.mjs"]);
          assert.equal(options.cwd, path.resolve(__dirname, ".."));
        } };
        if (["@next/bundle-analyzer", "next-pwa"].includes(specifier)) {
          return () => (config) => config;
        }
        assert.equal(specifier, "@posthog/nextjs-config");
        return {
          withPostHogConfig(config, options) {
            wrapped = true;
            assert.equal(options.sourcemaps.enabled, true);
            return require("@posthog/nextjs-config").withPostHogConfig(config, options);
          },
        };
      };
      new Function("require", "module", "process", "__dirname", source)(
        configRequire, configModule, { env, execPath: process.execPath }, path.resolve(__dirname, ".."),
      );
      const config = typeof configModule.exports === "function"
        ? await configModule.exports("phase-production-build", { defaultConfig: {} })
        : configModule.exports;
      assert.equal(wrapped, posthog);
      assert.equal(config.experimental.webpackBuildWorker, true);
      assert.equal(config.experimental.webpackMemoryOptimizations, true);
      assert.equal(config.experimental.cpus, 2);
      assert.equal(config.experimental.parallelServerBuildTraces, smoke);
      assert.equal(config.experimental.parallelServerCompiles, undefined);
      assert.equal(config.productionBrowserSourceMaps, true);
      assert.equal(config.outputFileTracingExcludes, undefined);
      assert.deepEqual(config.serverExternalPackages, ["isomorphic-dompurify", "jsdom"]);
    });
  }
}
