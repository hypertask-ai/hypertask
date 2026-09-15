// HTPR-6197: the proposal card heading follows the ticket, not the confirm click.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { createJiti } = require("jiti");

const { proposalCardHeading, PROPOSAL_HEADING_PENDING, PROPOSAL_HEADING_CREATED } =
  createJiti(__filename, {
    alias: { "@": path.join(__dirname, "..", "src") },
    interopDefault: true,
  })(path.join(__dirname, "../src/lib/agents/chatTicketProposal.ts"));

test("pending proposal keeps the nothing-done heading", () => {
  assert.equal(
    proposalCardHeading({ status: "PENDING", task: null }),
    PROPOSAL_HEADING_PENDING,
  );
});

test("confirmed proposal with a ticket says Ticket created", () => {
  assert.equal(
    proposalCardHeading({
      status: "CONFIRMED",
      task: { ticketNumber: "HTPR-1", url: "/detail/project-15/1" },
    }),
    PROPOSAL_HEADING_CREATED,
  );
});

test("confirmed proposal still creating keeps the nothing-done heading", () => {
  assert.equal(
    proposalCardHeading({ status: "CONFIRMED", task: null }),
    PROPOSAL_HEADING_PENDING,
  );
});

test("failed and dismissed cards keep the nothing-done heading", () => {
  assert.equal(
    proposalCardHeading({ status: "FAILED", task: null }),
    PROPOSAL_HEADING_PENDING,
  );
  assert.equal(
    proposalCardHeading({ status: "DISMISSED", task: null }),
    PROPOSAL_HEADING_PENDING,
  );
});
