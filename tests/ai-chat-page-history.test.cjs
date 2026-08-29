// HTPR-5119: AI chat must expose the MCP page_history capability without
// calling the app's own authenticated endpoints. This repository has no
// database-backed node:test harness, so these assertions protect the direct
// controller wiring, access-check order, and read-only versions branch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(
  __dirname,
  "../src/app/api/ai/chat/stream/route.ts",
);

function toolBody(source, toolName) {
  const start = source.indexOf(`${toolName}: tool({`);
  assert.notEqual(start, -1, `${toolName} tool definition not found`);
  const nextToolStart = source.indexOf("\n    hypertask_", start + 1);
  return source.slice(start, nextToolStart === -1 ? undefined : nextToolStart);
}

test("hypertask_page_history is registered with the MCP actions and warnings", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_page_history");

  assert.match(
    source,
    /hypertask_page_history: "Managing page history\.\.\."/,
    "tool must have a user-visible status label",
  );
  assert.match(body, /sendStatus\("hypertask_page_history"\)/);
  assert.match(body, /action: z\.enum\(\["versions", "restore", "archive"\]\)/);
  assert.match(body, /Restore REPLACES the current page content/);
  assert.match(body, /Archive hides the page/);
  assert.match(body, /Always list versions first to get the required version_id/);
  assert.match(
    body,
    /id: z\.union\(\[[\s\S]*?z\.coerce\.number\(\)\.int\(\)\.positive\(\)[\s\S]*?z\.string\(\)\.trim\(\)\.min\(1\)\.max\(100\)/,
    "page history must accept numeric IDs and public IDs",
  );
  assert.match(
    body,
    /const identifier = parsePageIdentifier\(input\.id\)/,
    "page identifiers must use the same resolver as the MCP routes and CLI",
  );
  assert.doesNotMatch(source, /\bcreateApiClient\b|\bcreateMcpToken\b/);
  assert.doesNotMatch(
    source,
    /(?:@\/|src\/)lib\/mcp-server\/lib\/services\//,
  );
  assert.doesNotMatch(body, /\bfetch\s*\(|\/mcp\/pages\//);
  assert.doesNotMatch(body, /confirmed/);
});

test("hypertask_page_history is registered as a write tool", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const writeToolNamesStart = source.indexOf("const writeToolNames = new Set([");
  const writeToolNamesEnd = source.indexOf("]);", writeToolNamesStart);
  const writeToolNames = source.slice(writeToolNamesStart, writeToolNamesEnd);

  assert.match(
    writeToolNames,
    /"hypertask_page_history"/,
    "restore and archive mutate page state",
  );
});

test("page restore and archive enforce project access before mutation", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_page_history");
  const pageLookupAt = body.indexOf("const existingPage = await getPage(identifier)");
  const accessAt = body.indexOf("const access = await validateProjectAccess(");
  const restoreAt = body.indexOf("const page = await restorePageVersion({");
  const archiveAt = body.indexOf("await archivePage({");

  assert.notEqual(pageLookupAt, -1, "page lookup is missing");
  assert.notEqual(accessAt, -1, "project access check is missing");
  assert.notEqual(restoreAt, -1, "restore controller call is missing");
  assert.notEqual(archiveAt, -1, "archive controller call is missing");
  assert.ok(pageLookupAt < accessAt, "the page must resolve before its project is checked");
  assert.ok(accessAt < restoreAt, "access must be checked before restore");
  assert.ok(accessAt < archiveAt, "access must be checked before archive");
  assert.match(body, /existingPage\.projectId,[\s\S]*?user\.id/);
  assert.match(body, /restorePageVersion\(\{[\s\S]*?pageId: existingPage\.id/);
  assert.match(body, /archivePage\(\{[\s\S]*?id: existingPage\.id/);
});

test("listing page versions does not mutate page state", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_page_history");
  const listStart = body.indexOf('if (input.action === "versions")');
  const restoreStart = body.indexOf('if (input.action === "restore")');
  const listBranch = body.slice(listStart, restoreStart);

  assert.notEqual(listStart, -1, "versions branch is missing");
  assert.notEqual(restoreStart, -1, "restore branch is missing");
  assert.match(listBranch, /listPageVersions\(\{ pageId: existingPage\.id \}\)/);
  assert.doesNotMatch(
    listBranch,
    /restorePageVersion|archivePage|prisma\.[A-Za-z0-9_]+\.(?:create|update|delete|upsert)/,
    "versions must remain read-only",
  );
});
