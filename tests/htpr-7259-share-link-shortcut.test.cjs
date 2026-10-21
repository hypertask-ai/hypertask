const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
function load(file, mocks) {
  const mod = { exports: {} };
  new Function("require", "module", "exports", compile(read(file)))(
    (key) => {
      if (Object.hasOwn(mocks, key)) return { __esModule: true, ...mocks[key] };
      if (key.startsWith("@/")) throw new Error(`Unstubbed dependency: ${key}`);
      return require(key);
    }, mod, mod.exports,
  );
  return mod.exports;
}

const { KeyCodes } = load("src/lib/constants/keyboard-handler.ts", {});
const { taskDetailNavigationKeymap } = load("src/app/detail/[...slug]/taskDetailNavigationKeymap.ts", {
  "@/lib/configs/taskDetail.config": { default: {} },
  "@/lib/keyboard/archiveShortcutGuard": { shouldRunArchiveShortcut: () => false },
  "@/lib/taskDetailArchiveNavigation": { shouldAdvanceAfterNotificationArchive: () => false },
  "@/lib/notifications/archiveShortcutNudge": { clearArchiveShortcutNudge: () => {} },
  "@/models/enums": { CommandMode: {} },
  "@/lib/constants/keyboard-handler": { KeyCodes },
});

function pressCopyShortcut(sharedLink, shiftKey) {
  const copied = [];
  const context = {
    sharedLink,
    currentTask: { id: 1, title: "Trustpilot section", ticketNumber: "inne-1809" },
    copySharedTaskURL: (id) => copied.push(["url", id]),
    copySharedTaskFormattedURL: (id, title, ticketNumber) => copied.push(["formatted", id, title, ticketNumber]),
  };
  const event = { keyCode: KeyCodes.PERIOD, shiftKey, altKey: false, preventDefault: () => {} };
  const command = taskDetailNavigationKeymap(context, event, true).find((candidate) => candidate.matches());
  return { command, result: command.run(), copied };
}

test("copy public link shortcuts do not crash before the share link has loaded", () => {
  const url = pressCopyShortcut(undefined, true);
  assert.equal(url.command.action, "copySharedUrl");
  assert.deepEqual(url.copied, [["url", undefined]]);
  assert.equal(url.result.stop, true);

  const formatted = pressCopyShortcut(undefined, false);
  assert.equal(formatted.command.action, "copySharedFormattedUrl");
  assert.deepEqual(formatted.copied, [["formatted", undefined, "Trustpilot section", "inne-1809"]]);
});

test("still allowed: copy public link shortcuts copy the loaded share link", () => {
  assert.deepEqual(pressCopyShortcut({ id: "share-abc" }, true).copied, [["url", "share-abc"]]);
  assert.deepEqual(pressCopyShortcut({ id: "share-abc" }, false).copied, [
    ["formatted", "share-abc", "Trustpilot section", "inne-1809"],
  ]);
});
