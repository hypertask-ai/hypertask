const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/prisma-error-diagnostics.test.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") } },
);
const { prismaErrorDiagnostics } = jiti(
  path.join(root, "src/lib/errors/prismaErrorDiagnostics.ts"),
);

test("Prisma diagnostics preserve the code and bounded metadata", () => {
  const diagnostics = prismaErrorDiagnostics({
    code: "P2024",
    clientVersion: "7.8.0",
    batchRequestIdx: 2,
    meta: { modelName: "Team", connection_limit: 10 },
  });

  assert.deepEqual(diagnostics, {
    prismaCode: "P2024",
    prismaClientVersion: "7.8.0",
    prismaBatchRequestIndex: 2,
    prismaMeta: '{"modelName":"Team","connection_limit":10}',
  });
});

test("non-Prisma errors do not add diagnostic fields", () => {
  assert.deepEqual(prismaErrorDiagnostics(new Error("boom")), {});
  assert.deepEqual(prismaErrorDiagnostics({ code: "ECONNRESET" }), {});
});

test("Prisma diagnostic metadata is capped at the intake limit", () => {
  const diagnostics = prismaErrorDiagnostics({
    code: "P2022",
    meta: { detail: "x".repeat(5000) },
  });

  assert.equal(diagnostics.prismaMeta.length, 4000);
});
