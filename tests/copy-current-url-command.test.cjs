const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const registrySource = read("src/components/Modals/commands/HTC/AllCommands.ts");
const paletteSource = read("src/components/Modals/commands/HTC/commands.tsx");
const actionsSource = read("src/components/commands.tsx");
const copyUrlSource = read("src/hooks/General/useCopyURL.ts");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"),
);
const { writeTextToClipboard } = jiti(
  path.join(root, "src/lib/utils/clipboard.ts"),
);

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalConsoleError = console.error;

test.afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
  console.error = originalConsoleError;
});

test("copy current page URL is one global Navigate command", () => {
  for (const context of ["Others", "Task", "Kanban", "Inbox"]) {
    const matches = getAllCommands({ context })
      .flatMap((group) => group.commandLists)
      .filter((command) => command.key === "copyCurrentPageUrl");
    assert.equal(matches.length, 1, `expected one command in ${context}`);
    assert.equal(matches[0].name, "Copy current page URL");
  }

  const navigateEnd = registrySource.indexOf("const getTimeCommands");
  assert.ok(
    registrySource.indexOf('key: "copyCurrentPageUrl"') < navigateEnd,
    "the global command should remain in Navigate",
  );
  assert.doesNotMatch(registrySource, /Copy URL of view|copyCurrentViewId/);
});

test("the rollout flag gates both visibility and direct execution", () => {
  assert.match(
    paletteSource,
    /useFlag\("htpr-6112-copy-current-url"\)[\s\S]*CommandMode\.CopyViewURL \|\|\s*copyCurrentUrlEnabled/,
  );
  assert.match(
    actionsSource,
    /useFlag\("htpr-6112-copy-current-url"\)[\s\S]*mode === CommandMode\.CopyViewURL && !copyCurrentUrlEnabled[\s\S]*boardCloseHandler\(\);\s*return;/,
  );
});

test("the command awaits copying the exact browser URL before reporting success", () => {
  assert.match(
    actionsSource,
    /const copied = await writeTextToClipboard\(window\.location\.href\);\s*if \(copied\) toast\.success\("Current page URL copied"\)/,
  );
  assert.match(
    actionsSource,
    /else toast\.error\("Unable to copy current page URL"\);\s*} finally {\s*boardCloseHandler\(\);/,
  );
  assert.doesNotMatch(actionsSource, /getViewFromProject|Private views cannot be shared|No active views/);
  assert.match(copyUrlSource, /import \{ writeTextToClipboard \} from "@\/lib\/utils\/clipboard"/);
  assert.match(copyUrlSource, /`\$\{baseURL\}\/detail\/project-\$\{projectId\}\/\$\{uniqueIndex\}`/);
});

test("clipboard writes resolve only after the browser accepts the URL", async () => {
  let copied;
  let release;
  const browserWrite = new Promise((resolve) => {
    release = resolve;
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text) => {
          copied = text;
          await browserWrite;
        },
      },
    },
  });

  let settled = false;
  const result = writeTextToClipboard("https://app.hypertask.ai/project?id=15&view=mine#task")
    .then((value) => {
      settled = true;
      return value;
    });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  assert.equal(await result, true);
  assert.equal(copied, "https://app.hypertask.ai/project?id=15&view=mine#task");
});

test("a successful legacy copy is not overridden when element.remove is unavailable", async () => {
  let removed = false;
  console.error = () => {};
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
  });
  const parentNode = {
    removeChild: () => { removed = true; },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: { appendChild: () => {} },
      createElement: () => ({
        setAttribute: () => {},
        style: {},
        focus: () => {},
        select: () => {},
        parentNode,
      }),
      execCommand: () => true,
    },
  });

  assert.equal(await writeTextToClipboard("https://app.hypertask.ai/project"), true);
  assert.equal(removed, true);
});

test("clipboard denial returns failure after the browser fallback", async () => {
  let removed = false;
  console.error = () => {};
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
  });
  const parentNode = {
    removeChild: () => { removed = true; },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: { appendChild: () => {} },
      createElement: () => ({
        setAttribute: () => {},
        style: {},
        focus: () => {},
        select: () => {},
        parentNode,
      }),
      execCommand: () => false,
    },
  });

  assert.equal(await writeTextToClipboard("https://app.hypertask.ai/inbox"), false);
  assert.equal(removed, true);
});
