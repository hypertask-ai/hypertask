const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { hydrateRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { loader } = require('./helpers/htpr-7260-ui.cjs');

const flag = 'htpr-8038-chat-opener-ready';
const noop = () => {};

for (const surface of ['frame', 'panels', 'phone']) {
  for (const mode of ['on', 'off', 'loading']) {
    test(`${surface} opener is unavailable before hydration with flag ${mode}`, async () => {
      let opened = 0;
      const load = loader({
        'next/navigation': { usePathname: () => '/project' },
        'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
        '@/hooks/useFlag': { useFlag: key => key === flag ? mode === 'on' : key === 'htpr-8030-chat-open-race', useFlagReady: () => mode !== 'loading' },
        '@/lib/flags/definitions/htpr-8038-chat-opener-ready': { HTPR_8038_CHAT_OPENER_READY_FLAG: flag },
        '@/lib/flags/keys': { HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG: 'overlay' },
        '@/lib/contexts/mobileContext': { MobileViewContext: React.createContext(false) },
        '@/utils/undoActions/helperFuncs': { cn: (...values) => values.filter(Boolean).join(' ') },
        '@/components/Common/Tooltip': { default: () => null },
        '@/lib/contexts/Multipages/AI_Agent/chatContext': { useOptionalAiChatContext: () => ({
          isSidebarMode: true, showAiChatInterface: false, showRenameChatModal: false, currentSession: undefined, togglePopover: noop,
        }) },
        '@/components/ProviderGlobal/useGlobalUIState': { useGlobalUIState: () => ({ openAIChatInterface: () => { opened++; }, toggleAIChatInterface: () => { opened++; }, showAiChatInterface: false, closeAIChatInterface: noop }) },
        '@/lib/state': { useRecoilState: () => [false, noop] },
        '@/store': { showQuickTipsAtom: 'tips' },
        '@/lib/firstScreen/SurfaceContext': { useFirstScreenSurface: () => null },
        '@/hooks/Inbox/useGetNotifications': { useGetNotificationCount: () => ({ data: { unseen: 0 } }) },
        '@/hooks/Homepage/useAppShellSurfaceShortcuts': { default: () => ({ navigateToBoard: noop }) },
      });
      const files = { frame: 'src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx', panels: 'src/components/AI_CHAT/AI_Chat_Layout.tsx', phone: 'src/components/Global/MobileTabBar.tsx' };
      const Component = load(files[surface]).default;
      const element = React.createElement(Component, { currentUserId: 985, onOpenAIChat: () => { opened++; } });
      const html = renderToString(element);
      const dom = new JSDOM(`<div id="root">${html}</div>`, { url: 'https://app.hypertask.ai/project?id=1' });
      const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } };
      const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
      for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { value, configurable: true, writable: true });
      let root;
      try {
        const container = document.getElementById('root');
        const button = surface === 'phone' ? [...container.querySelectorAll('button')].find(button => button.textContent === 'AI') : container.querySelector('[aria-label="Open AI chat"]');
        assert(button);
        assert.equal(button.disabled, mode !== 'off', 'server must not advertise a handlerless button as available');
        if (mode !== 'off') assert.equal(button.getAttribute('aria-busy'), 'true');
        button.click();
        assert.equal(opened, 0);
        await React.act(async () => { root = hydrateRoot(container, element); });
        assert.equal(button.isConnected, true, 'hydration keeps the same control');
        assert.equal(button.disabled, false, 'handler availability enables the existing control');
        React.act(() => button.click());
        assert.equal(opened, 1, 'first accepted click invokes Open exactly once');
      } finally {
        if (root) React.act(() => root.unmount());
        dom.window.close();
        for (const [key, descriptor] of previous) {
          if (descriptor) Object.defineProperty(global, key, descriptor);
          else delete global[key];
        }
      }
    });
  }
}


test('opener readiness ships as an Everyone bugfix with a rollback flag', () => {
  const definition = loader()('src/lib/flags/definitions/htpr-8038-chat-opener-ready.ts').default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, 'bugfix');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.releaseRisk.risk, 'small');
});
