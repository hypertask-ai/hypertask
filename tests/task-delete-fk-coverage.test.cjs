const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("HTPR-6040: every restrictive taskId FK to Task is cleared before hard delete", () => {
  const schemaRaw = fs.readFileSync(
    path.join(__dirname, "..", "src/prisma/schema.prisma"),
    "utf8",
  );
  const schema = schemaRaw
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  const modelBlockPattern = /model\s+(\w+)\s*\{([^}]*)\}/g;
  const requiredModels = [];
  let match;
  while ((match = modelBlockPattern.exec(schema))) {
    const [, modelName, body] = match;
    if (modelName === "Task") continue;
    const relationMatch = body.match(
      /@relation\(fields:\s*\[taskId\],\s*references:\s*\[id\]([^)]*)\)/,
    );
    if (!relationMatch) continue;
    const isDatabaseManaged = /onDelete:\s*(Cascade|SetNull)/.test(relationMatch[1]);
    if (isDatabaseManaged) continue;
    const clientProperty = modelName[0].toLowerCase() + modelName.slice(1);
    requiredModels.push({ modelName, clientProperty });
  }

  assert.ok(
    requiredModels.length > 0,
    "expected at least one non-cascading taskId relation in the schema",
  );

  const source = fs.readFileSync(
    path.join(__dirname, "..", "src/utils/controllers/tasks/invokeTaskDelete.ts"),
    "utf8",
  );

  const missing = requiredModels.filter(
    ({ clientProperty }) =>
      !new RegExp(`prisma\\.${clientProperty}\\.deleteMany`).test(source),
  );

  assert.deepEqual(
    missing.map((m) => m.modelName),
    [],
    `invokeTaskDelete.ts must deleteMany() these before the task row, or the ` +
      `hard delete throws a foreign key violation forever: ${missing
        .map((m) => m.modelName)
        .join(", ")}`,
  );
});
