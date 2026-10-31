const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = path.join(__dirname, "..", "src", "utils", "controllers", "reports", "statusUpdate.ts");
const source = fs.readFileSync(SOURCE, "utf8");
const CHARS_PER_TOKEN = 3;
const JSON_OVERHEAD_CHARACTERS = 160;

function fitLimits() {
  const headline = /const STATUS_HEADLINE_MAX_CHARACTERS = (\d+);/.exec(source);
  const bullet = /const STATUS_BULLET_MAX_CHARACTERS = (\d+);/.exec(source);
  const perSection = /const STATUS_BULLETS_PER_SECTION_MAX = (\d+);/.exec(source);
  assert.ok(headline && bullet && perSection, "the status update keeps its fitted size limits");
  return { headline: Number(headline[1]), bullet: Number(bullet[1]), perSection: Number(perSection[1]) };
}

function outputBudget() {
  const match = /maxOutputTokens: (\d+)/.exec(source);
  assert.ok(match, "the status update generation must set maxOutputTokens");
  return Number(match[1]);
}

test("statusSchema rejects no reply for being long", () => {
  const schema = source.slice(source.indexOf("const statusSchema"), source.indexOf("function fitStatusUpdate"));
  assert.ok(schema.length > 0, "statusSchema must stay where this check can read it");
  assert.ok(!/\.max\(/.test(schema), "a long status update must be fitted, not thrown away as AI_NoObjectGeneratedError");
});

test("the generation budget covers the largest reply the fitting keeps", () => {
  const { headline, bullet, perSection } = fitLimits();
  const worstCaseCharacters = headline + 3 * bullet * perSection;
  const estimatedTokens = Math.ceil((worstCaseCharacters + JSON_OVERHEAD_CHARACTERS) / CHARS_PER_TOKEN);
  const budget = outputBudget();
  assert.ok(
    budget > estimatedTokens,
    `maxOutputTokens ${budget} is under the estimated ${estimatedTokens} tokens for the ${worstCaseCharacters} characters the fitting keeps; a cut-off reply fails as AI_NoObjectGeneratedError`
  );
});

test("the fitted reply is rendered, described and returned", () => {
  assert.match(source, /const statusUpdate = fitStatusUpdate\(result\.output\)/);
  assert.match(source, /renderStatusHtml\(statusUpdate/);
  assert.match(source, /description: statusUpdate\.headline/);
  assert.match(source, /headline: statusUpdate\.headline/);
});

test("the estimated reply size is well above the cap that truncated a real production status update", () => {
  const { headline, bullet, perSection } = fitLimits();
  const estimatedTokens = Math.ceil((headline + 3 * bullet * perSection + JSON_OVERHEAD_CHARACTERS) / CHARS_PER_TOKEN);
  assert.ok(
    estimatedTokens > 900,
    "HTPR-8222: a 900 token cap cut a real reply at 892 output tokens and returned a 502"
  );
});
