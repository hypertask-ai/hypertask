const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const chipKey = "htpr-9031-chip-starters";

function welcomeDocument({ flagOn, ticket = false }) {
  const { WelcomeScreen } = loadModule("src/components/AI_CHAT/WelcomeScreen.tsx", {
    "@/hooks/useFlag": { useFlag: (key) => key === chipKey && flagOn },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": {},
    "@/hooks/General/useHydrated": { useHydrated: () => ticket },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ isDetailPage: ticket, handleSendMessage: () => {} }) },
    "next/navigation": { usePathname: () => (ticket ? "/detail/project-15/43" : "/chat") },
    "@tanstack/react-query": { useQuery: () => ({ data: undefined }) },
    "@/lib/state": { useRecoilValue: (atom) => (atom === "task" ? { taskId: 43, taskTicketNumber: "QASA-43" } : atom === "ready" ? true : null) },
    "@/store": ticket ? { inViewObjectAtom: "task", taskDetailNonEssentialReadyAtom: "ready" } : {},
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "./GuestBoardSpotlight": { GuestBoardSpotlight: () => null },
    "@/utils/generateTime": { default: () => "now" },
    "./taskSummaryAction": { taskSummaryActionFor: () => null },
    "@/lib/flags/definitions/htpr-8261-chat-cleanup": { HTPR_8261_CHAT_CLEANUP_FLAG: "htpr-8261-chat-cleanup" },
    "@/lib/flags/definitions/htpr-8263-full-screen-chat-cleanup": { HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG: "htpr-8263-full-screen-chat-cleanup" },
    "@/lib/flags/definitions/htpr-9031-chip-starters": { HTPR_9031_CHIP_STARTERS_FLAG: chipKey },
  });
  return new JSDOM(renderToStaticMarkup(React.createElement(WelcomeScreen))).window.document;
}

function questionChips(document) {
  return [...document.querySelectorAll("button")].filter((chip) => /QASA-43/.test(chip.textContent));
}

const classes = (element) => element.className.split(/\s+/);

test("the flag is an improvement that starts at Owner + QA", () => {
  const { default: flag, HTPR_9031_CHIP_STARTERS_FLAG: exported } = loadModule("src/lib/flags/definitions/htpr-9031-chip-starters.ts");
  assert.equal(exported, chipKey);
  assert.equal(flag.key, chipKey);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "new");
});

test("flag on: starter questions sit bottom left, hug their text, use the 14px regular font and 4px corners", () => {
  const document = welcomeDocument({ flagOn: true });
  const chips = [...document.querySelectorAll("button")];
  assert.equal(chips.length, 4);
  const panel = document.body.firstElementChild;
  for (const name of ["items-start", "justify-end", "pb-2"]) assert.ok(classes(panel).includes(name), name);
  for (const name of ["items-center", "justify-center"]) assert.ok(!classes(panel).includes(name), name);
  for (const chip of chips) {
    for (const name of ["w-fit", "max-w-full", "text-content", "font-normal", "rounded-[4px]", "bg-kanban-active-cardbg", "hover:bg-hover-active"]) {
      assert.ok(classes(chip).includes(name), name);
    }
    for (const name of ["w-full", "text-meta", "rounded"]) assert.ok(!classes(chip).includes(name), name);
  }
});

test("still allowed: flag off keeps the centered full-width 12px questions", () => {
  const document = welcomeDocument({ flagOn: false });
  const panel = document.body.firstElementChild;
  for (const name of ["items-center", "justify-center"]) assert.ok(classes(panel).includes(name), name);
  for (const chip of document.querySelectorAll("button")) {
    assert.equal(chip.className, "bg-kanban-active-cardbg hover:bg-hover-active rounded text-white-black p-2 text-meta text-left w-full");
  }
});

test("flag on: chat opened on a ticket puts its starter questions bottom left too", () => {
  const document = welcomeDocument({ flagOn: true, ticket: true });
  const chips = questionChips(document);
  assert.equal(chips.length, 4);
  const panel = document.body.firstElementChild;
  for (const name of ["items-start", "justify-end", "pb-2"]) assert.ok(classes(panel).includes(name), name);
  for (const name of ["items-center", "justify-center"]) assert.ok(!classes(panel).includes(name), name);
  for (const chip of chips) {
    for (const name of ["w-fit", "max-w-full", "text-content", "font-normal", "rounded-[4px]", "bg-kanban-active-cardbg", "hover:bg-hover-active"]) {
      assert.ok(classes(chip).includes(name), name);
    }
    for (const name of ["w-full", "text-meta", "rounded"]) assert.ok(!classes(chip).includes(name), name);
  }
});

test("still allowed: flag off keeps ticket starter questions centered and full width", () => {
  const document = welcomeDocument({ flagOn: false, ticket: true });
  const chips = questionChips(document);
  assert.equal(chips.length, 4);
  const panel = document.body.firstElementChild;
  for (const name of ["items-center", "justify-center"]) assert.ok(classes(panel).includes(name), name);
  for (const chip of chips) {
    assert.equal(chip.className, "bg-kanban-active-cardbg hover:bg-hover-active rounded p-2 text-xs text-left w-full");
  }
});
