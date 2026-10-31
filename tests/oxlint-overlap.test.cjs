const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const oxlintConfig = JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8"));
const overlap = Object.assign({}, ...[oxlintConfig, ...(oxlintConfig.overrides ?? [])].map((block) => block.rules ?? {}));
const schema = JSON.parse(readFileSync(join(root, "node_modules/oxlint/configuration_schema.json"), "utf8"));
const implemented = new Set(Object.keys(schema.definitions.DummyRuleMap.properties));
const probePath = "tests/oxlint-overlap-probe.tsx";
const staysInEslint = /^(?:local|hypertask-ui|hypertask-style|hypertask-tests|tailwindcss|@next|react-hooks|@typescript-eslint)\//;

test("every rule handed to Oxlint exists and no Hypertask rule is handed over", () => {
  const ids = Object.keys(overlap);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.doesNotMatch(id, staysInEslint, `${id} belongs to ESLint`);
    assert.ok(implemented.has(id), `Oxlint does not implement ${id}`);
    assert.match(String(overlap[id]), /^(?:error|warn)$/, `${id} needs a severity`);
  }
});

test("ESLint turns off exactly the rules Oxlint owns", async () => {
  const { default: config } = await import("../eslint.config.mjs");
  const off = new Set(config.flatMap((block) => Object.entries(block.rules ?? {})
    .filter(([, value]) => value === "off" || value === 0)
    .map(([id]) => id)));
  for (const id of Object.keys(overlap)) assert.ok(off.has(id), `ESLint still runs ${id}`);
});

test("the probe file stays outside the TypeScript program", () => {
  const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
  assert.ok(tsconfig.include.includes("**/*.tsx"), "tsc globs tsx files");
  assert.ok(
    (tsconfig.exclude ?? []).includes(probePath),
    `${probePath} exists only while this suite runs, so tsc must not glob it`,
  );
});

test("Oxlint reports a handed-over rule in the repository", () => {
  const probe = join(root, probePath);
  writeFileSync(probe, 'export function Probe() {\n  return <div children="text" />;\n}\n');
  try {
    const result = spawnSync(join(root, "node_modules/.bin/oxlint"), [probePath], {
      cwd: root,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /no-children-prop/, output);
    console.log("oxlint probe: caught react/no-children-prop");
  } finally {
    rmSync(probe, { force: true });
  }
});
