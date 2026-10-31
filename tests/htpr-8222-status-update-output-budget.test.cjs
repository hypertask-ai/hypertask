const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = path.join(__dirname, "..", "src", "utils", "controllers", "reports", "statusUpdate.ts");
const source = fs.readFileSync(SOURCE, "utf8");
const CHARS_PER_TOKEN = 3;
const JSON_OVERHEAD_CHARACTERS = 160;

function schemaLimits() {
  const headline = /headline: z\.string\(\)\.min\(1\)\.max\((\d+)\)/.exec(source);
  const shipped = /shipped: z\.array\(z\.string\(\)\.min\(1\)\.max\((\d+)\)\)\.max\((\d+)\)/.exec(source);
  const inFlight = /inFlight: z\.array\(z\.string\(\)\.min\(1\)\.max\((\d+)\)\)\.max\((\d+)\)/.exec(source);
  const risks = /risks: z\.array\(z\.string\(\)\.min\(1\)\.max\((\d+)\)\)\.max\((\d+)\)/.exec(source);
  assert.ok(headline && shipped && inFlight && risks, "statusSchema fields must keep their max limits");
  return {
    headlineMax: Number(headline[1]),
    sections: [shipped, inFlight, risks].map((match) => ({ itemMax: Number(match[1]), itemsMax: Number(match[2]) })),
  };
}

function estimatedTokensForLargestObject() {
  const { headlineMax, sections } = schemaLimits();
  const worstCaseCharacters = headlineMax + sections.reduce((total, section) => total + section.itemMax * section.itemsMax, 0);
  return { worstCaseCharacters, estimatedTokens: Math.ceil((worstCaseCharacters + JSON_OVERHEAD_CHARACTERS) / CHARS_PER_TOKEN) };
}

function outputBudget() {
  const match = /maxOutputTokens: (\d+)/.exec(source);
  assert.ok(match, "the status update generation must set maxOutputTokens");
  return Number(match[1]);
}

test("the estimated reply size of the largest object statusSchema accepts stays under the cap", () => {
  const { worstCaseCharacters, estimatedTokens } = estimatedTokensForLargestObject();
  const budget = outputBudget();
  assert.ok(
    budget > estimatedTokens,
    `maxOutputTokens ${budget} is under the estimated ${estimatedTokens} tokens for the ${worstCaseCharacters} characters statusSchema allows; a cut-off reply fails as AI_NoObjectGeneratedError`
  );
});

test("the estimated reply size is well above the cap that truncated a real production status update", () => {
  const { estimatedTokens } = estimatedTokensForLargestObject();
  assert.ok(
    estimatedTokens > 900,
    "HTPR-8222: a 900 token cap cut a real reply at 892 output tokens and returned a 502"
  );
});
