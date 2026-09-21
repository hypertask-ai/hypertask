const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routeUtilsPath = path.join(
  root,
  "src/app/api/mcp/pages/_lib/routeUtils.ts",
);
const routeUtilsSource = fs.readFileSync(routeUtilsPath, "utf8");
const javascript = ts.transpileModule(routeUtilsSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const routeUtilsModule = { exports: {} };
const mockRequire = (request) => {
  if (request === "@/lib/mcp/fieldError") {
    return {
      buildFieldError: (code, field, message) => ({
        success: false,
        error: message,
        code,
        field,
      }),
    };
  }
  if (request === "@/lib/mcp/tasks/services") {
    return { validateProjectAccess: async () => ({ error: null }) };
  }
  throw new Error(`Unexpected import: ${request}`);
};

new Function("module", "exports", "require", javascript)(
  routeUtilsModule,
  routeUtilsModule.exports,
  mockRequire,
);

const { resolvePageIdentifierAlias } = routeUtilsModule.exports;

function readRoute(name) {
  return fs.readFileSync(
    path.join(root, `src/app/api/mcp/pages/${name}/route.ts`),
    "utf8",
  );
}

test("a body route accepts page_id", () => {
  assert.deepEqual(resolvePageIdentifierAlias({ page_id: "cmsir-body" }), {
    identifier: { publicId: "cmsir-body" },
    field: "page_id",
  });
  assert.match(readRoute("archive"), /resolvePageIdentifierAlias\(body\)/);
});

test("a query route accepts page_id", () => {
  const query = new URLSearchParams({ page_id: "cmsir-query" });
  assert.deepEqual(resolvePageIdentifierAlias(query), {
    identifier: { publicId: "cmsir-query" },
    field: "page_id",
  });
  assert.match(
    readRoute("get"),
    /resolvePageIdentifierAlias\(searchParams\)/,
  );
});

test("id remains accepted by body and query routes", () => {
  assert.deepEqual(resolvePageIdentifierAlias({ id: 5143 }), {
    identifier: { id: 5143 },
    field: "id",
  });
  assert.deepEqual(
    resolvePageIdentifierAlias(new URLSearchParams({ id: "5143" })),
    {
      identifier: { id: 5143 },
      field: "id",
    },
  );
});

test("different id and page_id values are rejected", () => {
  assert.deepEqual(resolvePageIdentifierAlias({ id: 5143, page_id: 5144 }), {
    error: {
      success: false,
      error: "page_id and id must identify the same page when both are provided",
      code: "invalid_field",
      field: "page_id",
    },
  });
});

test("identical id and page_id values are accepted", () => {
  assert.deepEqual(
    resolvePageIdentifierAlias({ id: "5143", page_id: 5143 }),
    {
      identifier: { id: 5143 },
      field: "id",
    },
  );
});

test("a missing identifier names both accepted fields", () => {
  assert.deepEqual(resolvePageIdentifierAlias({}), {
    error: {
      success: false,
      error: "Provide page_id or id; both field names are accepted",
      code: "missing_field",
      field: "id",
    },
  });
});

test("an unparseable identifier keeps the existing invalid-field error", () => {
  assert.deepEqual(resolvePageIdentifierAlias({ page_id: null }), {
    error: {
      success: false,
      error: "id must be a page publicId or positive numeric ID",
      code: "invalid_field",
      field: "page_id",
    },
  });
});

test("all five page identifier routes use the shared alias resolver", () => {
  for (const name of ["archive", "restore", "update"]) {
    const source = readRoute(name);
    assert.match(source, /page_id\?: unknown/);
    assert.match(source, /resolvePageIdentifierAlias\(body\)/);
    assert.doesNotMatch(source, /parsePageIdentifier\(/);
  }

  for (const name of ["get", "versions"]) {
    const source = readRoute(name);
    assert.match(source, /resolvePageIdentifierAlias\(/);
    assert.doesNotMatch(source, /parsePageIdentifier\(/);
  }
});
