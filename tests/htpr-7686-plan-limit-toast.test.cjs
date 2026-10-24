const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const compiled = ts.transpileModule(read("src/lib/planLimitsClient.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
const stubs = {
  axios: { __esModule: true, default: { isAxiosError: error => error?.isAxiosError === true } },
};
new Function("require", "module", "exports", compiled)(name => {
  assert.ok(Object.hasOwn(stubs, name), `Unexpected import: ${name}`);
  return stubs[name];
}, loaded, loaded.exports);
const { planLimitRefusalMessage } = loaded.exports;
const message = "This Free team has reached its limit of 250 tickets. Upgrade to add more.";
const refusal = (status = 402, code = "PLAN_LIMIT_REACHED", text = message) => ({
  isAxiosError: true,
  response: { status, data: { success: false, code, message: text, limit: "tickets", max: 250 } },
});

test("axios 402 PLAN_LIMIT_REACHED returns the exact server message", () => {
  assert.equal(planLimitRefusalMessage(refusal()), message);
});

test("other failures remain outside the new toast path", () => {
  for (const error of [
    refusal(500), refusal(402, "OTHER_ERROR"), refusal(402, null),
    refusal(402, "PLAN_LIMIT_REACHED", null), refusal(402, "PLAN_LIMIT_REACHED", 250),
    { response: refusal().response }, { isAxiosError: true },
    { isAxiosError: true, response: { status: 402 } },
    new Error("Network error"), null, undefined,
  ]) assert.equal(planLimitRefusalMessage(error), null);
});

test("composer toasts only flagged plan refusals and retains the draft", async () => {
  const source = ts.createSourceFile("modal.ts", read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts"), ts.ScriptTarget.Latest, true);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "CreateNewTask") {
      callback = node.initializer.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  for (const enabled of [false, true]) for (const error of [refusal(), refusal(500), refusal(402, "OTHER_ERROR")]) {
    const formValues = { title: "Keep my typed title", description: "Keep my description", currentProject: { id: 15 }, assignees: [] };
    const before = structuredClone(formValues);
    const toasts = [];
    const context = {
      showPlanLimitToast: enabled, formValues, currentUser: { id: 6 },
      parentTaskInfo: undefined, createTaskFromComment: undefined,
      createNewTaskGloballyAPIHandler: async () => ({ error: true, ErrorMessage: error }),
      planLimitRefusalMessage, toast: { error: text => toasts.push(text) },
    };
    const body = ts.transpileModule(`return (${callback});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const create = new Function(...Object.keys(context), body)(...Object.values(context));
    assert.equal(await create({ description: formValues.description, urlsToAdd: [], relationsToAdd: [] }), undefined);
    assert.deepEqual(formValues, before);
    assert.deepEqual(toasts, enabled && error.response.status === 402 && error.response.data.code === "PLAN_LIMIT_REACHED" ? [message] : []);
  }
});
