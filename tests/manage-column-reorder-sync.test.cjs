const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const javascript = ts.transpileModule(
  read("src/utils/helperFunctions/Views/ColumnReorderHelper.ts"),
  {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const helperModule = { exports: {} };
new Function("module", "exports", "require", javascript)(
  helperModule,
  helperModule.exports,
  (request) => {
    if (request === "@/utils/generateRank") {
      return { __esModule: true, default: () => "A0150" };
    }
    return require(request);
  },
);
const { applyReorderedSectionsToProject } = helperModule.exports;

const section = (id, title, ranking) => ({
  id,
  section_title: title,
  ranking,
  items: [{ id: id * 10, title: `${title} task` }],
});

test("a Manage Columns reorder synchronizes every board section list", () => {
  const todo = section(1, "Todo", "A0100");
  const hidden = section(4, "Hidden", "A0150");
  const doing = section(2, "Doing", "A0200");
  const done = section(3, "Done", "A0300");
  const project = {
    id: 15,
    section: [todo, hidden, doing, done],
    sections: [todo, hidden, doing, done],
    filteredSections: [doing, done],
  };
  const reordered = [
    { ...done, ranking: "A0050" },
    todo,
    doing,
  ];

  const updated = applyReorderedSectionsToProject(project, reordered);

  assert.deepEqual(updated.section.map(({ id }) => id), [3, 4, 1, 2]);
  assert.deepEqual(updated.sections.map(({ id }) => id), [3, 4, 1, 2]);
  assert.deepEqual(updated.filteredSections.map(({ id }) => id), [3, 2]);
  assert.equal(updated.sections[0].ranking, "A0050");
  assert.equal(updated.sections[0].items, done.items);
  assert.equal(updated.section[1], hidden);
});

test("a minimal board payload patches its only section list without throwing", () => {
  const todo = section(1, "Todo", "A0100");
  const doing = section(2, "Doing", "A0200");
  const minimalProject = {
    id: 15,
    section: [todo, doing],
  };

  const updated = applyReorderedSectionsToProject(minimalProject, [
    { ...doing, ranking: "A0050" },
    todo,
  ]);

  assert.deepEqual(updated.section.map(({ id }) => id), [2, 1]);
  assert.equal("sections" in updated, false);
  assert.equal("filteredSections" in updated, false);
});

test("Manage Columns patches the open board caches after ranking persistence", () => {
  const source = read("src/components/Modals/commands/manageColumn.tsx");
  const persist = source.indexOf("await axios.post(`/api/section/update`");
  const synchronizationDefinition = source.indexOf(
    "const synchronizeBoardSectionOrder = async",
  );
  const synchronize = source.indexOf(
    "await synchronizeBoardSectionOrder(reorderedSections)",
    persist,
  );
  const cancelProjects = source.indexOf(
    'queryClient.cancelQueries({ queryKey: ["projectsAll"], exact: true })',
    synchronizationDefinition,
  );
  const cancelMinimal = source.indexOf(
    'queryClient.cancelQueries({ queryKey: ["projectsAllMinimal"] })',
    synchronizationDefinition,
  );

  assert.ok(persist >= 0);
  assert.ok(cancelProjects > synchronizationDefinition);
  assert.ok(cancelMinimal > synchronizationDefinition);
  assert.ok(synchronize > persist);
  assert.match(source, /setCurrentProject\(\(project\) =>/);
  assert.match(source, /setQueryData<IProjectsAll>\(\["projectsAll"\]/);
  assert.match(
    source,
    /setQueriesData<IProject\[]>\(\s*\{ queryKey: \["projectsAllMinimal"\] \}/,
  );
  assert.match(source, /await updateCache\(reorderedSections, true\)/);
});
