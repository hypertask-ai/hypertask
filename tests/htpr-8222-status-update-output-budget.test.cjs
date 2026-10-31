const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = path.join(__dirname, "..", "src", "utils", "controllers", "reports", "statusUpdate.ts");
const source = fs.readFileSync(SOURCE, "utf8");
const CHARS_PER_TOKEN = 3;

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

function outputBudget() {
  const match = /maxOutputTokens: (\d+)/.exec(source);
  assert.ok(match, "the status update generation must set maxOutputTokens");
  return Number(match[1]);
}

test("status update output budget covers the largest object its own schema accepts", () => {
  const { headlineMax, sections } = schemaLimits();
  const worstCaseCharacters = headlineMax + sections.reduce((total, section) => total + section.itemMax * section.itemsMax, 0);
  const requiredTokens = Math.ceil(worstCaseCharacters / CHARS_PER_TOKEN);
  const budget = outputBudget();
  assert.ok(
    budget >= requiredTokens,
    `maxOutputTokens ${budget} cannot hold the ${worstCaseCharacters} characters statusSchema allows (${requiredTokens} tokens); a cut-off reply fails as AI_NoObjectGeneratedError`
  );
});

test("the cap that truncated a real production status update is below the schema allowance", () => {
  const { headlineMax, sections } = schemaLimits();
  const worstCaseCharacters = headlineMax + sections.reduce((total, section) => total + section.itemMax * section.itemsMax, 0);
  assert.ok(
    Math.ceil(worstCaseCharacters / CHARS_PER_TOKEN) > 900,
    "HTPR-8222: a 900 token cap cut a real reply at 892 output tokens and returned a 502"
  );
});
