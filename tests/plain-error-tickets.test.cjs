const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const helperUrl = new URL("../src/lib/errors/plainIncident.mjs", `file://${__filename}`);

const PRISMA = "Invalid `prisma.team.findUnique()` invocation: where id undefined";

test("maps paths to product page names", async () => {
  const { plainPageName } = await import(helperUrl);
  assert.equal(plainPageName("/onboarding"), "onboarding");
  assert.equal(plainPageName("https://app.hypertask.ai/detail/project-15/7094?x=1"), "a ticket page");
  assert.equal(plainPageName("/api/mcp/tasks/create"), "the agent and CLI API");
  assert.equal(plainPageName("/settings/billing"), "the settings page");
  assert.equal(plainPageName("/inbox"), "the inbox");
  assert.equal(plainPageName("/something-new"), "the app");
  assert.equal(plainPageName(undefined), "the app");
});

test("maps raw messages to plain words", async () => {
  const { plainProblem } = await import(helperUrl);
  assert.equal(plainProblem(PRISMA), "looking up a team failed");
  assert.equal(plainProblem("Invalid `prisma.task.create()` invocation"), "saving a task failed");
  assert.equal(plainProblem("request timed out"), "a request took too long");
  assert.equal(plainProblem("TypeError: fetch failed"), "the server could not reach another service");
  assert.equal(plainProblem("Unauthorized"), "a request was refused as not signed in");
  assert.equal(plainProblem("boom"), "an unexpected server error");
});

test("titles are short, plain and never start with a bracket prefix or bare Error", async () => {
  const { plainTitle, plainSummary } = await import(helperUrl);
  const title = plainTitle({ url: "/onboarding", message: PRISMA });
  assert.equal(title, "Server error on onboarding: looking up a team failed");
  assert.ok(title.length < 100);
  assert.doesNotMatch(title, /^\[|^Error$/);
  assert.equal(plainTitle({ kind: "spike", message: "x" }), "Server error spike: an unexpected server error");
  assert.ok(plainTitle({ url: "/x", message: "a".repeat(500) }).length <= 99);
  assert.match(
    plainSummary({ url: "/onboarding", message: PRISMA }),
    /^Something failed on the server while someone was using onboarding/,
  );
  const dash = String.fromCharCode(8212);
  assert.ok(!title.includes(dash) && !plainSummary({ message: PRISMA }).includes(dash));
});

test("reportError filer uses the plain title and keeps its fingerprint dedupe", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/errors/reportError.ts"), "utf8");
  assert.match(source, /plainTitle\(/);
  assert.doesNotMatch(source, /\[auto\]/);
  // Dedupe is by Redis fingerprint, never by ticket title.
  assert.match(source, /errors:dedupe:\$\{fingerprint\}/);
  assert.match(source, /<h3>Technical details<\/h3>/);
});

test("incident filer keeps its idempotency key and puts raw details last", () => {
  const source = fs.readFileSync(path.join(__dirname, "../.github/scripts/posthog-error-alert.mjs"), "utf8");
  assert.match(source, /posthog-incident-\$\{alert\.event_id\}/);
  assert.doesNotMatch(source, /\[incident\]/);
  assert.ok(source.indexOf("plainSummary(") < source.indexOf("Technical details"));
});
