const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/lib/demo/guestBoardBuild.ts"),
  "utf8",
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

// isGuestBoardBuild decides whether what a user types in the AI chat builds a
// board or starts a chat, so a wrong `true` hijacks somebody's message.
function loadModule({ isGuest, innerWidth }) {
  const previousWindow = global.window;
  global.window = { innerWidth };

  const moduleRef = { exports: {} };
  const mockRequire = (request) => {
    if (request === "./isGuestClient") {
      return { isGuestCookieUser: () => isGuest };
    }
    if (request === "./guestSeedTasks") {
      return {
        GUEST_SEED_TASKS: [],
        GUEST_SEED_TASKS_IN_PROGRESS: [],
        GUEST_SEED_TASK_TITLES: [
          "Seed task A",
          "Seed task B",
          "Seed task C",
          "Seed task D",
        ],
      };
    }
    throw new Error(`Unexpected import: ${request}`);
  };

  new Function("module", "exports", "require", javascript)(
    moduleRef,
    moduleRef.exports,
    mockRequire,
  );

  return {
    ...moduleRef.exports,
    restore: () => {
      global.window = previousWindow;
    },
  };
}

const emptyBoard = { tasks: [] };

test("a desktop guest on an empty board builds the board", (t) => {
  const mod = loadModule({ isGuest: true, innerWidth: 1440 });
  t.after(mod.restore);
  assert.equal(mod.isGuestBoardBuild(emptyBoard), true);
});

test("a board that already has tasks chats instead of rebuilding", (t) => {
  const mod = loadModule({ isGuest: true, innerWidth: 1440 });
  t.after(mod.restore);
  assert.equal(mod.isGuestBoardBuild({ tasks: [{ id: 1 }] }), false);
});

test("an unhydrated board never counts as empty", (t) => {
  const mod = loadModule({ isGuest: true, innerWidth: 1440 });
  t.after(mod.restore);
  // `tasks` is only an array once the board payload has loaded; treating the
  // undefined state as empty would build a board over the user's real one.
  assert.equal(mod.isGuestBoardBuild({}), false);
  assert.equal(mod.isGuestBoardBuild(null), false);
});

test("signed-in users are never routed to the board generator", (t) => {
  const mod = loadModule({ isGuest: false, innerWidth: 1440 });
  t.after(mod.restore);
  assert.equal(mod.isGuestBoardBuild(emptyBoard), false);
});

test("mobile guests keep the normal chat", (t) => {
  const mod = loadModule({ isGuest: true, innerWidth: 500 });
  t.after(mod.restore);
  assert.equal(mod.isGuestBoardBuild(emptyBoard), false);
});

test("a board holding only the seed tasks still counts as empty", (t) => {
  const mod = loadModule({ isGuest: true, innerWidth: 1440 });
  t.after(mod.restore);
  assert.equal(
    mod.isGuestBoardBuild({
      tasks: [
        { title: "Seed task A" },
        { title: "Seed task B" },
        { title: "Seed task C" },
        { title: "Seed task D" },
      ],
    }),
    true,
  );
  assert.equal(
    mod.isGuestBoardBuild({ tasks: [{ title: "Seed task A" }, { title: "A real task" }] }),
    false,
  );
});
