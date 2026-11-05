const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { loadModule } = require("./helpers/loadModule.cjs");

test("saved instructions initialize the editor and saving refreshes reopening state", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/settings/board-ai" });
  const originals = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let project = { id: 7049, ai_custom_instructions: [] };
  let request;
  let rejectSave = false;
  const notices = [];
  const saved = { id: 43, projectId: 7049, customInstruction: "Previously saved instructions", attachments: [] };
  client.setQueryData(["board-ai-custom-instructions", 7049], saved);
  const state = { useRecoilState: () => [project, (update) => { project = update(project); }] };
  const stubs = {
    "@/lib/state": state,
    "@/store": { currentProjectAtom: {} },
    "@/hooks/General/useFileUploadingStates": { default: () => ({ uploadInProgress: false, uploadingFiles: [], setUploadingFiles() {} }) },
    "@/lib/constants/constants": { REACT_QUERY_KEYS: { CustomPrompt: (id) => [id], uploadStates: [] } },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { default: () => ({ getProjectIdxAndAllData: () => ({ allData: undefined, projectToUpdateIndex: -1 }), updateProject() {} }) },
    axios: { default: { post: async (url, body) => {
      request = { url, body };
      if (rejectSave) throw new Error("Save failed");
      return { status: 200, data: { ...saved, customInstruction: body.customInstruction } };
    } } },
    "react-hot-toast": { default: Object.assign(() => {}, { success: (text) => notices.push(text), error: (text) => notices.push(text) }) },
    "@/hooks/General/useAutosizeTextarea": { default() {} },
  };
  const context = loadModule("src/lib/contexts/Multipages/customAiInstructionContext.tsx", stubs);
  stubs["@/lib/contexts/Multipages/customAiInstructionContext"] = context;
  const Input = loadModule("src/components/Modals/AICustomPrompt/AICustomPromptInput.tsx", stubs).default;
  const ActionRow = loadModule("src/components/Modals/AICustomPrompt/ActionRow.tsx", stubs).default;
  let editor;
  function Editor() {
    editor = context.useCustomAiInstructions();
    return React.createElement(React.Fragment, null, React.createElement(Input), React.createElement(ActionRow));
  }
  const render = async (key) => React.act(async () => root.render(
    React.createElement(QueryClientProvider, { client }, React.createElement(context.CustomAiProvider, {
      key, projectId: 7049, initialInstruction: client.getQueryData(["board-ai-custom-instructions", 7049]).customInstruction, closeHandler() {},
    }, React.createElement(Editor)))
  ));
  const value = () => document.querySelector("textarea").value;
  const change = async (text) => React.act(async () => editor.handleChange({ target: { value: text } }));
  const save = async () => React.act(async () => document.querySelector("button").click());
  try {
    client.setQueryData(["board-ai-custom-instructions", 7049], { ...saved, customInstruction: "" });
    await render("initial");
    assert.equal(value(), "");
    client.setQueryData(["board-ai-custom-instructions", 7049], saved);
    await render("initial");
    assert.equal(value(), "Previously saved instructions");
    await change("Brain tag required\nSet exactly one brain label.");
    await render("initial");
    assert.equal(value(), "Brain tag required\nSet exactly one brain label.");
    await save();
    assert.deepEqual(request, { url: "/api/ai/project/customInstruction", body: { projectId: 7049, customInstruction: "Brain tag required\nSet exactly one brain label." } });
    assert.equal(project.ai_custom_instructions[0].customInstruction, "Brain tag required\nSet exactly one brain label.");
    await render("reopened");
    assert.equal(value(), "Brain tag required\nSet exactly one brain label.");
    rejectSave = true;
    await change("Unsaved draft");
    await save();
    assert.equal(value(), "Unsaved draft");
    assert.equal(notices.at(-1), "Unable to update custom instructions");
    await render("after-error");
    assert.equal(value(), "Brain tag required\nSet exactly one brain label.");
    rejectSave = false;
    await change("");
    await save();
    await render("cleared");
    assert.equal(value(), "");
    assert.equal(project.ai_custom_instructions[0].customInstruction, "");
  } finally {
    await React.act(async () => root.unmount());
    client.clear();
    Object.assign(global, originals);
    dom.window.close();
  }
});
