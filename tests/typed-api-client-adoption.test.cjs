const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const key = "htpr-6925-typed-api-client";

function harness(name, flag, options = {}) {
  const calls = [];
  const states = [];
  const callbacks = [];
  const memos = [];
  const effects = [];
  const mutations = [];
  let query;
  let cursor = 0;
  const data = options.data ?? (name === "SkillLibrary" ? { skills: [] } : { enabled: false, memories: [] });
  const respond = async (kind, ...args) => {
    calls.push([kind, ...args]);
    if (options.error) throw options.error;
    return { data };
  };
  const react = {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useCallback: (callback, dependencies) => { callbacks.push({ callback, dependencies }); return callback; },
    useMemo: (callback, dependencies) => { const value = callback(); memos.push({ value, dependencies }); return value; },
    useEffect: (callback, dependencies) => effects.push({ callback, dependencies }),
  };
  const mocks = {
    axios: { default: { isAxiosError: (error) => Boolean(error?.response), get: (...args) => respond("old", ...args), patch: (...args) => respond("patch", ...args), delete: (...args) => respond("delete", ...args) } },
    react,
    "@/hooks/useFlag": { useFlag: (requested) => { assert.equal(requested, key); return flag; } },
    "@/lib/flags/keys": { HTPR_6925_TYPED_API_CLIENT_FLAG: key },
    "@/lib/api/typedClient": { listSkills: (...args) => respond("typed-skills", ...args), getBoardMemory: (...args) => respond("typed-memory", ...args) },
    "@/lib/constants/APIRouteConstants": { boardMemoryRoute: "/api/ai/project/memory" },
    "@tanstack/react-query": {
      useQuery: (config) => { query = config; return options.queryResult ?? { data, isError: false, isLoading: false }; },
      useQueryClient: () => ({ setQueryData: () => undefined }),
      useMutation: (config) => { mutations.push(config); return { mutate: () => undefined, isPending: false }; },
    },
    "react-hot-toast": { default: { error: () => undefined } },
    "./useSettingsTeam": { useSettingsTeam: () => ({ project: options.noProject ? undefined : { id: 15, title: "Board" } }) },
  };
  const filename = path.join(root, "src/components/Modals/Settings", `${name}.tsx`);
  const source = fs.readFileSync(process.env.TYPED_ADOPTION_SOURCE_DIR ? path.join(process.env.TYPED_ADOPTION_SOURCE_DIR, `${name}.tsx`) : filename, "utf8");
  const compiled = ts.transpileModule(source, { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (Object.hasOwn(mocks, specifier)) return { __esModule: true, ...mocks[specifier] };
    if (specifier.startsWith("./Settings")) return { __esModule: true, default: specifier };
    if (specifier === "react/jsx-runtime") return require(specifier);
    throw new Error(`Unexpected UI dependency: ${specifier}`);
  }, loadedModule, loadedModule.exports);
  const render = (props = {}) => { cursor = 0; return loadedModule.exports.default(props); };
  return { render, calls, states, callbacks, memos, effects, mutations, get query() { return query; } };
}

function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return text(node.props?.children);
}

for (const flag of [false, undefined, true]) {
  test(`SkillLibrary flag ${flag} selects exactly one read and keeps scope filtering`, async () => {
    for (const scope of ["user", "project"]) {
      const personal = { id: 1, userId: 6, projectId: null, name: "Personal" };
      const board = { id: 2, userId: null, projectId: 15, name: "Board skill" };
      const other = { id: 3, userId: null, projectId: 16, name: "Other" };
      const h = harness("SkillLibrary", flag, { data: { skills: [personal, board, other] } });
      h.render({ scope, projectId: 15, teamId: "team-1" });
      assert.equal(h.effects.length, 1);
      await h.callbacks.at(-1).callback();
      assert.deepEqual(h.calls, flag ? [["typed-skills", { projectId: 15, teamId: "team-1" }]] : [["old", "/api/ai/skills", { params: { projectId: 15, teamId: "team-1" } }]]);
      assert.deepEqual(h.states[0], scope === "user" ? [personal] : [board]);
      assert.equal(h.states[1], false); assert.equal(h.states[2], null);
      if (flag) {
        assert.ok(h.memos.at(-1).dependencies.includes(true), "flag changes must refresh the selected read");
        assert.ok(h.callbacks.at(-1).dependencies.includes(h.memos.at(-1).value), "load callback must follow the selected read");
      }
    }
    const h = harness("SkillLibrary", flag);
    h.render({ scope: "user" }); await h.callbacks.at(-1).callback();
    assert.deepEqual(h.calls, flag ? [["typed-skills", {}]] : [["old", "/api/ai/skills", { params: {} }]]);
    assert.match(text(h.render({ scope: "user" })), /No skills yet/);
  });

  test(`BoardMemorySection flag ${flag} selects exactly one read, with unchanged query and mutations`, async () => {
    for (const data of [{ enabled: false, memories: [] }, { enabled: true, memories: [{ content: "Use member", createdAt: "2026-10-06", source: "legacy" }] }]) {
      const h = harness("BoardMemorySection", flag, { data });
      const tree = h.render();
      assert.deepEqual(h.query.queryKey, ["board-memory", 15]); assert.equal(h.query.enabled, true);
      assert.equal(await h.query.queryFn(), data);
      assert.deepEqual(h.calls, flag ? [["typed-memory", 15]] : [["old", "/api/ai/project/memory", { params: { projectId: 15 } }]]);
      assert.match(text(tree), data.memories.length ? /Use member/ : /No learned facts yet/);
      await h.mutations[0].mutationFn(true); await h.mutations[1].mutationFn("legacy");
      assert.deepEqual(h.calls.slice(1), [["patch", "/api/ai/project/memory", { enabled: true, projectId: 15 }], ["delete", "/api/ai/project/memory", { params: { projectId: 15, source: "legacy" } }]]);
    }
    const h = harness("BoardMemorySection", flag, { noProject: true });
    assert.equal(h.render(), null); assert.equal(h.query.enabled, false); assert.deepEqual(h.calls, []);
  });

  test(`both flag ${flag} paths preserve error/loading display`, async () => {
    const error = { response: { data: { error: "Read denied" } } };
    const skills = harness("SkillLibrary", flag, { error });
    assert.match(text(skills.render({ scope: "user" })), /Loading skills/);
    await skills.callbacks.at(-1).callback();
    assert.equal(skills.states[2], "Read denied"); assert.equal(skills.states[1], false);
    const memory = harness("BoardMemorySection", flag, { error, queryResult: { isError: true } });
    assert.match(text(memory.render()), /Board memory could not be loaded/);
    await assert.rejects(memory.query.queryFn(), (caught) => caught === error);
    const loading = harness("BoardMemorySection", flag, { queryResult: { isLoading: true } });
    assert.match(text(loading.render()), /Loading memory/);
  });
}
