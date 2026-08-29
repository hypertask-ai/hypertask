const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("smart labels resolve and pass the task team's gateway key", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/ai/labelClassifier.ts"),
    "utf8",
  );

  assert.match(
    source,
    /getTeamGatewayApiKey\(\{ trustedTeamId: tags\.teamId \}\)/,
  );
  assert.match(source, /if \(!tags\?\.teamId\)[\s\S]*?return null;/);
  assert.match(source, /if \(!gatewayApiKey\)[\s\S]*?return null;/);
  assert.match(source, /resolveGatewayModel\(MODEL, gatewayApiKey\)/);
  assert.doesNotMatch(source, /resolveGatewayModel\(MODEL\)/);
  assert.doesNotMatch(
    source,
    /Smart label classification returned unparsable output/,
  );
  assert.match(source, /model returned unparsable label output/);
});
