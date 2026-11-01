const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
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
            return require("@posthog/nextjs-config").withPostHogConfig({
              ...config,
              env: { ...config.env, POSTHOG_RELEASE_ID: "build-memory-test-release" },
            }, options);
          },
        };
      };
      configRequire.resolve = createRequire(path.join(__dirname, "..", "next.config.js")).resolve;
      new Function("require", "module", "process", "__dirname", source)(
        configRequire, configModule, { env, execPath: process.execPath }, path.resolve(__dirname, ".."),
      );
      const config = typeof configModule.exports === "function"
        ? await configModule.exports("phase-production-build", { defaultConfig: {} })
        : configModule.exports;
      assert.equal(wrapped, posthog);
      if (posthog) assert.equal(config.env.POSTHOG_RELEASE_ID, "build-memory-test-release");
      assert.equal(config.experimental.webpackBuildWorker, true);
      assert.equal(config.experimental.webpackMemoryOptimizations, true);
      assert.equal(typeof config.webpack, "function");
      assert.equal(config.turbopack.resolveAlias["vfile-message"], path.resolve(__dirname, "..", "src/lib/vendor/vfile-message.mjs"));
      assert.equal(config.experimental.cpus, 1);
      assert.equal(config.experimental.turbopackMemoryEviction, "full");
      assert.equal(config.experimental.parallelServerBuildTraces, smoke);
      assert.equal(config.experimental.parallelServerCompiles, undefined);
      assert.equal(config.productionBrowserSourceMaps, true);
      assert.equal(config.outputFileTracingExcludes, undefined);
      assert.deepEqual(config.serverExternalPackages, ["isomorphic-dompurify", "jsdom", "pusher", "aws-sdk"]);
    });
  }
}

test("production build heap cap leaves half the build machine for native memory", () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const cap = /--max-old-space-size=(\d+)/.exec(pkg.scripts.build);
  assert.ok(cap, "the production build sets a heap cap");
  const VERCEL_STANDARD_MACHINE_MB = 8192;
  assert.ok(
    Number(cap[1]) <= VERCEL_STANDARD_MACHINE_MB / 2,
    `heap cap ${cap[1]} MB must stay within half of the ${VERCEL_STANDARD_MACHINE_MB} MB build machine, ` +
      "or the parent Next process, native webpack memory and the page worker run the container out of memory " +
      "(YPER4-957)",
  );
});
