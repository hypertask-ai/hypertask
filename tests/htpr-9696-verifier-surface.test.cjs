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
  const routes = changedSurfaces({ files: [WELCOME, "src/lib/flags/definitions/htpr-9031-chip-starters.ts"], pages: [], sources, readSource, boardPath: BOARD, taskPath: TASK }).map((item) => item.route);
  assert.deepEqual(routes, ["/chat", TASK]);
});

test("the real welcome screen reaches chat on a ticket through its importers", async () => {
  const { changedSurfaces } = await load();
  const routes = changedSurfaces({ files: [WELCOME], boardPath: BOARD, taskPath: TASK }).map((item) => item.route);
  assert.ok(routes.includes("/chat"), JSON.stringify(routes));
  assert.ok(routes.includes(TASK), JSON.stringify(routes));
});

test("a library change derives no screen, so it is never held to one", async () => {
  const { changedSurfaces, missedSurfaces } = await load();
  assert.deepEqual(changedSurfaces({ files: ["src/lib/tasks/saveLimit.ts"], sources, readSource, boardPath: BOARD, taskPath: TASK }), []);
  assert.deepEqual(missedSurfaces({ actions: [{ op: "goto", path: "/inbox" }] }, []), []);
});

test("the planner is given the changed screens and must open one", async () => {
  const { buildPrompt } = await load();
  const reach = [{ file: "src/app/chat/Chat.tsx", route: "/chat", via: [WELCOME, "src/app/chat/Chat.tsx"], pages: ["ai-chat"] }, { file: "src/app/detail/[...slug]/TaskDetailPanels.tsx", route: TASK }];
  const prompt = buildPrompt({ kind: "plan", title: "t", body: "b", diff: "d", boardPath: BOARD, taskPath: TASK, reach }, "<<<fence>>>");
  assert.match(prompt, /DATA: CHANGED SCREENS\n\/chat\n\/detail\/project-\{id\}\/1/);
  assert.match(prompt, /the plan must open at least one of them/);
  assert.match(prompt, /\(screen: \/chat\)/);
});

test("a plan that only visits /agents/chat is re-planned onto the ticket chat", async () => {
  const { planFromRequest } = await load();
  const prompts = [];
  const answers = [roomsOnly(), ticketChat()];
  const plan = await planFromRequest(request([WELCOME, "src/lib/flags/definitions/htpr-9031-chip-starters.ts"]), {
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
  assert.doesNotMatch(prompts[0], /Earlier try/);
  assert.match(prompts[1], /Earlier try: The last plan opened no screen this diff changes\./);
  assert.match(prompts[1], /\/detail\/project-\{id\}\/1/);
  assert.deepEqual(plan.journeys.map((item) => item.journey), ["change:primary"]);
  assert.deepEqual(plan.actions, ticketChat().actions);
  assert.equal(plan.unevaluated, "");
  assert.deepEqual(plan.surfaces, ["/chat", TASK]);
});

test("a re-plan that misses again is not sure, and says which screen it missed", async () => {
  const { planFromRequest, decide } = await load();
  let asked = 0;
  const plan = await planFromRequest(request([WELCOME]), {
    binding,
    pages: [],
    sources,
    readSource,
    ask() {
      asked += 1;
      return roomsOnly();
    },
  });
  assert.equal(asked, 2);
  assert.equal(plan.fail, "");
  assert.equal(plan.unevaluated, "plan missed changed surface: /chat, /detail/project-{id}/1");
  const verdict = decide({ model: { verdict: "PASS", notes: "" }, plan, evidence: null, binding });
  assert.equal(verdict.verdict, "UNEVALUATED");
  assert.match(verdict.notes, /plan missed changed surface/);
});

test("a plan that opens the changed screen straight away is asked once", async () => {
  const { planFromRequest } = await load();
  let asked = 0;
  const plan = await planFromRequest(request([WELCOME]), {
    binding,
    pages: [],
    sources,
    readSource,
    ask() {
      asked += 1;
      return ticketChat();
    },
  });
  assert.equal(asked, 1);
  assert.equal(plan.unevaluated, "");
});

test("a screen below a changed route still counts as the changed screen", async () => {
  const { missedSurfaces, sameScreen } = await load();
  assert.deepEqual(missedSurfaces({ actions: [{ op: "goto", path: "/project?id={id}" }] }, ["/project"]), []);
  assert.equal(sameScreen("/chat", "/chat/{id}"), true);
  assert.equal(sameScreen("/agents/chat", "/chat"), false);
  assert.deepEqual(missedSurfaces({ actions: [{ op: "goto", path: "/agents/chat?view=rooms" }] }, ["/chat/{id}"]), ["/chat/{id}"]);
});

test("an api-only plan is not held to a screen", async () => {
  const { planFromRequest } = await load();
  let asked = 0;
  const plan = await planFromRequest(request([WELCOME]), {
    binding,
    pages: [],
    sources,
    readSource,
    ask() {
      asked += 1;
      return { actions: [{ op: "api", method: "GET", path: "/api/mcp/tasks/{task}", body: {}, expectStatus: 200, expectText: "saved" }], expect: [], reason: "the seam is the api" };
    },
  });
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
  const shotsRoot = mkdtempSync(join(tmpdir(), "surface-"));
  const plan = { ...binding, surfaces: [TASK], actions: [], expect: [], authorFamily: "deepseek", verifierModel: "zai/glm-5.3-flash", journeys: [{ journey: "change:primary", actions: [{ op: "goto", path: TASK }], expect: [] }] };
  const action = { op: "goto", path: TASK };
  const run = async () => ({ steps: [{ action, ok: false, error: "document status 500" }], expects: [] });
  const changed = await runJourneys({ page: { evaluate: async () => "500 Something went wrong", url: () => "http://127.0.0.1:3000/detail/project-1/1" }, plan, base: "http://127.0.0.1:3000", shotsRoot, run, nextNavigations: () => [] });
  assert.deepEqual(changed.journeys[0].errorScreen, { route: "/detail/project-1/1", changed: true });
  const other = await runJourneys({ page: { evaluate: async () => "Something went wrong!", url: () => "http://127.0.0.1:3000/agents/chat?view=rooms" }, plan: { ...plan, journeys: [{ journey: "area:agent-rooms", actions: [{ op: "goto", path: "/agents/chat?view=rooms" }], expect: [] }] }, base: "http://127.0.0.1:3000", shotsRoot, run, nextNavigations: () => [] });
  assert.deepEqual(other.journeys[0].errorScreen, { route: "/agents/chat?view=rooms", changed: false });
});

test("the verdict says whether the error screen was the changed surface", async () => {
  const { decideHeadOnly } = require("../scripts/lib/pstack-compare.cjs");
  const head = (screen) => ({ journey: "change:primary", viewport: "desktop", plan: { actions: [{ op: "goto", path: TASK }], expect: [] }, head: { steps: [{ action: { op: "goto", path: TASK }, ok: false, error: "document status 500" }], expects: [], navigations: [{ url: "http://127.0.0.1:3000/detail/project-1/1", status: 500 }], offOrigin: [], errorScreen: screen } });
  const changed = decideHeadOnly({ journeys: [head({ route: TASK, changed: true })] });
  assert.equal(changed.verdict, "FAIL");
  assert.match(changed.notes, /failed at step 1, with an error screen on \/detail\/project-\{id\}\/1 this change touches/);
  const other = decideHeadOnly({ journeys: [head({ route: "/agents/chat?view=rooms", changed: false })] });
  assert.match(other.notes, /with an error screen on \/agents\/chat\?view=rooms this change does not touch/);
  const unknown = decideHeadOnly({ journeys: [head({ route: "/somewhere", changed: null })] });
  assert.match(unknown.notes, /with an error screen on \/somewhere$/);
  const plain = decideHeadOnly({ journeys: [head(null)] });
  assert.match(plain.notes, /failed at step 1$/);
});
