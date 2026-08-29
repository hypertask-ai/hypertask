const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const filename = path.join(
  __dirname,
  "..",
  "src/components/RTE/Extensions/Hypertask-Links/parseHypertaskPasteUrl.ts",
);
const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = new Module(filename);
loaded.filename = filename;
loaded._compile(javascript, filename);

const { createShareLookupUrl, parseHypertaskPasteUrl } = loaded.exports;

test("recognizes a standalone Hypertask detail URL", () => {
  assert.deepEqual(
    parseHypertaskPasteUrl(
      "https://app.hypertask.ai/detail/project-15/5245?inboxFlow=true#comment-1",
    ),
    {
      type: "detail",
      id: "15",
      projectId: "5245",
      fullUrl:
        "https://app.hypertask.ai/detail/project-15/5245?inboxFlow=true#comment-1",
    },
  );
});

test("recognizes a standalone share URL with surrounding whitespace", () => {
  assert.deepEqual(
    parseHypertaskPasteUrl(
      "  \nhttps://app.hypertask.ai/share?id=share-123&source=inbox\t",
    ),
    {
      type: "share",
      id: "share-123",
      fullUrl: "https://app.hypertask.ai/share?id=share-123&source=inbox",
    },
  );
});

test("leaves prose containing a Hypertask URL to the normal paste flow", () => {
  assert.equal(
    parseHypertaskPasteUrl(
      "Ticket: https://app.hypertask.ai/detail/project-15/5245",
    ),
    null,
  );
});

test("leaves multiline clipboard content to the normal paste flow", () => {
  assert.equal(
    parseHypertaskPasteUrl(
      "Live on production.\nhttps://app.hypertask.ai/detail/project-15/5012\nDone.",
    ),
    null,
  );
});

test("rejects a newline embedded inside an otherwise valid URL", () => {
  assert.equal(
    parseHypertaskPasteUrl(
      "https://app.hypertask.ai/\ndetail/project-15/5245",
    ),
    null,
  );
});

test("does not intercept lookalike hosts", () => {
  assert.equal(
    parseHypertaskPasteUrl(
      "https://app.hypertask.ai.example.com/detail/project-15/5245",
    ),
    null,
  );
});

test("encodes decoded share IDs before constructing the lookup query", () => {
  assert.equal(
    createShareLookupUrl("foo&admin=true"),
    "/api/share/createShareLink?shareId=foo%26admin%3Dtrue",
  );
});
