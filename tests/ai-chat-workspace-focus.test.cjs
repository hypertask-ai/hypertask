const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("Control+Q switches between docked AI chat and the active workspace", () => {
  const hook = read("src/hooks/MultiPages/AIChat/useAiChat.ts");
  const layout = read("src/components/AI_CHAT/AI_Chat_Layout.tsx");
  const sidebar = read("src/components/AI_CHAT/AI_Chat_Sidebar.tsx");
  const shortcuts = read("src/lib/constants/shortcuts.ts");

  assert.match(layout, /data-ai-workspace/);
  assert.match(layout, /tabIndex=\{-1\}/);
  assert.equal(
    layout.match(/data-ai-workspace/g)?.length,
    2,
    "both the mobile-detail and normal workspace wrappers should be marked"
  );
  assert.match(sidebar, /data-ai-chat-panel/);
  assert.match(hook, /lastWorkspaceFocusRef/);
  assert.match(hook, /chatPanel\?\.contains\(activeElement\)/);
  assert.match(hook, /previousWorkspaceTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(hook, /editor\?\.commands\.focus\("end"\)/);
  assert.match(
    hook,
    /function tiptapKeydown[\s\S]*?window\.innerWidth >= MOBILE_VIEWPORT_MAX_PX[\s\S]*?workspace\?\.focus\(\{ preventScroll: true \}\)[\s\S]*?e\.stopPropagation\(\);[\s\S]*?return;/,
    "the composer must stop the handled keydown before the global listener"
  );
  assert.equal(
    hook.match(
      /e\.keyCode === KeyCodes\.Q &&[\s\S]*?e\.ctrlKey &&[\s\S]*?!e\.metaKey &&[\s\S]*?!e\.altKey &&[\s\S]*?!e\.shiftKey/g
    )?.length,
    2,
    "both local and global Control+Q handlers should require exact modifiers"
  );
  assert.equal(
    hook.match(/!e\.repeat/g)?.length,
    2,
    "local and global Control+Q handlers should ignore key-repeat events"
  );
  assert.match(
    shortcuts,
    /Switch focus: AI chat \/ workspace[\s\S]*?"CTRL", "Q"/
  );
});

test("the global chat shortcut has one document listener", () => {
  const layout = read("src/components/AI_CHAT/AI_Chat_Layout.tsx");
  const context = read(
    "src/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context.tsx"
  );

  assert.doesNotMatch(layout, /addEventListener\("keydown", layoutKeydown\)/);
  assert.match(
    context,
    /addEventListener\("keydown", handleLayoutKeydownCapture, true\)/
  );
  assert.match(
    context,
    /handleLayoutKeydownCapture[\s\S]*?event\.key\.toLowerCase\(\) !== "q"[\s\S]*?layoutKeydownRef\.current\(event\)[\s\S]*?event\.stopPropagation\(\)/
  );
  assert.match(context, /addEventListener\("keydown", handleLayoutKeydown\)/);
});
