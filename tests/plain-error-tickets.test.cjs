const assert = require("node:assert/strict");
const test = require("node:test");

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
  assert.equal(plainProblem("boom"), "an unexpected error");
});

test("titles are short, plain and never start with a bracket prefix or bare Error", async () => {
  const { plainTitle, plainSummary } = await import(helperUrl);
  const title = plainTitle({ url: "/onboarding", message: PRISMA });
  assert.equal(title, "Server error on onboarding: looking up a team failed");
  assert.ok(title.length < 100);
  assert.doesNotMatch(title, /^\[|^Error$/);
  assert.equal(plainTitle({ kind: "spike", message: "x" }), "Server error spike: an unexpected error");
  assert.ok(plainTitle({ url: "/x", message: "a".repeat(500) }).length <= 99);
  assert.match(
    plainSummary({ url: "/onboarding", message: PRISMA }),
    /^Something failed on the server while someone was using onboarding/,
  );
  const dash = String.fromCharCode(8212);
  assert.ok(!title.includes(dash) && !plainSummary({ message: PRISMA }).includes(dash));
});

test("browser errors say browser, not server", async () => {
  const { plainTitle, plainSummary } = await import(helperUrl);
  assert.equal(
    plainTitle({ url: "/inbox", source: "client", message: "boom" }),
    "Browser error on the inbox: an unexpected error",
  );
  assert.match(plainSummary({ source: "client", message: "boom" }), /^Something failed in the browser/);
  assert.match(plainSummary({ source: "server", message: "boom" }), /^Something failed on the server/);
});
