const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-8251-description-ai-edit";

function harness(enabled) {
  const actions = [];
  return {
    actions,
    mocks: {
      "@/hooks/useFlag": {
        useFlag: key => key === flag ? enabled : key === "htpr-8173-description-inline-drafts",
        useFlagLoaded: () => true,
      },
      "@/lib/flags/keys": { HTPR_7337_EDIT_WITH_AI_FLAG: "htpr-7337-edit-with-ai" },
      "@/hooks/MultiPages/AIChat/useCommentToAiChat": {
        useCommentToAiChat: () => ({ editTicketWithAi: id => actions.push(["chat", id]) }),
      },
      "@/lib/contexts/TaskDetail/TaskProvider": {
        useTaskContext: () => ({
          currentTask: { id: 123 }, comments: [{}],
          setEditMode: value => actions.push(["mode", value]),
        }),
      },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "@/components/Common/Tooltip": { default: () => null },
      "./Tooltip": { default: () => null },
      "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    },
  };
}

test("the description AI entry is the shared ai control and opens description editing", () => {
  for (const enabled of [false, true]) {
    const h = harness(enabled);
    const view = mount();
    try {
      const { default: Button } = loader(h.mocks)("src/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton.tsx");
      view.render(React.createElement(Button));
      const ai = document.getElementById("description-ai-writer-button");
      const old = [...document.querySelectorAll("button")].find(node => /Edit with AI|AI Description/.test(node.textContent));
      if (enabled) {
        assert.ok(ai, "flag on shows the shared ai control");
        assert.equal(ai.textContent, "ai");
        assert.equal(old, undefined, "flag on hides the Edit with AI button");
        React.act(() => ai.click());
        assert.deepEqual(h.actions, [["mode", "description-ai"]]);
      } else {
        assert.equal(ai, null, "flag off keeps the old button");
        assert.ok(old, "flag off keeps the Edit with AI button");
        React.act(() => old.click());
        assert.deepEqual(h.actions, [["mode", "description-ai"]]);
      }
    } finally { view.close(); }
  }
});

test("descriptions resolve to the inline comment writer behind the flag, comments unchanged", () => {
  for (const enabled of [false, true]) for (const mode of ["read-edit-description", "create-comment", "read-edit-comments"]) {
    const h = harness(enabled);
    const { useTaskDetailEditorWriter } = loader({
      ...h.mocks,
      "@/utils/api/Task Detail": { updateTask: async () => ({ status: 200 }) },
      "@/lib/ai/autoDescriptionSuggestion": {},
    })("src/components/RTE/useTaskDetailEditorWriter.tsx");
    const api = useTaskDetailEditorWriter(() => ({ mode, currentTask: { id: 123 } }));
    const expected = mode === "read-edit-description" && !enabled ? "AiTaskWriter" : "WriteWithAI";
    assert.equal(api.getDefaultMode(), expected, `${mode} with flag ${enabled ? "on" : "off"}`);
  }
});

test("the ticket flag is a bugfix live for everyone", () => {
  const definition = loader()(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
