const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

function load(relative) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(require, exports);
  return exports;
}

const { rememberLoadedModule } = load("src/lib/boardStartup/loadedModule.ts");
const section = read("src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx");

test("the card module is unknown until its import resolves, then the same module is returned", async () => {
  const cardModule = { default: function Task() {} };
  let resolveImport;
  const remembered = rememberLoadedModule(() => new Promise(resolve => { resolveImport = resolve; }));

  const pending = remembered.load();
  assert.equal(remembered.loaded(), null);
  resolveImport(cardModule);
  assert.equal(await pending, cardModule);
  assert.equal(remembered.loaded(), cardModule);
});

test("a failed card import leaves the module unknown and still rejects for the retry path", async () => {
  const remembered = rememberLoadedModule(() => Promise.reject(new Error("chunk failed")));

  await assert.rejects(remembered.load(), /chunk failed/);
  assert.equal(remembered.loaded(), null);
});

test("every card import, including the startup preload and the lazy card, goes through the remembered loader", () => {
  assert.match(section, /const taskModule = rememberLoadedModule\(\(\) => import\("\.\.\/KanbanTaskComponents\/task"\)\);/);
  assert.match(section, /const loadTask = taskModule\.load;/);
  assert.match(section, /const Task = dynamic\(loadTask, \{/);
  assert.match(section, /void loadTask\(\)\.catch\(\(\) => \{\}\);/);
});

test("a column draws real cards first only when the card code is loaded, the board is not server-drawn and hydration is over", () => {
  assert.match(section, /if \(useFlag\(HTPR_7644_BOARD_CARDS_FIRST_DRAW_FLAG\)\) firstDrawTask = taskModule\.loaded\(\);/);
  assert.match(section, /const \[loadedTask\] = useState\(\(\) => \(seeded \|\| !hydrated \? null : firstDrawTask\)\);/);
  assert.match(section, /const TaskRenderer = seeded \? SeededTask : loadedTask\?\.default \?\? Task;/);
  assert.match(section, /useState\(seeded \|\| loadedTask !== null\)/);
});

test("with the flag off or the card code still loading, the column keeps the placeholder first draw", () => {
  const flagged = section.indexOf("let firstDrawTask");
  assert.ok(flagged >= 0);
  assert.match(section.slice(flagged, flagged + 120), /= null;/);
  assert.doesNotMatch(section, /useState\(seeded\);/);
});
