const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const oneSendKey = "htpr-8962-one-send-clears-inbox";
const micKey = "htpr-8926-comment-mic-pattern";
const icon = () => React.createElement("svg");
const empty = () => null;
const cn = (...values) => values.filter(Boolean).join(" ");

function renderControls({ oneSend, mic = false, mode = "create-comment", inInbox = false, showDeleteComment = true, isRecording = false }) {
  const tooltips = [];
  const { DesktopAttachment } = load("src/components/Common/AttachmentsUpload/AttachmentControls.tsx", {
    "@/hooks/useFlag": { useFlag: key => (key === oneSendKey && oneSend) || (key === micKey && mic) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/utils/undoActions/helperFuncs": { cn },
    "lucide-react": { Check: icon, Paperclip: icon, PencilSparkles: icon, Trash2: props => React.createElement("svg", { id: props.id, "aria-label": props["aria-label"], className: props.className }), Send: icon },
    "../Tooltip": { default: props => { tooltips.push(props); return null; } },
    "../Common/Tooltip": { default: props => { tooltips.push(props); return null; } },
    "../Common/SendArrow": { SendArrow: icon },
    "@/components/Common/SendArrow": { SendArrow: icon },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/models/model": {},
    "@/lib/configs/general.config": { MOBILE_TARGET: "" },
    "@/components/RTE/Components/AudioButton": { AudioButton: props => React.createElement("div", { id: props.id, "data-mic": true }) },
  });
  const html = renderToStaticMarkup(
    React.createElement(DesktopAttachment, {
      mode,
      editor: null,
      handleAttachmentClick: () => {},
      handleDiscardDrafts: () => {},
      handleCallback: async () => true,
      sendOnClick: () => {},
      audioTiptapCallback: () => {},
      toggleRecording: () => {},
      presentInInbox: inInbox,
      showDeleteComment,
      isRecording,
    }),
  );
  return { doc: new JSDOM(html).window.document, tooltips };
}

const sendButtons = doc => [...doc.querySelectorAll("button")].filter(button => button.textContent.trim() === "Send");
const rightGroup = doc => [...doc.querySelector(".attachment-button").children].filter(child => child.tagName === "DIV").pop();

for (const mic of [false, true]) {
  test(`flag on, mic=${mic}: one Send on the right and nothing from the left Send + button`, () => {
    const { doc } = renderControls({ oneSend: true, mic, inInbox: true });
    assert.equal(sendButtons(doc).length, 1);
    const right = rightGroup(doc);
    assert.ok(right.contains(sendButtons(doc)[0]));
    assert.ok(right.querySelector("[data-mic]"));
    const left = doc.querySelector(".attachment-button").firstElementChild;
    assert.equal(left.textContent.includes("Send"), false);
    assert.equal(doc.querySelectorAll("button").length, 1);
  });

  test(`flag on, mic=${mic}: trash is the first control, icon only, and Send is the last`, () => {
    const { doc } = renderControls({ oneSend: true, mic });
    const row = doc.querySelector(".attachment-button");
    const first = row.firstElementChild;
    const trash = first.querySelector("#create-comment-discard-draft-button");
    assert.ok(trash);
    assert.equal(first.textContent.trim(), "");
    assert.equal(trash.getAttribute("aria-label"), "Discard draft");
    assert.match(trash.getAttribute("class"), /text-icon-dark-gray/);
    assert.equal(row.querySelectorAll("#create-comment-discard-draft-button").length, 1);
    const right = rightGroup(doc);
    assert.equal(right.querySelector("#create-comment-discard-draft-button"), null);
    assert.equal(right.lastElementChild.textContent.trim(), "Send");
  });
}

test("flag on: no trash without a draft, Send still on the right", () => {
  const { doc } = renderControls({ oneSend: true, showDeleteComment: false });
  assert.equal(doc.querySelectorAll("#create-comment-discard-draft-button").length, 0);
  assert.equal(sendButtons(doc).length, 1);
  assert.ok(rightGroup(doc).contains(sendButtons(doc)[0]));
});

test("flag on: while dictating the trash hides and Send is disabled", () => {
  const { doc } = renderControls({ oneSend: true, isRecording: true });
  assert.equal(doc.querySelectorAll("#create-comment-discard-draft-button").length, 0);
  assert.equal(sendButtons(doc)[0].disabled, true);
});

test("flag on: Send tooltip names the inbox clearing only when the task is in the inbox", () => {
  const inInbox = renderControls({ oneSend: true, inInbox: true });
  const inboxTip = inInbox.tooltips.find(tip => /^Send/.test(tip.text || ""));
  assert.equal(inboxTip.text, "Send and remove from inbox");
  assert.deepEqual(inboxTip.keyCombination, ["CTRL", "Enter"]);
  const plain = renderControls({ oneSend: true, inInbox: false });
  const plainTip = plain.tooltips.find(tip => /^Send/.test(tip.text || ""));
  assert.equal(plainTip.text, "Send");
  assert.deepEqual(plainTip.keyCombination, ["CTRL", "Enter"]);
});

test("flag off, in inbox: today's left Send + is still there", () => {
  const { doc } = renderControls({ oneSend: false, inInbox: true });
  const left = doc.querySelector(".attachment-button").firstElementChild;
  assert.ok(left.textContent.includes("Send"));
});

test("flag off: trash stays in the right group with no aria-label", () => {
  const { doc } = renderControls({ oneSend: false });
  const trash = doc.querySelector("#create-comment-discard-draft-button");
  assert.ok(trash);
  assert.equal(trash.getAttribute("aria-label"), null);
  assert.ok(rightGroup(doc).contains(trash));
});

test("flag on does not move editing controls", () => {
  const edit = renderControls({ oneSend: true, mode: "read-edit-comments" });
  assert.equal(edit.doc.querySelectorAll("#read-edit-comments-discard-draft-button").length, 0);
  const description = renderControls({ oneSend: true, mode: "read-edit-description" });
  const trash = description.doc.querySelector("#read-edit-description-discard-draft-button");
  assert.ok(trash);
  assert.ok(rightGroup(description.doc).contains(trash));
});

function mountContainer({ oneSend, mode }) {
  const calls = [];
  const captured = [];
  const Provider = () => ({
    mode,
    handleCallback: (...args) => { calls.push(["handleCallback", ...args]); },
    sendComment: (...args) => { calls.push(["sendComment", ...args]); },
    editor: null,
    newCommentAttachments: [],
    isEditModeActive: true,
    inbox: true,
  });
  const { default: TiptapMainContainer } = load("src/components/RTE/Components/TiptapMainContainer.tsx", {
    "@/lib/contexts/TaskDetail/TiptapProvider": { useTiptapGlobalContext: Provider },
    "@/hooks/useFlag": { useFlag: key => key === oneSendKey && oneSend },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/styles/tiptap.module.scss": { default: {} },
    "./CreatedInfoTiptap": { default: empty },
    "./TiptapEditor": { default: empty },
    "@/components/Common/AttachmentsUpload": { default: props => { captured.push(props); return null; } },
    "@/components/Common/FileDragAndDrop": { default: ({ children }) => children },
    "./InlineDraftAiFloat": { default: empty },
    "lucide-react": { X: empty },
  });
  renderToStaticMarkup(React.createElement(TiptapMainContainer));
  return { calls, props: captured[0] };
}

test("flag on: the desktop comment Send posts through sendComment", () => {
  const { calls, props } = mountContainer({ oneSend: true, mode: "create-comment" });
  props.sendOnClick();
  assert.deepEqual(calls, [["sendComment"]]);
});

test("flag off: the desktop comment Send keeps handleCallback", () => {
  const { calls, props } = mountContainer({ oneSend: false, mode: "create-comment" });
  props.sendOnClick();
  assert.deepEqual(calls, [["handleCallback"]]);
});

for (const mode of ["read-edit-comments", "read-edit-description"]) {
  test(`flag on: ${mode} keeps handleCallback`, () => {
    const { calls, props } = mountContainer({ oneSend: true, mode });
    props.sendOnClick();
    assert.deepEqual(calls, [["handleCallback"]]);
  });
}
