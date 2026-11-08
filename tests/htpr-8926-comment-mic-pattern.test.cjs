const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const flagKey = "htpr-8926-comment-mic-pattern";
const icon = () => React.createElement("svg");
const tooltips = [];
const cn = (...values) => values.filter(Boolean).join(" ");

function render({ enabled, mode = "create-comment", isRecording = false, inInbox = false }) {
  const micProps = [];
  const { DesktopAttachment } = load("src/components/Common/AttachmentsUpload/AttachmentControls.tsx", {
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/utils/undoActions/helperFuncs": { cn },
    "lucide-react": { Check: icon, Paperclip: icon, PencilSparkles: icon, Trash2: icon, Send: icon },
    "../Tooltip": { default: () => null },
    "../Common/Tooltip": { default: (props) => { tooltips.push(props); return null; } },
    "../Common/SendArrow": { SendArrow: icon },
    "@/components/Common/SendArrow": { SendArrow: icon },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/models/model": {},
    "@/lib/configs/general.config": { MOBILE_TARGET: "" },
    "@/components/RTE/Components/AudioButton": {
      AudioButton: (props) => {
        micProps.push(props);
        return React.createElement("div", { id: props.id, "data-mic": true });
      },
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(DesktopAttachment, {
      mode,
      editor: null,
      handleAttachmentClick: () => {},
      handleDiscardDrafts: () => {},
      sendOnClick: () => {},
      audioTiptapCallback: () => {},
      toggleRecording: () => {},
      presentInInbox: inInbox,
      isRecording,
    }),
  );
  return { doc: new JSDOM(html).window.document, micProps };
}

const sendButtons = (doc) => [...doc.querySelectorAll("button")].filter((button) => button.textContent.trim() === "Send");

test("flag off keeps today's comment controls", () => {
  const { doc, micProps } = render({ enabled: false });
  assert.equal(sendButtons(doc).length, 0);
  assert.match(doc.body.textContent, /Send/);
  assert.equal(micProps[0].primaryMic, undefined);
  assert.equal(micProps[0].compactListeningPill, undefined);
});

test("comment box gets the white mic and a plain text Send", () => {
  const { doc, micProps } = render({ enabled: true });
  assert.equal(micProps[0].primaryMic, true);
  assert.equal(micProps[0].compactListeningPill, true);
  assert.equal(micProps[0].hideDevicePicker, true);
  const [send] = sendButtons(doc);
  assert.ok(send, "Send renders as a button");
  assert.equal(send.disabled, false);
  assert.match(send.className, /disabled:text-icon-dark-gray/);
  assert.match(send.className, /text-white-black/);
  assert.doesNotMatch(send.className, /bg-/);
});

test("the plain Send moves next to the mic instead of staying on the left", () => {
  const { doc } = render({ enabled: true });
  const left = doc.querySelector(".attachment-button").firstElementChild;
  assert.equal(left.textContent.includes("Send"), false);
  const right = doc.querySelector(".ml-auto");
  assert.ok(right.querySelector("[data-mic]"));
  assert.ok(right.querySelector("button"));
  assert.match(right.className, /gap-2/);
});

test("Send stays off while dictating so the transcript lands first", () => {
  const { doc } = render({ enabled: true, isRecording: true });
  assert.equal(sendButtons(doc)[0].disabled, true);
});

test("editing a comment uses the same mic and Send", () => {
  const { doc, micProps } = render({ enabled: true, mode: "read-edit-comments" });
  assert.equal(micProps[0].primaryMic, true);
  assert.equal(sendButtons(doc).length, 1);
});

test("description editor gets the white mic and no Send", () => {
  const { doc, micProps } = render({ enabled: true, mode: "read-edit-description" });
  assert.equal(micProps[0].primaryMic, true);
  assert.equal(micProps[0].compactListeningPill, true);
  assert.equal(sendButtons(doc).length, 0);
});

test("comment Send tooltip shows the comment shortcut, not the AI chat Enter", () => {
  tooltips.length = 0;
  render({ enabled: true });
  const send = tooltips.find((tip) => tip.text === "Send");
  assert.ok(send, "comment Send tooltip is set");
  assert.deepEqual(send.keyCombination, ["CTRL", "Enter"]);
  tooltips.length = 0;
  render({ enabled: true, inInbox: true });
  assert.deepEqual(tooltips.find((tip) => tip.text === "Send").keyCombination, ["CTRL", "SHIFT", "Enter"]);
});

test("description editor shows ai, paperclip, white mic, then trash", () => {
  const { doc } = render({ enabled: true, mode: "read-edit-description" });
  const right = doc.querySelector(".ml-auto");
  const children = [...right.children];
  const micIndex = children.findIndex((child) => child.hasAttribute("data-mic"));
  assert.equal(micIndex, children.length - 2);
  assert.equal(right.querySelectorAll('[class*="order-"]').length, 0);
});
