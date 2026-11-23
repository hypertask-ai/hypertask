import assert from "node:assert/strict";
import test from "node:test";
import {
  addTicketJumpToTopShortcut,
  scrollTicketToTop,
  ticketShowsJumpToTop,
  TICKET_JUMP_TO_TOP_AFTER_PX,
} from "../src/lib/taskDetailJumpToTop";

test("the jump to top button stays hidden until the ticket has scrolled", () => {
  assert.equal(ticketShowsJumpToTop(0), false);
  assert.equal(ticketShowsJumpToTop(TICKET_JUMP_TO_TOP_AFTER_PX), false);
  assert.equal(ticketShowsJumpToTop(TICKET_JUMP_TO_TOP_AFTER_PX + 1), true);
});

test("jump to top scrolls the ticket scroller to the top", () => {
  const calls: ScrollToOptions[] = [];
  scrollTicketToTop({
    scrollTo(options) {
      calls.push(options);
    },
  });
  assert.deepEqual(calls, [{ top: 0, behavior: "smooth" }]);
});

test("reduced motion jumps to the top without animation", () => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = (() => ({ matches: true })) as unknown as typeof matchMedia;
  try {
    const calls: ScrollToOptions[] = [];
    scrollTicketToTop({
      scrollTo(options) {
        calls.push(options);
      },
    });
    assert.deepEqual(calls, [{ top: 0, behavior: "auto" }]);
  } finally {
    globalThis.matchMedia = previous;
  }
});

test("shortcut help names G then G as jump to top", () => {
  const groups = [
    { title: "Board", sub: [{ shortTitle: "Add task", pressKey: ["C"] }] },
    { title: "Task View", sub: [{ shortTitle: "Follow task", pressKey: ["F"] }] },
  ];
  addTicketJumpToTopShortcut(groups);
  assert.deepEqual(groups[0].sub, [{ shortTitle: "Add task", pressKey: ["C"] }]);
  assert.deepEqual(groups[1].sub, [
    { shortTitle: "Follow task", pressKey: ["F"] },
    { shortTitle: "Jump to top", pressKey: ["G", null, "G"] },
  ]);
});

test("htpr-8998 jump to top ships as a small feature for everyone", async () => {
  const definition = (await import("../src/lib/flags/definitions/htpr-8998-ticket-jump-to-top")).default;
  assert.equal(definition.key, "htpr-8998-ticket-jump-to-top");
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.match(definition.releaseRisk.reason, /Off hides the button/);
});
