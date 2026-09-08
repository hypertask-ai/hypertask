const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(
  readFileSync(path.join(root, "e2e/qa-coverage.json"), "utf8"),
);

const sourceText = (relativePath) =>
  readFileSync(path.join(root, relativePath), "utf8");

test("QA coverage catalog stays tied to the checks that run", () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.repository, "hypertask-ai/hypertask");
  assert.equal(catalog.branch, "production");

  const checkIds = new Set();
  for (const check of catalog.checks) {
    assert.match(check.id, /^[a-z0-9-]+$/);
    assert.ok(!checkIds.has(check.id), `duplicate check id: ${check.id}`);
    checkIds.add(check.id);
    assert.ok(check.label);
    assert.ok(["github-job", "snapshot", "per-ticket"].includes(check.kind));
    assert.ok(sourceText(check.source.file).includes(check.source.token));
    if (check.kind === "github-job") {
      assert.ok(check.workflowFile);
      assert.ok(check.event);
      assert.ok(check.job);
      assert.ok(Number.isInteger(check.freshHours));
    }
  }

  const functionIds = new Set();
  const catalogTokens = new Map();
  for (const item of catalog.functions) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(!functionIds.has(item.id), `duplicate function id: ${item.id}`);
    functionIds.add(item.id);
    assert.ok(item.label);
    assert.ok(item.detail);
    for (const checkId of item.checkIds) {
      assert.ok(checkIds.has(checkId), `${item.id} uses unknown check ${checkId}`);
    }
    assert.equal(item.checkIds.length === 0, item.sources.length === 0);
    for (const source of item.sources) {
      const text = sourceText(source.file);
      assert.ok(text.includes(source.token), `${item.id} lost ${source.file}: ${source.token}`);
      const tokens = catalogTokens.get(source.file) || new Set();
      tokens.add(source.token);
      catalogTokens.set(source.file, tokens);
    }
  }

  assert.ok(catalog.functions.some((item) => item.checkIds.length > 0));
  assert.ok(catalog.functions.some((item) => item.checkIds.length === 0));

  const coreSource = sourceText("src/lib/productionSmoke/coreActions.ts");
  const coreSteps = [...coreSource.matchAll(/steps\.push\("([^"]+)"\)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    [...new Set(coreSteps)].sort(),
    [...(catalogTokens.get("src/lib/productionSmoke/coreActions.ts") || [])].sort(),
  );

  const browserSource = sourceText("e2e/smoke/prod.spec.ts");
  const browserViews = [...browserSource.matchAll(/\{ name: '([^']+)'/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    [...new Set(browserViews)].sort(),
    [...(catalogTokens.get("e2e/smoke/prod.spec.ts") || [])].sort(),
  );

  const flowIndex = sourceText("e2e/midscene/flows/index.mjs");
  const imports = [...flowIndex.matchAll(/import \w+ from '\.\/([^']+)'/g)].map(
    (match) => match[1],
  );
  const flowIds = imports.map((file) => {
    const flowSource = sourceText(`e2e/midscene/flows/${file}`);
    return /\bid:\s*'([^']+)'/.exec(flowSource)?.[1];
  });
  const catalogFlowIds = catalog.functions
    .flatMap((item) => item.sources)
    .filter((source) => source.file.startsWith("e2e/midscene/flows/") && source.file !== "e2e/midscene/flows/index.mjs")
    .map((source) => source.token.replace("id: '", "").replace("'", ""));
  assert.deepEqual([...new Set(flowIds)].sort(), [...new Set(catalogFlowIds)].sort());
});
