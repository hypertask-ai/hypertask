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

test("production build names the builder the heap cap bounds", () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.match(
    pkg.scripts.build,
    /next build --webpack\b/,
    "the build script must name --webpack: --max-old-space-size caps the V8 heap only, and Turbopack's Rust " +
      "side ignores it, so an implicit builder OOM-kills the 8 GB build container instead of failing with a " +
      "heap error (HYCI-61)",
  );
});

test("production build caps webpack parallelism at the build machine's cores", () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const parallelism = /NEXT_WEBPACK_PARALLELISM=(\d+)/.exec(pkg.scripts.build);
  assert.ok(
    parallelism,
    "the build script must cap webpack parallelism: webpack defaults it to 100 concurrent module builds, and " +
      "each concurrent SWC transform holds native memory outside the V8 heap cap, so the 8 GB build container is " +
      "OOM-killed while the heap is still inside its own cap (HTPR-8342)",
  );
  const VERCEL_STANDARD_MACHINE_CORES = 4;
  const MEASURED_SAFE_PARALLELISM = 2;
  assert.ok(
    Number(parallelism[1]) <= MEASURED_SAFE_PARALLELISM,
    `webpack parallelism ${parallelism[1]} must stay at ${MEASURED_SAFE_PARALLELISM}: one module build per core ` +
      `(${VERCEL_STANDARD_MACHINE_CORES}) still OOM-killed five production builds of the 8 GB / ${VERCEL_STANDARD_MACHINE_CORES} vCPU ` +
      "build machine on 2026-11-03 (HYCI-98)",
  );
});
