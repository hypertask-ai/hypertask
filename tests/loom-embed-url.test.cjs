const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/components/RTE/Extensions/LoomTiptap/index.ts"),
  "utf8",
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

// The extension pulls in Tiptap at module scope purely to declare the node. The
// URL logic under test needs none of it, so stub the imports rather than drag
// the editor into a unit test.
const stubs = {
  "@tiptap/core": {
    Node: { create: (config) => config },
    mergeAttributes: (...args) => Object.assign({}, ...args),
    nodePasteRule: () => ({}),
  },
  "@tiptap/react": { ReactNodeViewRenderer: () => ({}) },
  "./LoomNodeView": { LoomNodeView: () => null },
  "@tiptap/pm/state": { Plugin: class {}, PluginKey: class {} },
};

const module_ = { exports: {} };
new Function(
  "module",
  "exports",
  "require",
  javascript,
)(module_, module_.exports, (id) => stubs[id] ?? {});

const { getEmbedUrlFromloomUrl } = module_.exports;

const ID = "0e04d1f3fdd44b0f9b1b1b1b1b1b1b1b";
const EMBED = `https://www.loom.com/embed/${ID}`;

test("a bare share link embeds", () => {
  assert.equal(
    getEmbedUrlFromloomUrl({ url: `https://www.loom.com/share/${ID}` }),
    EMBED,
  );
});

// What Loom's own Copy Link button produces. The id must not carry the query
// string into the embed URL.
test("the ?sid= link Loom copies embeds, without dragging sid along", () => {
  assert.equal(
    getEmbedUrlFromloomUrl({
      url: `https://www.loom.com/share/${ID}?sid=2b1c9a4e-7f3d-4c2a-9b8e-1a2b3c4d5e6f`,
    }),
    EMBED,
  );
});

// The regression this file exists for: extra params used to fail validation
// outright, so the link pasted as plain text and no video appeared (HTPR-3940).
test("extra query params still embed", () => {
  for (const url of [
    `https://www.loom.com/share/${ID}?sid=2b1c9a4e-7f3d-4c2a-9b8e-1a2b3c4d5e6f&t=12`,
    `https://www.loom.com/share/${ID}?source=embed`,
    `https://www.loom.com/share/${ID}#t=30`,
  ]) {
    assert.equal(getEmbedUrlFromloomUrl({ url }), EMBED, url);
  }
});

test("an embed url is passed through untouched", () => {
  assert.equal(getEmbedUrlFromloomUrl({ url: EMBED }), EMBED);
});

test("a non-Loom url is rejected rather than embedded", () => {
  assert.equal(
    getEmbedUrlFromloomUrl({ url: "https://example.com/share/" + ID }),
    null,
  );
});

test("a Loom url without a valid id is rejected", () => {
  assert.equal(
    getEmbedUrlFromloomUrl({ url: "https://www.loom.com/share/not-an-id" }),
    null,
  );
});
