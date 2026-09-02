const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// HTPR-5954: the Prisma driver adapter must keep the client's connection to
// the Neon pooler open past node-postgres's 10s default, so a low-traffic
// instance doesn't re-pay a TLS/auth handshake on every request. Source
// pattern check -- constructing a real pg.Pool against production Neon isn't
// practical in a unit test.
test("HTPR-5954: prisma.ts configures a 5-minute idle timeout and keepAlive on the pg pool", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src/lib/prisma.ts"),
    "utf8",
  );
  const adapterConstruction = source.slice(
    source.indexOf("const adapter = new PrismaPg("),
    source.indexOf("const client = new PrismaClient"),
  );

  assert.match(
    adapterConstruction,
    /connectionString:\s*process\.env\.DATABASE_URL/,
    "must still connect using DATABASE_URL",
  );
  assert.match(
    adapterConstruction,
    /idleTimeoutMillis:\s*5\s*\*\s*60_000/,
    "idle timeout must be 5 minutes, not node-postgres's 10s default",
  );
  assert.match(
    adapterConstruction,
    /keepAlive:\s*true/,
    "keepAlive must be enabled",
  );
});
