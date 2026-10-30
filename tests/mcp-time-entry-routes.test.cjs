const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const update = read("src/app/api/mcp/time/update/route.ts");
const remove = read("src/app/api/mcp/time/delete/route.ts");
const lib = read("src/lib/mcp/operations/time/helpers.ts");

test("both routes exist and are POST, matching the other time endpoints", () => {
  for (const [name, src] of [["update", update], ["delete", remove]]) {
    assert.ok(
      /export async function POST\(/.test(src),
      `${name} must expose POST like every other /api/mcp/time route`,
    );
  }
});

test("both routes authenticate before touching anything", () => {
  for (const [name, src] of [["update", update], ["delete", remove]]) {
    assert.ok(
      /authenticateMcpTime\(request\)/.test(src),
      `${name} must go through the shared auth helper`,
    );
    const authAt = src.indexOf("authenticateMcpTime");
    const workAt = Math.max(src.indexOf("updateEntry("), src.indexOf("deleteEntry("));
    assert.ok(
      authAt !== -1 && authAt < workAt,
      `${name} must authenticate before doing the work`,
    );
  }
});

test("both routes preserve the authenticated agent scope", () => {
  assert.match(
    update,
    /updateEntry\([\s\S]*body\.note,\s*ctx\.agentId,\s*ctx\.teamScope\s*\)/
  );
  assert.match(
    remove,
    /deleteEntry\(ctx\.user\.id, entry\.entryId, ctx\.agentId, ctx\.teamScope\)/
  );
});

test("the shared auth helper still rate limits", () => {
  assert.ok(
    /checkMcpRateLimit\(request\)/.test(lib),
    "authenticateMcpTime must keep the rate limit check",
  );
  const body = lib.slice(lib.indexOf("export async function authenticateMcpTime"));
  const limitAt = body.indexOf("checkMcpRateLimit(request)");
  const authAt = body.indexOf("validateMcpAuth(request)");
  assert.ok(limitAt !== -1 && authAt !== -1, "both calls must be present");
  assert.ok(limitAt < authAt, "rate limit must run before authentication work");
});

test("missing or forbidden entries answer identically", () => {
  for (const [name, src] of [["update", update], ["delete", remove]]) {
    assert.ok(
      /Time entry not found or access denied/.test(src),
      `${name} must use one message for both cases`,
    );
    assert.ok(
      /status: 404/.test(src),
      `${name} must answer 404 rather than distinguishing 403`,
    );
  }
});

test("update validates minutes against the same bounds as the library", () => {
  assert.ok(
    /minutes\s*>\s*1440/.test(update),
    "update must reject more than 1440 minutes",
  );
  assert.ok(
    /Number\.isInteger\(minutes\)/.test(update),
    "update must require an integer",
  );
  assert.ok(
    /error instanceof RangeError/.test(update),
    "a RangeError escaping the library must still answer 400, not 500",
  );
});

test("entry_id is validated as a positive integer", () => {
  assert.ok(
    /entry_id must be a positive integer/.test(lib),
    "readEntryId must reject non-positive and non-integer ids",
  );
  assert.ok(
    /Number\.isInteger\(entryId\)/.test(lib),
    "a float or NaN id must not reach Prisma",
  );
});
