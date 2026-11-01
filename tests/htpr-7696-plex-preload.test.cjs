const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function fontOptions(file, exportName, loaderName) {
  let options;
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => {
    if (id === "next/font/google") return { [loaderName]: value => { options = value; return {}; } };
    return require(id);
  } }, { filename: file });
  assert.ok(exports[exportName], `${file} exports ${exportName}`);
  return options;
}

for (const [file, exportName, loaderName] of [
  ["src/lib/fonts/inter.ts", "inter", "Inter"],
  ["src/lib/fonts/newsreader.ts", "newsreader", "Newsreader"],
  ["src/lib/fonts/ibmPlexSans.ts", "ibmPlexSans", "IBM_Plex_Sans"],
]) {
  test(`${file} asks Next to preload its latin cuts`, () => {
    const options = fontOptions(file, exportName, loaderName);
    assert.equal(options.preload, true);
    assert.deepEqual(Array.from(options.subsets), ["latin"]);
    assert.equal(options.display, "swap");
  });
}
