const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const load = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const definitionModule = load(path.join(root, "src/lib/flags/definitions/htpr-7518-agent-sidebar-chats.ts"));

const definition = definitionModule.default ?? definitionModule;
let flagMode = null;
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { default: {
  featureFlag: { findUnique: async () => flagMode ? { mode: flagMode } : null },
  user: { findUnique: async ({ where }) => ({ email: where.id === 985 ? "valentin@hypertask.ai" : where.id === 6 ? "valentin.yeo@gmail.com" : "person@example.invalid" }) },
} } };
const flags = load(path.join(root, "src/lib/flags.ts"));

test("all four modes honor the owner, QA and ordinary user boundary", async () => {
  for (const [mode, expected] of [
    [null, [true, true, false]], ["OFF", [false, false, false]],
    ["OWNER_ONLY", [true, false, false]], ["OWNER_AND_QA", [true, true, false]], ["EVERYONE", [true, true, true]],
  ]) {
    flagMode = mode;
    assert.deepEqual(await Promise.all([6, 985, 7].map((id) => flags.isFeatureEnabled(definition.key, id, { ...require.cache[prismaPath].exports.default }))), expected, String(mode));
  }
  flagMode = null;
});

test("the feature has one client-safe definition and an access-risk Owner + QA default", () => {
  assert.equal(definition.key, "htpr-7518-agent-sidebar-chats");
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.deepEqual(definition.releaseRisk, { risk: "new", highRisk: "access", reason: "Exposes agent conversations in the sidebar and binds terminal sessions to their recipients" });
  const source = read("src/lib/flags/definitions/htpr-7518-agent-sidebar-chats.ts");
  assert.doesNotMatch(source, /prisma|process\.env|server-only/);
  const definitions = fs.readdirSync(path.join(root, "src/lib/flags/definitions")).filter((file) => file.includes("7518"));
  assert.equal(definitions.length, 1);
});

test("registry discovery includes the new flag without a shared registry edit", () => {
  const registry = load(path.join(root, "src/lib/flags/definitions.ts"));
  assert.equal(registry.FEATURE_FLAG_DEFINITIONS.filter((flag) => flag.key === definition.key).length, 1);
});

test("new On does not depend on enabling parked rooms, mobile layout or activity flags", () => {
  const access = read("src/lib/agents/chatAccess.ts");
  const surface = read("src/components/AI_CHAT/AI_Chat_Sidebar.tsx");
  assert.match(access, /isFeatureEnabled\(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG, userId\)/);
  assert.match(surface, /const sidebarEnabled = enabled && !!projectId && !!currentUser/);
  assert.doesNotMatch(surface, /HTPR_6557|HTPR_6476|HTPR_6407/);
  assert.match(read("src/app/agents/chat/useAgentChatNavigation.ts"), /Boolean\(embedded \|\|/);
});

test("Off keeps the legacy header and composer and mounts no agent projection", () => {
  const source = read("src/components/AI_CHAT/AI_Chat_Sidebar.tsx");
  assert.match(source, /sidebarChats=\{enabled && sidebarEnabled \?[^]*: undefined\}/);
  assert.match(source, /sidebarEnabled && !minimized && currentUser && embeddedAgents\.map/);
  assert.match(source, /<AI_Tiptap_Container sidebarAgent=\{agentSessionsEnabled && target\.kind === "native-agent" \? target\.agent\.displayName : undefined\} disabled=\{generalChatPending\} active=\{!sidebarEnabled \|\| target\.kind !== "external-agent"\} \/>/);
  assert.match(source, /if \(!enabled \|\| !projectId\) return/);
  assert.match(read("src/components/AI_CHAT/ChatHeader.tsx"), /if \(sidebarChats\) \{ setIsDropdownOpen\(false\); setConversationsOpen/);
});

test("old direct links are gated and historical rooms retain their original route", () => {
  const page = read("src/app/agents/chat/page.tsx");
  assert.match(page, /query\.view !== "rooms" && sessionUser && !sessionUser\.agentId/);
  assert.match(page, /isFeatureEnabled\(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG, sessionUser\.userId\)/);
  assert.match(page, /target\.set\("sidebarAgent", agentId\)/);
  assert.match(page, /target\.set\("id", query\.projectId\)/);
  assert.match(page, /return <AgentRoomClient/);
  assert.match(page, /<AgentChatClient currentUser=\{currentUser\} roomsEnabled=\{roomsEnabled\}/);
  assert.match(read("src/components/commandDispatcher.ts"), /context\.agentSidebarChatsEnabled && _currentProject\?\.id/);
  const commands = read("src/components/commands.tsx");
  assert.match(commands, /useFlag\(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG\)/);
  assert.match(commands, /if \(agentSidebarChatsFlag\) agentSidebarChatsEnabled = true/);
  assert.match(commands, /createCommandDispatcher\(\{\s*agentSidebarChatsEnabled,/);
});

test("native selection retains the existing AI stream and carries explicit board context", () => {
  assert.match(read("src/components/AI_CHAT/AI_Chat_Sidebar.tsx"), /latest\.selectSession\(nativeSessionId\)/);
  const send = read("src/hooks/MultiPages/AIChat/aiChatSend.ts");
  assert.match(send, /const sidebarHeaders = sidebarChatHeaders\(session\.id\)/);
  assert.match(send, /headers: \{[^]*?\.\.\.sidebarHeaders,/);
  for (const file of ["src/app/api/ai/chat/stream/route.ts", "src/app/api/ai/chat/cancel/route.ts", "src/app/api/ai-chat/add-message/route.ts", "src/app/api/ai-chat/all-sessions/route.ts"]) {
    assert.match(read(file), /loadSidebarChatRequest\(request,/);
  }
});

test("AI history and destructive AI actions cannot target a different hidden conversation", () => {
  const header = read("src/components/AI_CHAT/ChatHeader.tsx");
  assert.match(header, /const aiSessionActionsAvailable = !sidebarChats \|\| sidebarChats\.target\.kind === "ai"/);
  assert.match(header, /filter\(\(session\) => !filterAgentSessions \|\| !session\.agentId\)/);
  assert.match(header, /aiSessionActionsAvailable && <button[^]*<Trash2/);
  assert.match(read("src/components/AI_CHAT/AI_Chat_Sidebar.tsx"), /writeDraft\(currentUser\.id, selected\.agent\.draftKey \?\? selected\.agent\.id/);
});


test("the CI-recognized ticket gates use canonical key imports and cover native transcript context", () => {
  for (const file of [
    "src/app/agents/chat/page.tsx", "src/components/AI_CHAT/AI_Chat_Sidebar.tsx",
    "src/components/ProviderGlobal/GloablProviders.tsx",
    "src/components/commands.tsx", "src/hooks/MultiPages/AIChat/useAiChat.ts",
    "src/hooks/MultiPages/AIChat/usePagedChatHistory.ts",
  ]) {
    const source = read(file);
    assert.match(source, /import \{[^}]*HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG[^}]*\} from "@\/lib\/flags\/keys"/, file);
    assert.match(source, /(?:useFlag|isFeatureEnabled)\(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG/, file);
  }
  assert.doesNotMatch(read("src/components/AI_CHAT/AI_Chat_Layout.tsx"), /agentSidebar|setShowChat/, "the closed phone panel must not own deep-link opening");
  const history = read("src/hooks/MultiPages/AIChat/usePagedChatHistory.ts");
  assert.match(history, /const sidebarChat = agentSidebarChatsEnabled \? getNativeSidebarChat\(\) : null/);
  assert.match(history, /getSessionTranscript\(sessionId!, signal, sidebarChat\?\.sessionId === sessionId \? sidebarChat.projectId : undefined\)/);
});

test("activity stays standalone-only even when unrelated client flags are off", () => {
  const { useAgentChatState } = require("./task-route-loader.cjs").load("src/app/agents/chat/useAgentChatState.ts", {
    "@/hooks/General/useMobileVisualViewport": { useMobileVisualViewport: () => null },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/contexts/mobileContext": {},
    "@/lib/flags/keys": {},
    "@/lib/state": { useRecoilValue: () => false, useSetRecoilState: () => () => {} },
    "@/store": {},
    "next/navigation": { useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
    react: {
      useContext: () => false, useEffect: () => {},
      useRef: (current) => ({ current }),
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    },
  });
  const props = { currentUser: { id: 6 }, roomsEnabled: false };
  assert.equal(useAgentChatState(props).activityRowsEnabled, true);
  assert.equal(useAgentChatState({ ...props, embedded: { projectId: 15 } }).activityRowsEnabled, false);
});
