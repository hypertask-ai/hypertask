const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const FLAG_KEY = "htpr-9399-archived-board-tickets";
const GUARD_FILE = "src/utils/controllers/projects/archivedBoardTickets.ts";
const FLAG_FILE = "src/lib/flags/definitions/htpr-9399-archived-board-tickets.ts";

function flagState(enabled) {
  return { isFeatureEnabled: async () => enabled };
}

function loadGuard(enabled) {
  assert.equal(fs.existsSync(GUARD_FILE), true, "archived board guard is not on this code");
  return load(GUARD_FILE, {
    "@/lib/flags": flagState(enabled),
  });
}

test("the archived board guard ships to everyone as a reversible bugfix", () => {
  assert.equal(fs.existsSync(FLAG_FILE), true, "archived board ticket flag is not on this code");
  const { default: flag } = load(FLAG_FILE);
  assert.equal(flag.key, FLAG_KEY);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("an archived board refuses new tickets and names the board", async () => {
  const { assertBoardTakesNewTickets, ArchivedBoardTicketError } = loadGuard(true);
  await assert.rejects(
    assertBoardTakesNewTickets({ name: "project-11514", title: "Fleet CI & Infra", status: "Archive" }, 6),
    (error) => {
      assert.ok(error instanceof ArchivedBoardTicketError);
      assert.match(error.message, /Fleet CI & Infra/);
      assert.match(error.message, /archived/);
      return true;
    },
  );
});

test("a board that is not archived still accepts tickets", async () => {
  const { assertBoardTakesNewTickets, archivedBoardTicketRefusal } = loadGuard(true);
  assert.equal(await assertBoardTakesNewTickets({ name: "project-15", title: "Hypertask Product", status: "Normal" }, 6), undefined);
  assert.equal(await archivedBoardTicketRefusal({ name: "project-15", title: "Hypertask Product", status: "Normal" }, 6), null);
});

test("switching the flag off lets an archived board take tickets again", async () => {
  const { archivedBoardTicketRefusal } = loadGuard(false);
  assert.equal(await archivedBoardTicketRefusal({ name: "project-11514", title: "Fleet CI & Infra", status: "Archive" }, 6), null);
});
