const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("skill draft flag defaults to Everyone and has a rollback reason", () => {
  const { definitions } = require("./helpers/flag-files.cjs");
  const definition = definitions().find(flag => flag.key === "htpr-7768-chat-skill-drafts");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.match(definition.releaseRisk.reason, /Off restores direct chat skill writes/);
});

for (const enabled of [true, false]) {
  test(`chat completion ${enabled ? "refreshes" : "preserves"} the existing skill picker cache`, async (t) => {
    const skills = load("src/lib/skills/slashSkills.ts", { "lucide-react": { Sparkles: () => null } });
    const originalFetch = global.fetch;
    const originalLog = console.log;
    t.after(() => { global.fetch = originalFetch; console.log = originalLog; });
    console.log = () => {};
    let rows = [];
    global.fetch = async () => ({ ok: true, json: async () => ({ skills: rows }) });
    assert.deepEqual(await skills.fetchSlashSkills(15), []);
    rows = [{ slug: "new-skill", name: "New skill", enabled: true, projectId: 15 }];
    const { consumeAiChatStream } = load("src/hooks/MultiPages/AIChat/aiChatStream.ts", {
      "@/lib/skills/slashSkills": skills,
      "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
      "@/lib/realtime/shared": {},
      "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
      "./aiChatShared": { parseAiStreamErrorContent: value => value },
    });
    const replies = [];
    await consumeAiChatStream({
      skillDraftsEnabled: enabled,
      response: new Response('event: content\ndata: {"content":"Saved"}\n\nevent: done\ndata: {"status":"complete","assistant_persisted":true}\n\n'),
      session: { id: "session" }, assistantMessageId: "reply",
      setAgentStatus() {}, setIsTyping() {}, updateSessionTitle() {},
      queryClient: { refetchQueries: async () => {} },
      addMessageToSessionQuery: (_, reply) => replies.push(reply),
    });
    assert.equal(replies.at(-1).content, "Saved");
    assert.deepEqual((await skills.fetchSlashSkills(15)).map(skill => skill.slug), enabled ? ["new-skill"] : []);
  });
}

for (const enabled of [true, false]) {
  test(`server resolves the skill draft flag for the authenticated user and gates its prompt and tools (${enabled})`, async () => {
    const checks = [], calls = [], prompts = [];
    const key = "htpr-7768-chat-skill-drafts";
    const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", {
      "@/lib/prisma": {},
      "@/lib/flags": { isFeatureEnabled: async (flag, userId) => { checks.push([flag, userId]); return flag === key && enabled; } },
      "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "" },
      "@/app/api/ai/chat/stream/streamLease": {},
      "@/app/api/ai/_lib/heartbeatExecution": {},
      "@/app/api/ai/chat/stream/persistAssistantMessage": {},
      "@/utils/controllers/comments/linkifyTicketRefs": {},
      "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "chat prompt" },
      "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
      "@/lib/ai/chatStream/content": { createUserContent: () => "request" },
      "@/lib/ai/tools/metadata": {}, "@/lib/ai/chatStream/title": {},
      "@/lib/ai/tools": { buildTools: (...args) => { calls.push(args); return {}; } },
      "./modelReply": { generateModelReply: async (_, inputs) => { prompts.push(inputs.instructions); return null; } },
      "./chatNames": { nameChatFromFirstMessage: async () => null },
    });
    const providerAbort = new AbortController();
    await runModelTurn({ body: { user_context: { id: 999 } }, dbUser: { id: 985 }, selected: { model: "test-model" }, providerAbort, send() {} }, {}, {});
    assert.deepEqual(checks.filter(([flag]) => flag === key), [[key, 985]]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][12], enabled);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].includes("SAVE A WORKFLOW AS A SKILL"), enabled);
  });
}
