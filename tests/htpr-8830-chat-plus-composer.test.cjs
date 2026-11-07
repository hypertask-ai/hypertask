const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-8830-chat-plus-composer";
const root = path.resolve(__dirname, "..");

test("HTPR-8830 chat plus composer is an Everyone improvement", () => {
  const { default: flag, HTPR_8830_CHAT_PLUS_COMPOSER_FLAG: key } = loadModule("src/lib/flags/definitions/htpr-8830-chat-plus-composer.ts");
  assert.equal(key, FLAG);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("the quiet placeholder halves the existing chat placeholder", () => {
  const scss = fs.readFileSync(path.join(root, "src/styles/tiptap.module.scss"), "utf8");
  assert.match(scss, /&\[data-chat-quiet-placeholder\] \.is_editor_empty:first-child::before \{\s*opacity: 0\.5;\s*\}/);
});

function composerView({ enabled, pathname = "/project", mobile = false } = {}) {
  const view = mount();
  const actions = [];
  const source = loader({
    "@/lib/flags/keys": {
      HTPR_7734_AGENT_CHAT_CONTEXT_FLAG: "htpr-7734-agent-chat-context",
      HTPR_7316_CHAT_SCOPE_TICKET_FLAG: "htpr-7316-chat-scope-ticket",
    },
    "next/navigation": { usePathname: () => pathname },
    "@/hooks/useFlag": { useFlag: (key) => key === FLAG && enabled },
    "@/lib/controlledComposerEditor": { ControlledComposerEditor: () => null },
    "./AiComposerTextarea": { AiComposerTextarea: () => null },
    "./ChatScopeChip": { ChatScopeChip: ({ label, onClick }) => React.createElement("button", { type: "button", "data-scope": true, onClick }, label) },
    "@/store": {},
    "@/lib/state": { useRecoilState: () => [[], () => {}], useRecoilValue: () => null },
    "@/hooks/MultiPages/AIChat/useDockedChatScope": { useDockedChatScope: () => [null, () => {}] },
    "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: () => ({ data: [] }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({
      editor: { isEmpty: true, commands: { focus: () => {} } },
      tiptapKeydown: () => {},
      isTyping: false,
      isRecording: false,
      queuedMessages: [],
      contextList: [],
      fileItems: [],
      displayAiOptions: [],
      currentAiOption: { effort: "high", modelKey: "gpt" },
      handleAddContext: () => actions.push("context"),
      handleAttachmentClick: () => actions.push("attach"),
      handleSendMessage: () => actions.push("send"),
      audioTiptapCallback: () => {},
      toggleRecording: () => {},
    }) },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { add_context_button: {}, cancel_stream_button: {} } } } },
    "@tiptap/react": { EditorContent: () => React.createElement("div", { className: "ProseMirror" }), useEditorState: () => true },
    "../Global/ModelSelectorDropdown": { default: ({ effortLabelClassName, aiSelected }) => React.createElement("button", {
      type: "button", "data-model-test": true, "data-effort-class": effortLabelClassName ?? "",
    }, "Model", effortLabelClassName === "hidden" ? null : React.createElement("span", null, aiSelected?.effort ?? "")) },
    "../Common/Tooltip": { default: () => null },
    "../RTE/Components/AudioButton": { default: (props) => React.createElement("button", {
      type: "button", "aria-label": props.ariaLabel, "data-compact": String(Boolean(props.compactListeningPill)), "data-hide-picker": String(Boolean(props.hideDevicePicker)),
    }, "mic") },
    "../Common/AttachmentsUpload/ImageGalleryView": { default: () => null },
    "./AttachmentButton": { AttachmentButton: ({ onClick }) => React.createElement("button", { type: "button", "aria-label": "Attach files", onClick }, "paperclip") },
    "./SendMessageButton": { SendMessageButton: ({ label, onClick, textButton }) => React.createElement("button", {
      type: "button", "aria-label": label || "Send message", "data-text-send": String(Boolean(textButton)), onClick,
    }, label || "icon") },
    "@/components/Common/QueuedMessagesStrip": { QueuedMessagesStrip: () => null },
    "@/components/Modals/OptionPicker": { default: () => null },
  });
  const { AI_Tiptap_Container } = source("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  view.render(React.createElement(AI_Tiptap_Container));
  return { ...view, actions };
}

test("sidebar and floating chat keep + , white mic and text Send in the box, with project and effort below", async () => {
  const view = composerView({ enabled: true });
  try {
    const composer = view.container.querySelector("[data-ai-chat-composer]");
    const plus = composer.querySelector("summary[aria-label='Add']");
    const mic = composer.querySelector("[aria-label='Start dictation']");
    const send = composer.querySelector("[aria-label='Send']");
    assert.ok(plus);
    assert.equal(mic.dataset.compact, "true");
    assert.equal(mic.dataset.hidePicker, "true");
    assert.equal(send.dataset.textSend, "true");
    const following = window.Node.DOCUMENT_POSITION_FOLLOWING;
    assert.ok(plus.compareDocumentPosition(mic) & following);
    assert.ok(mic.compareDocumentPosition(send) & following);
    const menu = composer.querySelector("[role='group'][aria-label='Add']");
    assert.match(menu.textContent, /Attach file/);
    assert.match(menu.textContent, /Ctrl\+U/);
    assert.match(menu.textContent, /Add context/);
    assert.match(menu.textContent, /@/);
    menu.closest("details").open = true;
    await React.act(async () => {
      menu.querySelector("[aria-label='Add context']").click();
    });
    assert.deepEqual(view.actions, ["context"]);
    menu.closest("details").open = true;
    await React.act(async () => {
      menu.querySelector("[aria-label='Attach file']").click();
    });
    assert.deepEqual(view.actions, ["context", "attach"]);
    assert.equal(composer.querySelector("[aria-label='Attach files']"), null);
    const below = view.container.querySelector("[data-ai-chat-below-row]");
    assert.ok(below);
    assert.equal(composer.contains(below), false);
    assert.ok(below.querySelector("[data-scope]"));
    const model = below.querySelector("[data-model-test]");
    assert.equal(model.dataset.effortClass, "");
    assert.match(model.textContent, /high/);
    assert.ok(view.container.querySelector("[data-chat-quiet-placeholder]"));
  } finally {
    view.close();
  }
});

test("Escape and an outside press close the + menu", async () => {
  const view = composerView({ enabled: true });
  try {
    const menu = view.container.querySelector("details");
    menu.open = true;
    await React.act(async () => {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    assert.equal(menu.open, false);
    menu.open = true;
    await React.act(async () => {
      document.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    });
    assert.equal(menu.open, false);
  } finally {
    view.close();
  }
});

for (const surface of [
  { name: "flag off", enabled: false, pathname: "/project", mobile: false },
  { name: "full-screen chat", enabled: true, pathname: "/chat", mobile: false },
  { name: "mobile", enabled: true, pathname: "/project", mobile: true },
]) {
  test(`${surface.name} keeps the previous composer row`, () => {
    const view = composerView(surface);
    try {
      assert.equal(view.container.querySelector("summary[aria-label='Add']"), null);
      assert.equal(view.container.querySelector("[data-ai-chat-below-row]"), null);
      assert.equal(view.container.querySelector("[data-chat-quiet-placeholder]"), null);
      if (!surface.mobile) assert.ok(view.container.querySelector("[aria-label='Attach files']"));
    } finally {
      view.close();
    }
  });
}
