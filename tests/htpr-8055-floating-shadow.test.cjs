const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

for (const enabled of [false, true]) {
  for (const mobile of [false, true]) {
    test(`floating chat uses shared elevation only on desktop: mobile ${mobile}, flag ${enabled}`, () => {
      const load = loader({
        "@/hooks/useFlag": { useFlag: key => key === "htpr-8055-floating-elevation" ? enabled : true },
        "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
        "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
          useAiChatContext: () => ({ showWelcomeScreen: true, minimized: false }),
        },
        "./MessageList": { MessageList: () => null },
        "./WelcomeScreen": { WelcomeScreen: () => React.createElement("p", null, "Welcome") },
        "./ChatHeader": { ChatHeader: () => React.createElement("header", null, "AI chat") },
        "./AI_Tiptap_Container": { AI_Tiptap_Container: () => React.createElement("textarea", { "aria-label": "Message" }) },
        "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
      });
      const { ChatWindow } = load("src/components/AI_CHAT/ChatWindow.tsx");
      const view = mount();
      try {
        view.render(React.createElement(ChatWindow));
        const panel = view.container.querySelector(".chatwindow");
        assert.ok(panel);
        assert.equal(panel.classList.contains("shadow-floating"), !mobile && enabled);
        assert.equal(panel.classList.contains("border-floating"), !mobile && enabled);
        assert.equal(panel.dataset.floatingElevation, mobile ? undefined : String(enabled));
        assert.equal(panel.hasAttribute("data-amoled-chat-border"), !mobile && !enabled);
        assert.equal(panel.style.boxShadow, "");
        assert.equal(panel.classList.contains("h-full"), mobile);
        assert.equal(panel.classList.contains("h-[70svh]"), !mobile);
        assert.equal(view.container.querySelector("header").textContent, "AI chat");
        assert.ok(view.container.querySelector('[aria-label="Message"]'));
      } finally {
        view.close();
      }
    });
  }
}
