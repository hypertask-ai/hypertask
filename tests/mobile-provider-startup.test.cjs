const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("request device flags seed the client providers before hydration", () => {
  const layout = read("src/app/layout.tsx");
  const providers = read("src/utils/Providers.tsx");
  const device = read("src/lib/contexts/deviceContext.tsx");
  const mobile = read("src/lib/contexts/mobileContext.tsx");

  assert.match(layout, /const device = await isMobileDevice\(\)/);
  assert.match(layout, /initialIsMobile=\{device\.isMobile\}/);
  assert.match(layout, /initialIsApple=\{device\.isApple\}/);
  assert.match(providers, /<DeviceProvider initialIsApple=\{initialIsApple\}>/);
  assert.match(
    providers,
    /<MobileViewProvider initialIsMobile=\{initialIsMobile\}>/,
  );

  assert.doesNotMatch(device, /isMobileDevice|useLayoutEffect/);
  assert.match(device, /value=\{initialIsApple\}/);
  assert.match(mobile, /useState\(initialIsMobile\)/);
  assert.match(
    mobile,
    /previous === isMobileViewport \? previous : isMobileViewport/,
    "matching mobile requests must not rerender the complete provider subtree",
  );
});

test("closed boards do not mount or preload the AI chat provider", () => {
  const globalProvider = read(
    "src/components/ProviderGlobal/GloablProviders.tsx",
  );
  const chatHook = read("src/hooks/MultiPages/AIChat/useAiChat.ts");
  const chatClient = read("src/app/chat/ChatClient.tsx");
  const fullScreenLoading = read(
    "src/components/AI_CHAT/FullScreenChatLoading.tsx",
  );
  const closedLayout = read(
    "src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx",
  );

  assert.doesNotMatch(
    globalProvider,
    /^import \{ ChatProvider \} from/m,
  );
  assert.match(
    globalProvider,
    /const ChatProvider = lazy\([\s\S]*AI_Agent_Chat_Context/,
  );
  assert.match(
    globalProvider,
    /const isTaskDetailPage = pathname\?\.startsWith\("\/detail"\) \?\? false/,
  );
  assert.match(
    globalProvider,
    /const shouldMountChatRuntime\s*=\s*chatRuntimeMounted \|\|\s*isFullScreenChat \|\|\s*isTaskDetailPage \|\|\s*showAiChatInterface/,
    "task detail hooks require ChatProvider even while the chat panel is closed",
  );
  assert.match(
    globalProvider,
    /\{shouldMountChatRuntime \? \([\s\S]*<ChatProvider>[\s\S]*:\s*\([\s\S]*<AIChatClosedLayout/,
  );
  assert.match(globalProvider, /readChatOpenForSession\(\)/);
  assert.match(
    globalProvider,
    /NO_CHAT_RESTORE_ROUTES\.some\(\(route\) => pathname\.startsWith\(route\)\)/,
  );
  assert.ok(
    globalProvider.indexOf("NO_CHAT_RESTORE_ROUTES.some") <
      globalProvider.indexOf("hasAttemptedChatRestoreRef.current = true"),
    "auth routes must not consume the pending desktop restore",
  );
  assert.match(globalProvider, /openChatFromFocusShortcut/);
  assert.match(
    globalProvider,
    /isFullScreenChat \|\| isTaskDetailPage \? \(\s*<FullScreenChatLoading \/>/,
    "cold /chat and /detail navigation must not render provider consumers outside ChatProvider",
  );
  assert.match(chatClient, /loading: \(\) => <FullScreenChatLoading \/>/);
  assert.match(fullScreenLoading, /role="status"[\s\S]*Loading AI chat/);
  assert.match(chatHook, /from "@\/lib\/aiChat\/chatOpenSession"/);
  assert.doesNotMatch(
    chatHook,
    /const CHAT_OPEN_SESSION_KEY/,
    "the heavy chat hook must reuse the lightweight shell helper",
  );
  assert.match(closedLayout, /data-ai-workspace/);
  assert.match(closedLayout, /onClick=\{onOpenAIChat\}/);
});
