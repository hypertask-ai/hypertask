const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { load } = require("./task-route-loader.cjs");
const noop = () => {};
const FLAG = "htpr-7766-chat-shortcuts";

function composerView(controlled = false) {
  const view = mount();
  const previousFrame = global.requestAnimationFrame;
  global.requestAnimationFrame = (callback) => callback();
  const actions = [];
  const editor = { isEmpty: false, commands: { focus: () => actions.push("native-focus") } };
  const { createAiChatKeyboard } = load("src/hooks/MultiPages/AIChat/aiChatKeyboard.ts", {
    "@/lib/constants/keyboard-handler": { KeyCodes: { ENTER: 13 } },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { aiMentionList: "mentions" } },
    "@/lib/skills/slashSkills": { SLASH_MENU_DOM_ID: "slash" },
    "./aiChatShared": {},
  });
  const keyboard = createAiChatKeyboard({ sharedShortcutsEnabled: true, editor, handleSendMessage: () => actions.push("send") });
  const source = loader({
    "next/navigation": { usePathname: () => "/project" },
    "@/hooks/useFlag": { useFlag: (key) => [FLAG, "htpr-7734-agent-chat-context"].includes(key) },
    "@/store": {},
    "@/lib/state": { useRecoilState: () => [[], noop], useRecoilValue: () => null },
    "@/hooks/MultiPages/AIChat/useDockedChatScope": { useDockedChatScope: () => [null, noop] },
    "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: () => ({ data: [] }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({
      editor, tiptapKeydown: keyboard.tiptapKeydown, queuedMessages: [], contextList: [], fileItems: [], displayAiOptions: [],
    }) },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { add_context_button: {} } } } },
    "@tiptap/react": {
      EditorContent: () => React.createElement("div", { className: "ProseMirror", contentEditable: true, tabIndex: 0, suppressContentEditableWarning: true }, "Retained draft"),
      useEditorState: () => false,
    },
    "../Global/ModelSelectorDropdown": { default: () => React.createElement("button", { type: "button", "data-model-test": true }, "Pick model") },
    "../Common/Tooltip": { default: () => null },
    "../RTE/Components/AudioButton": { default: () => null },
    "../Common/AttachmentsUpload/ImageGalleryView": { default: () => null },
    "./AttachmentButton": { AttachmentButton: () => null },
    "./SendMessageButton": { SendMessageButton: () => null },
    "@/components/Common/QueuedMessagesStrip": { QueuedMessagesStrip: () => null },
    "@/components/Modals/OptionPicker": { default: ({ onSelect, onClose }) => React.createElement("div", { role: "dialog" },
      React.createElement("button", { type: "button", onClick: () => onSelect({ id: "all" }) }, "All boards"),
      React.createElement("button", { type: "button", onClick: onClose }, "Cancel")) },
  });
  const { AI_Tiptap_Container } = source("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  const inputRef = React.createRef();
  const props = controlled ? { controlledComposer: {
    showScope: true, inputRef, value: "Agent draft", onChange: noop, onKeyDown: noop,
    placeholder: "Message agent", ariaLabel: "Agent message", isRecording: false, isProcessing: false,
    onRecordingChange: noop, onProcessingChange: noop, onDictation: noop, onSend: noop,
  } } : {};
  view.render(React.createElement(AI_Tiptap_Container, props));
  return { ...view, actions, inputRef,
    close() {
      view.close();
      if (previousFrame) global.requestAnimationFrame = previousFrame;
      else delete global.requestAnimationFrame;
    },
  };
}

test("model-button Enter bubbles through the mounted composer without sending its draft", () => {
  const view = composerView();
  try {
    const model = view.container.querySelector("[data-model-test]");
    model.focus();
    const event = new window.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true });
    React.act(() => model.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false, "native button activation must remain available");
    assert.deepEqual(view.actions, []);
    assert.equal(view.container.querySelector(".ProseMirror").textContent, "Retained draft");
    const editor = view.container.querySelector(".ProseMirror");
    React.act(() => editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true })));
    assert.deepEqual(view.actions, ["send"]);
  } finally { view.close(); }
});

for (const action of ["All boards", "Cancel"]) test(`controlled scope ${action} restores its own composer, not hidden native chat`, () => {
  const view = composerView(true);
  try {
    React.act(() => view.container.querySelector("[data-ai-chat-scope] button").click());
    const option = [...view.container.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === action);
    option.focus();
    React.act(() => option.click());
    assert.equal(document.activeElement === view.inputRef.current, true);
    assert.deepEqual(view.actions, []);
    assert.equal(view.inputRef.current.value, "Agent draft");
  } finally { view.close(); }
});
