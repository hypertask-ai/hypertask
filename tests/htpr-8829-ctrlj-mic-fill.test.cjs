const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const { AudioButton } = loadModule("src/components/RTE/Components/AudioButton.tsx", {
  "@/components/Common/Tooltip": { default: () => null },
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "@/lib/state": { useRecoilValue: () => null },
  "@/store": { currentProjectAtom: {}, inViewObjectAtom: {} },
  "@/utils/undoActions/helperFuncs": { cn: (...args) => args.filter(Boolean).join(" ") },
  "@/hooks/useFlag": { useFlag: () => false },
});

const micClassName = (id, props) => {
  const html = renderToStaticMarkup(
    React.createElement(AudioButton, {
      id,
      editor: null,
      callbackHandler: () => {},
      toggleRecording: () => {},
      ariaLabel: "Start dictation",
      ...props,
    }),
  );
  const match = html.match(new RegExp(`id="${id}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*id="${id}"`));
  return match[1] ?? match[2];
};

test("HTPR-8829 Ctrl+J primary mic fills white-black, not the theme primary", () => {
  const className = micClassName("compose-task-audio-button", { compactListeningPill: true, primaryMic: true });
  assert.match(className, /(^| )bg-white-black( |$)/);
  assert.match(className, /(^| )text-white-black-inverted( |$)/);
  assert.doesNotMatch(className, /bg-shadcn-primary/);
});

test("HTPR-8829 the AI chat mic keeps the theme primary fill", () => {
  const className = micClassName("ai-chat-audio-button-1", { compactListeningPill: true });
  assert.match(className, /(^| )bg-shadcn-primary( |$)/);
  assert.doesNotMatch(className, /bg-white-black/);
});
