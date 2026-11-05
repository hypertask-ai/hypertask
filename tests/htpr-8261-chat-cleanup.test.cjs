const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("AI chat cleanup flag is a Everyone improvement", () => {
  const { default: flag, HTPR_8261_CHAT_CLEANUP_FLAG: key } = loadModule("src/lib/flags/definitions/htpr-8261-chat-cleanup.ts");
  assert.equal(key, "htpr-8261-chat-cleanup");
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("listening replaces the microphone with a Dictation pill", () => {
  const audio = read("src/components/RTE/Components/AudioButton.tsx");
  assert.match(audio, /compactListeningPill\?: boolean/);
  assert.match(audio, /recording && !compactListeningPill && "w-full"/);
  assert.match(audio, /\) : compactListeningPill \? \(/);
  assert.match(audio, /data-ai-chat-dictation-pill/);
  assert.doesNotMatch(audio, /data-ai-chat-dictation-pill[\s\S]{0,400}>Dictation<\/span>/);
  assert.match(audio, /data-level-dots/);
  assert.match(audio, /data-ai-chat-recording-submit=\{isAiChat \|\| undefined\}/);
  assert.match(audio, /data-ai-chat-recording-cancel=\{isAiChat \|\| undefined\}/);
});

test("the floating and sidebar chat Send is the word, not the paper plane", () => {
  const button = read("src/components/AI_CHAT/SendMessageButton.tsx");
  assert.match(button, /\} else if \(label\) \{/);
  assert.match(button, /label && \(!mobile \|\| textOnMobile\)/);
  assert.doesNotMatch(button, /HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG/);
  const composer = read("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  assert.match(composer, /label=\{fullScreenCleanup \|\| chatCleanupEnabled \? "Send" : undefined\}/);
});

test("the chat composer turns the pill on for desktop and mobile", () => {
  const composer = read("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  assert.match(composer, /const chatCleanupFlag = useFlag\(HTPR_8261_CHAT_CLEANUP_FLAG\)/);
  assert.match(composer, /compactListeningPill=\{chatCleanupEnabled\}/);
  assert.match(composer, /hideDevicePicker=\{hideMicrophonePicker\}/);
});

test("no sparkle is left in the chat surfaces", () => {
  const window = read("src/components/AI_CHAT/ChatWindow.tsx");
  assert.match(window, /\{!chatCleanupEnabled && \(\s*<Sparkles/);
  const welcome = read("src/components/AI_CHAT/WelcomeScreen.tsx");
  assert.match(welcome, /\{!chatCleanupEnabled && \(\s*<Sparkles/);
  assert.match(welcome, /chatCleanupEnabled\s*\? "flex w-full items-center gap-2 rounded-\[4px\] border-thin border-border-light-gray-thin/);
});

test("Send remains an arrow when cleanup is off on mobile", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { SendMessageButton } = loadModule("src/components/AI_CHAT/SendMessageButton.tsx", {
    "../Common/Tooltip": { default: () => null },
  });
  const render = (textOnMobile) => renderToStaticMarkup(React.createElement(SendMessageButton, {
    disabled: false, mobile: true, label: "Send", textOnMobile, onClick: () => {},
  }));
  assert.match(render(true), />Send<\/span>/);
  assert.doesNotMatch(render(false), />Send<\/span>/);
  assert.match(render(false), /<svg/);
});

test("cleanup puts the microphone immediately before Send", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { AiChatComposerActionRow } = loadModule("src/components/AI_CHAT/AiChatComposerActionRow.tsx", {
    "@/hooks/useFlag": { useFlag: () => false },
  });
  const controls = {
    leadingControls: null, mobileModelControl: null, attachmentControl: null,
    contextControl: React.createElement("i", null, "context"), screenshotControl: null,
    streamControl: React.createElement("i", null, "stop"),
    sendControl: React.createElement("i", null, "send"),
  };
  for (const mobile of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(AiChatComposerActionRow, {
      ...controls, mobile, chatCleanup: true, mobileDictating: false, hasText: true,
      recorder: React.createElement("div", { className: mobile ? "order-3 ml-auto" : undefined, "data-recorder-wrapper": true }, React.createElement("i", null, "mic")),
    }));
    const stop = html.indexOf(">stop<");
    const mic = html.indexOf(">mic<");
    const send = html.indexOf(">send<");
    assert.ok(stop !== -1 && mic !== -1 && send !== -1);
    assert.ok(stop < mic && mic < send);
    if (mobile) {
      assert.match(html, /data-ai-chat-stream-control[^>]*class="order-3 /);
      assert.match(html, /class="order-3 ml-auto" data-recorder-wrapper/);
      assert.match(html, /data-ai-chat-primary-send="true" class="order-4"/);
    } else {
      assert.match(html, /<div data-recorder-wrapper="true"><i>mic<\/i><\/div>/);
    }
  }
});

test("collapsed chat corners follow the cleanup flag", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const mobileContext = React.createContext(false);
  let cleanup = false;
  const { ChatWindow } = loadModule("src/components/AI_CHAT/ChatWindow.tsx", {
    "@/hooks/useFlag": { useFlag: (flag) => flag === "htpr-8261-chat-cleanup" && cleanup },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({}) },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ minimized: true }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
    "./MessageList": { MessageList: () => null },
    "./WelcomeScreen": { WelcomeScreen: () => null },
    "./ChatHeader": { ChatHeader: () => null },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
  });
  const render = () => renderToStaticMarkup(React.createElement(ChatWindow));
  assert.match(render(), /rounded-t-lg/);
  cleanup = true;
  const html = render();
  assert.match(html, /rounded-t-\[4px\]/);
  assert.doesNotMatch(html, /rounded-t-lg/);
});

test("floating chat frame corners remain four pixels in both cleanup states", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  let cleanup = false;
  let multi = true;
  const { ChatWindowFrame } = loadModule("src/components/AI_CHAT/ChatWindowFrame.tsx", {
    "@/hooks/useFlag": { useFlag: (flag) => flag === "htpr-8261-chat-cleanup" ? cleanup : flag === "htpr-8334-multi-chat-windows" && multi },
  });
  const render = () => renderToStaticMarkup(React.createElement(ChatWindowFrame, {
    state: { x: 0, y: 0, width: 400, height: 500, minimized: false },
    viewport: { width: 1000, height: 800 },
    onFocus: () => {}, onMove: () => {}, onResize: () => {},
  }, "chat"));
  for (const enabled of [false, true]) {
    cleanup = enabled;
    const html = render();
    assert.match(html, /role="dialog"[^>]*class="[^"]*rounded-\[4px\]/);
    assert.doesNotMatch(html, /rounded-\[5px\]/);
  }
  multi = false;
  assert.equal(render(), "");
  cleanup = false;
  assert.equal(render(), "");
});

test("chat microphone renders the compact listening controls", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const mobileContext = React.createContext(false);
  let listening = false;
  let stateIndex = 0;
  const reactStub = {
    ...React,
    default: React,
    useState: (initial) => React.useState(stateIndex++ === 0 ? listening : initial),
  };
  const { AudioButton } = loadModule("src/components/RTE/Components/AudioButton.tsx", {
    react: reactStub,
    "@/components/Common/Tooltip": { default: () => null },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/store": { currentProjectAtom: {} },
    "@/lib/state": { useRecoilValue: () => null },
  });
  const render = (mobile) => {
    stateIndex = 0;
    return renderToStaticMarkup(React.createElement(mobileContext.Provider, { value: mobile },
      React.createElement(AudioButton, {
        id: "ai-chat-audio-button", editor: null, callbackHandler: () => {},
        toggleRecording: () => {}, compactListeningPill: true, ariaLabel: "Start dictation",
      })));
  };
  for (const mobile of [false, true]) {
    listening = false;
    assert.match(render(mobile), /data-ai-chat-recorder="true"/);
    listening = true;
    const html = render(mobile);
    assert.doesNotMatch(html, /data-ai-chat-recorder="true"/);
    assert.match(html, /data-ai-chat-dictation-pill="true"[^>]*rounded-\[4px\]/);
    if (mobile) assert.match(html, /aria-label="Cancel dictation" class="[^"]*rounded-\[4px\]/);
    else assert.doesNotMatch(html, /aria-label="Cancel dictation"/);
    assert.match(html, /aria-label="Stop dictation" class="[^"]*rounded-\[4px\]/);
  }
});

test("chat header corners follow cleanup only outside full-screen chat", () => {
  const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
  const view = mount();
  const noop = () => {};
  let pathname = "/project";
  let cleanup = false;
  let mobile = false;
  const mobileContext = React.createContext(false);
  const source = loader({
    "next/navigation": { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: noop }) },
    "@/lib/flags/definitions/htpr-8261-chat-cleanup": { HTPR_8261_CHAT_CLEANUP_FLAG: "htpr-8261-chat-cleanup" },
    "@/hooks/useFlag": { useFlag: key => key === "htpr-8261-chat-cleanup" ? cleanup : key === "htpr-8048-agent-sessions" },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ sessions: [], currentSession: { id: "saved", title: "Chat" }, runningSessionIds: [] }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/state": { useRecoilState: () => React.useState(false) },
    "@/store": {},
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "../Common/Tooltip": { default: () => null },
    "@/lib/aiModelOptions": { getMobileAiChatModelLabel: () => "GPT" },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: () => ({}), minimize_button: () => ({}) } } } },
    "./AgentSidebarChatCommands": { AgentSidebarChatCommands: () => null },
  });
  const Header = source("src/components/AI_CHAT/ChatHeader.tsx").ChatHeader;
  try {
    for (mobile of [false, true]) for (pathname of ["/project", "/chat"]) for (cleanup of [false, true]) {
      view.render(React.createElement(mobileContext.Provider, { value: mobile },
        React.createElement(Header, { sidebarChats: { projectId: 15, target: { kind: "ai" }, agents: [], onSelect: noop } })));
      const active = cleanup && pathname === "/project";
      const title = view.container.querySelector('[aria-label="Switch conversation"]');
      assert.equal(title.classList.contains("rounded-[4px]"), active);
      if (!mobile) assert.equal(title.classList.contains("rounded"), !active);
      if (mobile) for (const label of ["Close AI chat", "Chat history", "Agent sessions", "New chat"]) {
        const button = view.container.querySelector(`[aria-label="${label}"]`);
        assert.ok(button, label);
        assert.ok(button.classList.contains("h-11"), label);
        assert.ok(button.classList.contains("w-11"), label);
        assert.equal(button.classList.contains("rounded-[4px]"), active, label);
        assert.equal(button.classList.contains("rounded-full"), !active, label);
      }
    }
  } finally { view.close(); }
});

test("a minimized floating chat docks flush on the bottom edge", () => {
  const layout = read("src/components/AI_CHAT/AI_Chat_Layout.tsx");
  assert.match(layout, /const dockMinimizedTab = chatCleanup && minimized && !showQuickTips;/);
  assert.match(layout, /dockMinimizedTab \? "bottom-0" : showQuickTips \? "bottom-10" : "bottom-5"/);
});
