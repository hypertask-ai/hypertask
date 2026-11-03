const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const implementation = import("../scripts/lint-changed-styles.mjs");

const LAYERS = ["base", "sticky", "menu", "floating", "popup", "toast", "tooltip"];

function tracked(patterns) {
  return execFileSync("git", ["ls-files", ...patterns], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((file) => ({ file, source: readFileSync(path.join(root, file), "utf8") }));
}

test("no hand-typed z-index value is left in src", () => {
  const offenders = [];
  for (const { file, source } of tracked(["src"])) {
    if (!/\.(?:[jt]sx?|s?css|css)$/.test(file)) continue;
    for (const match of source.matchAll(/(?<![\w-])z-\[[^\]]*\]/g)) offenders.push(`${file}: ${match[0]}`);
    if (!/\.s?css$/.test(file)) continue;
    for (const match of source.matchAll(/(?<![\w-])z-index\s*:\s*(-?\d+|\[[^\]]*\])/g)) offenders.push(`${file}: ${match[0]}`);
  }
  assert.deepEqual(offenders, [], `hand-typed z-index left: ${offenders.join(", ")}`);
});

test("the layer scale keeps base < sticky < menu < floating < popup < toast < tooltip", () => {
  const config = readFileSync(path.join(root, "tailwind.config.ts"), "utf8");
  const globals = readFileSync(path.join(root, "src/styles/globals.scss"), "utf8");
  const scss = LAYERS.map((layer) => {
    const match = globals.match(new RegExp(`--z-${layer}:\\s*(-?\\d+);`));
    assert.ok(match, `globals.scss has no --z-${layer}`);
    return Number(match[1]);
  });
  assert.deepEqual([...scss].sort((a, b) => a - b), scss, "globals.scss layer order changed");
  for (const layer of LAYERS) assert.match(config, new RegExp(`\\b${layer}:\\s*"var\\(--z-${layer}\\)"`), `tailwind.config.ts has no z-${layer}`);
});

test("the style guard still refuses a hand-typed z-index and accepts a layer token", async () => {
  const { lintStyles } = await implementation;
  for (const value of ["z-[9999]", "z-[51]", "md:z-[1]", "!z-[12000]"]) {
    assert.ok(lintStyles(`<div className="${value}" />`, "src/Probe.tsx").length > 0, value);
  }
  for (const layer of LAYERS) {
    assert.deepEqual(lintStyles(`<div className="z-${layer}" />`, "src/Probe.tsx"), [], layer);
  }
  assert.ok(lintStyles(".probe { z-index: 9999; }", "src/probe.scss").length > 0, "raw CSS z-index");
  assert.deepEqual(lintStyles(".probe { z-index: var(--z-toast); }", "src/probe.scss"), [], "token CSS z-index");
});
