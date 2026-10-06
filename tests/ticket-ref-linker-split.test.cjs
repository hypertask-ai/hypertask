const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/utils/controllers/comments/ticketRefLinker.ts"), "utf8");
const js = ts.transpileModule(source + "\nexport { splitHtmlTags };", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { splitHtmlTags } = mod.exports;

test("splitHtmlTags matches the old tag-splitting regex", () => {
  const alphabet = ["<", ">", "a", " ", "/", "H"];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let n = 0; n < 5000; n++) {
    let s = "";
    const len = next() % 14;
    for (let k = 0; k < len; k++) s += alphabet[next() % alphabet.length];
    assert.deepEqual(splitHtmlTags(s), s.split(/(<[^>]+>)/g), JSON.stringify(s));
  }
  for (const s of ["", "<p>HTPR-1 x</p>", "<<a>", "<>x<b>", "<a<b>", "a<", "<a href=\"x\">HTPR-2</a>"]) {
    assert.deepEqual(splitHtmlTags(s), s.split(/(<[^>]+>)/g), JSON.stringify(s));
  }
});

test("splitHtmlTags stays fast on a long run of '<'", () => {
  const started = Date.now();
  splitHtmlTags("<".repeat(200000));
  assert.ok(Date.now() - started < 500);
});
