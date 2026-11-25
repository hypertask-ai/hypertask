const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };

const BOARD = "/project?id={id}";
const TASK = "/detail/project-{id}/1";
const request = (files, extra = {}) => ({ ...binding, baseSha: "b".repeat(40), title: "HTPR-9031 [IMPROVE] Starter questions sit bottom left on a ticket chat too", body: "Author model: deepseek/deepseek-v4.1-flash", diff: "", files, filesTruncated: false, boardPath: BOARD, taskPath: TASK, ...extra });

const WELCOME = "src/components/AI_CHAT/WelcomeScreen.tsx";
const FILES = [WELCOME, "src/lib/flags/definitions/htpr-9031-chip-starters.ts"];
const sources = [
  WELCOME,
  "src/components/AI_CHAT/AI_Chat_Sidebar.tsx",
  "src/app/chat/Chat.tsx",
  "src/app/detail/[...slug]/TaskDetailPanels.tsx",
];
const readSource = (file) => ({
  "src/components/AI_CHAT/AI_Chat_Sidebar.tsx": 'import { WelcomeScreen } from "./WelcomeScreen";',
  "src/app/chat/Chat.tsx": 'import { WelcomeScreen } from "@/components/AI_CHAT/WelcomeScreen";',
  "src/app/detail/[...slug]/TaskDetailPanels.tsx": 'import { AI_Chat_Sidebar } from "@/components/AI_CHAT/AI_Chat_Sidebar";',
}[file] ?? "");

const roomsOnly = () => ({ actions: [{ op: "goto", path: "/agents/chat?view=rooms" }, { op: "shot", name: "rooms-open" }], expect: [{ path: "/agents/chat?view=rooms" }], reason: "the change only touches the chat page" });
const ticketChat = () => ({ actions: [{ op: "goto", path: TASK }, { op: "goto", path: "/chat" }, { op: "shot", name: "ticket-chat" }], expect: [{ text: "How can I help you?" }], reason: "chat on a ticket" });

test("run 45614020841's diff names the ticket chat screen, not only /chat", async () => {
  const { changedSurfaces } = await load();
  const routes = changedSurfaces({ files: FILES, pages: [], sources, readSource, boardPath: BOARD, taskPath: TASK }).map((item) => item.route);
  assert.deepEqual(routes, ["/chat", TASK]);
  assert.deepEqual(changedSurfaces({ files: ["src/lib/tasks/saveLimit.ts"], sources, readSource, boardPath: BOARD, taskPath: TASK }), []);
});

test("a derived route keeps the seed its dynamic segment needs, and names none it cannot seed", async () => {
  const { changedSurfaces } = await load();
  const routes = (file) => changedSurfaces({ files: [file], boardPath: BOARD, taskPath: TASK }).map((item) => item.route);
  assert.deepEqual(routes("src/app/agents/[agentId]/page.tsx"), ["/agents/{agent}"]);
  assert.deepEqual(routes("src/app/trash/[projectId]/page.tsx"), ["/trash/{id}"]);
  assert.deepEqual(routes("src/app/chat/[sessionId]/page.tsx"), []);
  assert.deepEqual(routes("src/app/settings/[[...section]]/page.tsx"), ["/settings"]);
});

test("a plan that only visits /agents/chat is re-planned onto the ticket chat", async () => {
  const { planFromRequest } = await load();
  const prompts = [];
  const answers = [roomsOnly(), ticketChat()];
  const plan = await planFromRequest(request(FILES), {
    binding,
    pages: [],
    sources,
    readSource,
    ask(prompt) {
      prompts.push(prompt);
      return answers[Math.min(prompts.length - 1, answers.length - 1)];
    },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /DATA: CHANGED SCREENS\n\/chat\n\/detail\/project-\{id\}\/1/);
  assert.match(prompts[0], /\(screen: \/chat\)/);
  assert.match(prompts[0], /the plan must open at least one of them/);
  assert.doesNotMatch(prompts[0], /Earlier try/);
  assert.match(prompts[1], /Earlier try: The last plan opened no screen this diff changes\./);
  assert.deepEqual(plan.actions, ticketChat().actions);
  assert.deepEqual(plan.surfaces, ["/chat", TASK]);
  assert.equal(plan.unevaluated, "");
});

test("a plan that opens the changed screen straight away is not re-planned", async () => {
  const { planFromRequest } = await load();
  let asked = 0;
  const plan = await planFromRequest(request([WELCOME]), { binding, pages: [], sources, readSource, ask() { asked += 1; return ticketChat(); } });
  assert.equal(asked, 1);
  assert.equal(plan.unevaluated, "");
});

test("a re-plan that misses again is not sure, and says which screen it missed", async () => {
  const { planFromRequest, decide } = await load();
  let asked = 0;
  const plan = await planFromRequest(request([WELCOME]), { binding, pages: [], sources, readSource, ask() { asked += 1; return roomsOnly(); } });
  assert.equal(asked, 2);
  assert.equal(plan.fail, "");
  assert.equal(plan.unevaluated, "plan missed changed surface: /chat, /detail/project-{id}/1");
  const verdict = decide({ model: { verdict: "PASS", notes: "" }, plan, evidence: null, binding });
  assert.equal(verdict.verdict, "UNEVALUATED");
  assert.match(verdict.notes, /plan missed changed surface/);
});

test("a screen below a changed route counts, an ancestor list page does not", async () => {
  const { missedSurfaces, sameScreen } = await load();
  assert.deepEqual(missedSurfaces({ actions: [{ op: "goto", path: "/project?id={id}" }] }, ["/project"]), []);
  assert.equal(sameScreen("/chat/{id}", "/chat"), true);
  assert.equal(sameScreen("/agents", "/agents/{agent}"), false);
  assert.equal(sameScreen("/agents/0b8f6f2e-1f3f-4a4e-9a1e-2c3d4e5f6a7b", "/agents/{agent}"), true);
  assert.deepEqual(missedSurfaces({ actions: [{ op: "goto", path: "/agents" }] }, ["/agents/{agent}"]), ["/agents/{agent}"]);
  assert.deepEqual(missedSurfaces({ actions: [{ op: "goto", path: "/agents/chat?view=rooms" }] }, ["/chat/{id}"]), ["/chat/{id}"]);
});

test("an api-only plan is not held to a screen", async () => {
  const { planFromRequest } = await load();
  let asked = 0;
  const plan = await planFromRequest(request([WELCOME]), { binding, pages: [], sources, readSource, ask() { asked += 1; return { actions: [{ op: "api", method: "GET", path: "/api/mcp/tasks/{task}", body: {}, expectStatus: 200, expectText: "saved" }], expect: [], reason: "the seam is the api" }; } });
  assert.equal(asked, 1);
  assert.equal(plan.unevaluated, "");
});

test("both author lines are read, and family/model maps to the family", async () => {
  const { authorGate, authorFamily } = await load();
  assert.equal(authorGate("Author-Model: deepseek (deepseek-v4.1-flash)").author, "deepseek");
  assert.equal(authorGate("Author model: deepseek/deepseek-v4.1-flash").author, "deepseek");
  assert.equal(authorGate("author model: claude/claude-opus-5").author, "claude");
  assert.equal(authorGate("author-model: codex/gpt-6.1-sol").author, "codex");
  assert.equal(authorGate("Author  model: grok").notes, "author model unknown");
  assert.equal(authorGate("Author model: mystery/whatever").notes, "author model unknown");
  assert.equal(authorGate("Author model: claude/claude-opus-5\n\nAuthor-Model: codex").notes, "author model unknown");
  const commit = { author: { login: "hypertask-runners[bot]" }, committer: { login: "hypertask-runners[bot]" }, commit: { message: "Fix the chat\n\nAuthor model: codex/gpt-6.1-sol" } };
  assert.equal(authorFamily("", [commit], "hypertask-runners[bot]"), "codex");
  assert.equal(authorFamily("Author model: deepseek/deepseek-v4.1-flash", [commit], "hypertask-runners[bot]"), "");
});

test("an error screen is reported against the screen the change touches", async () => {
  const { runJourneys } = await load();
  const { decideHeadOnly } = require("../scripts/lib/pstack-compare.cjs");
  const shotsRoot = mkdtempSync(join(tmpdir(), "surface-"));
  const plan = { ...binding, surfaces: [TASK], actions: [], expect: [], authorFamily: "deepseek", verifierModel: "zai/glm-5.3-flash", journeys: [{ journey: "change:primary", actions: [{ op: "goto", path: TASK }], expect: [] }] };
  const run = async () => ({ steps: [{ action: { op: "goto", path: TASK }, ok: false, error: "document status 500" }], expects: [] });
  const failed = await runJourneys({ page: { evaluate: async () => "500 Something went wrong", url: () => "http://127.0.0.1:3000/agents/0b8f6f2e-1f3f-4a4e-9a1e-2c3d4e5f6a7b" }, plan: { ...plan, surfaces: ["/agents/{agent}"] }, base: "http://127.0.0.1:3000", shotsRoot, run, nextNavigations: () => [] });
  assert.deepEqual(failed.journeys[0].errorScreen, { route: "/agents/0b8f6f2e-1f3f-4a4e-9a1e-2c3d4e5f6a7b", changed: true });
  const head = (screen) => ({ journey: "change:primary", viewport: "desktop", plan: { actions: [{ op: "goto", path: TASK }], expect: [] }, head: { steps: [{ action: { op: "goto", path: TASK }, ok: false, error: "document status 500" }], expects: [], navigations: [{ url: "http://127.0.0.1:3000/detail/project-1/1", status: 500 }], offOrigin: [], errorScreen: screen } });
  assert.match(decideHeadOnly({ journeys: [head({ route: TASK, changed: true })] }).notes, /failed at step 1, with an error screen on \/detail\/project-\{id\}\/1 this change touches/);
  assert.match(decideHeadOnly({ journeys: [head({ route: "/agents/chat?view=rooms", changed: false })] }).notes, /with an error screen on \/agents\/chat\?view=rooms this change does not touch/);
  assert.match(decideHeadOnly({ journeys: [head(null)] }).notes, /failed at step 1$/);
});
