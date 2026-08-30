const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getSequentialLetters } = jiti(
  path.join(root, "src/utils/helperFunctions/helperFunctions.ts"),
);

function loadUpdateUniqueIdentifier(prisma) {
  const source = fs.readFileSync(
    path.join(root, "src/utils/controllers/projects/create.ts"),
    "utf8",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const stubs = {
    "@prisma/client": { LogType: {}, Status: {} },
    "../logs/createLog": { __esModule: true, default: () => {} },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/helperFunctions/helperFunctions": { getSequentialLetters },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {
      buildDefaultTitle: () => "",
    },
    "@/utils/helperFunctions/Views/FilterHelperFunctions": {
      defaultFilterSettings: {},
    },
    "./boardQuota": {
      FREE_BOARD_LIMIT_MESSAGE: "",
      isBoardLimitReached: async () => false,
    },
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );
  return mod.exports.updateUniqueIdentifier;
}

test("identical board titles always produce the same human-readable prefix", () => {
  const prefixes = Array.from({ length: 20 }, () =>
    getSequentialLetters("qa-2026-08-30-exploratory"),
  );

  assert.deepEqual(new Set(prefixes), new Set(["QAEX"]));
});

test("non-letter separators do not affect the deterministic prefix", () => {
  assert.equal(getSequentialLetters("qa-2026-08-30-ui"), "QAUI");
});

test("the last title word distinguishes boards with the same opening", () => {
  assert.equal(getSequentialLetters("Project Roadmap"), "PRRO");
  assert.equal(getSequentialLetters("Project Analytics"), "PRAN");
});

test("identically titled boards receive predictable collision suffixes", async () => {
  const identifiers = new Map();
  const prisma = {
    project: {
      findFirst: async ({ where }) =>
        [...identifiers.values()].includes(where.uniqueIdentifier) ? { id: 1 } : null,
      update: async ({ where, data }) => {
        identifiers.set(where.id, data.uniqueIdentifier);
      },
    },
  };
  const updateUniqueIdentifier = loadUpdateUniqueIdentifier(prisma);

  for (let projectId = 101; projectId <= 112; projectId++) {
    await updateUniqueIdentifier(
      "team-1",
      "qa-2026-08-30-exploratory",
      projectId,
    );
  }

  assert.deepEqual([...identifiers.values()], [
    "QAEX",
    "QAEX1",
    "QAEX2",
    "QAEX3",
    "QAEX4",
    "QAEX5",
    "QAEX6",
    "QAEX7",
    "QAEX8",
    "QAEX9",
    "QAE10",
    "QAE11",
  ]);
});
