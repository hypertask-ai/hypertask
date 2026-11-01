const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { validateGoogleFontFunctionCall } = require("next/dist/compiled/@next/font/dist/google/validate-google-font-function-call");
const { getFallbackFontOverrideMetrics } = require("next/dist/compiled/@next/font/dist/google/get-fallback-font-override-metrics");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/lib/fonts/ibmPlexSans.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(name => {
  assert.equal(name, "next/font/google");
  return { IBM_Plex_Sans: options => options };
}, loaded, loaded.exports);
const options = loaded.exports.ibmPlexSans;

test("Plex already has Next's size-adjust fallback enabled; swap is not a zero-shift guarantee", () => {
  assert.equal(options.variable, "--font-plex");
  assert.equal(options.weight, "variable");
  assert.deepEqual(options.subsets, ["latin"]);
  assert.equal(options.display, "swap");
  assert.equal(options.preload, true);
  const validated = validateGoogleFontFunctionCall("IBM_Plex_Sans", options);
  assert.equal(validated.adjustFontFallback, true);
  const metrics = getFallbackFontOverrideMetrics(validated.fontFamily);
  assert.equal(metrics.fallbackFont, "Arial");
  for (const key of ["ascentOverride", "descentOverride", "lineGapOverride", "sizeAdjust"]) {
    assert.match(metrics[key], /^\d+(?:\.\d+)?%$/);
  }
});

test("description smoke measures cold fonts and every first-paint box at the actual phone width", () => {
  const smoke = fs.readFileSync(path.join(root, "e2e/smoke/layout-lock.spec.ts"), "utf8");
  const start = smoke.indexOf("type DescriptionFrame =");
  const end = smoke.indexOf("const CLS_BUDGET = 0.05", start);
  assert.ok(start >= 0 && end > start, "description regression block not found in layout-lock.spec.ts");
  const regression = smoke.slice(start, end);
  assert.match(regression, /width: 390, height: 844/);
  assert.match(regression, /Network\.setCacheDisabled.*cacheDisabled: true/);
  assert.match(regression, /Network\.setBypassServiceWorker.*bypass: true/);
  assert.match(regression, /Emulation\.setCPUThrottlingRate.*rate: 4/);
  assert.ok(regression.indexOf("page.addInitScript") < regression.indexOf("page.goto"));
  assert.match(regression, /requestAnimationFrame\(sample\)/);
  assert.match(regression, /frames\[0\]\.live[\s\S]*?\.toBe\(false\)/);
  assert.match(regression, /frames\[frames\.length - 1\]\.live[\s\S]*?\.toBe\(true\)/);
  assert.match(regression, /const sameFont = frames\.find\(other => other\.fontReady === frame\.fontReady\)/);
  assert.match(regression, /expect\(frame\.height,[\s\S]*?\.toBe\(sameFont\.height\)/);
  assert.match(regression, /expect\(frame\.chain,[\s\S]*?\.toEqual\(first\.chain\)/);
});
