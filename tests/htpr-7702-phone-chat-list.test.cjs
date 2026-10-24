const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const file = "src/components/AI_CHAT/AgentSidebarChatCommands.tsx";
const source = read(file);
const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let placement;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" && node.arguments[0]?.getText(parsed).includes("const host = hostRef.current")) placement = node;
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(placement, "load the real placement effect, not a copied sizing formula");
const compiled = ts.transpileModule(`const effect = ${placement.arguments[0].getText(parsed)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function view({ mobile = true, enabled = true, composerTop = 558, listTop = 330, viewportHeight = 664, noComposer = false, noSidebar = false } = {}) {
  const dom = new JSDOM(`<div data-ai-chat-composer-root id="other-sidebar"></div><div data-testid="ai-sidebar"><button id="anchor"></button><ul id="list" tabindex="-1"></ul><div data-ai-chat-composer-root inert id="inactive"></div><div hidden><div data-ai-chat-composer-root id="hidden"></div></div>${noComposer ? "" : '<div data-ai-chat-composer-root id="composer"><input id="editor"></div>'}</div>`);
  const { window } = dom;
  const { document } = window;
  const host = document.getElementById("list");
  const anchor = document.getElementById("anchor");
  const composer = document.getElementById("composer");
  const editor = document.getElementById("editor");
  const rect = (top, width = 339, height = 37) => ({ top, bottom: top + height, left: 58, width, height });
  const geometry = { composerTop, listTop };
  host.getBoundingClientRect = () => rect(geometry.listTop, 288, 326);
  anchor.getBoundingClientRect = () => rect(geometry.listTop - 48, 180, 44);
  document.getElementById("inactive").getBoundingClientRect = () => rect(100);
  document.getElementById("hidden").getBoundingClientRect = () => rect(0, 0, 0);
  document.getElementById("other-sidebar").getBoundingClientRect = () => rect(50);
  if (composer) composer.getBoundingClientRect = () => rect(geometry.composerTop);
  if (noSidebar) document.getElementById("list").parentElement.removeAttribute("data-testid");
  Object.defineProperty(window, "innerHeight", { value: viewportHeight, writable: true });
  Object.defineProperty(window, "visualViewport", { value: new window.EventTarget() });
  let closed = 0;
  const effect = new Function("hostRef", "anchorRef", "isMobile", "phoneChatList", "onClose", "window", "document", `${compiled}\nreturn effect;`)(
    { current: host }, { current: anchor }, mobile, enabled, () => { closed++; }, window, document,
  );
  const cleanup = effect();
  return { window, host, anchor, composer, editor, geometry, cleanup, get closed() { return closed; }, dispose() { cleanup(); window.close(); } };
}

test("phone max height uses active same-sidebar composer top minus actual list top minus 12", () => {
  const chat = view();
  try {
    assert.equal(chat.host.style.maxHeight, "216px");
    assert.equal(chat.geometry.listTop + parseFloat(chat.host.style.maxHeight), chat.geometry.composerTop - 12);
    assert.equal(chat.host.style.maxWidth, "958px");
  } finally { chat.dispose(); }
});

test("phone composer cap clamps at zero and cannot exceed the viewport cap", () => {
  for (const [composerTop, expected] of [[335, "0px"], [300, "0px"], [900, "322px"]]) {
    const chat = view({ composerTop });
    try { assert.equal(chat.host.style.maxHeight, expected); } finally { chat.dispose(); }
  }
});

for (const [name, options] of [
  ["desktop with a composer below the list", { mobile: false }],
  ["phone without an active composer", { noComposer: true }],
  ["phone without a sidebar ancestor", { noSidebar: true }],
  ["phone flag Off", { enabled: false }],
]) {
  test(`${name} keeps the original viewport-bottom cap`, () => {
    const chat = view(options);
    try { assert.equal(chat.host.style.maxHeight, "326px"); } finally { chat.dispose(); }
  });
}

test("window resize and visualViewport resize/scroll recompute the phone cap and clean up", () => {
  const chat = view();
  try {
    for (const [target, event, top] of [[chat.window, "resize", 520], [chat.window.visualViewport, "resize", 480], [chat.window.visualViewport, "scroll", 450]]) {
      chat.geometry.composerTop = top;
      target.dispatchEvent(new chat.window.Event(event));
      assert.equal(chat.host.style.maxHeight, `${top - chat.geometry.listTop - 12}px`);
    }
    chat.geometry.listTop = 350;
    chat.window.dispatchEvent(new chat.window.Event("resize"));
    assert.equal(chat.host.style.maxHeight, "88px");
    chat.cleanup();
    chat.geometry.composerTop = 400;
    for (const target of [chat.window, chat.window.visualViewport]) {
      target.dispatchEvent(new chat.window.Event("resize"));
      target.dispatchEvent(new chat.window.Event("scroll"));
    }
    assert.equal(chat.host.style.maxHeight, "88px");
  } finally { chat.dispose(); }
});

test("desktop ignores visualViewport events and still recomputes its viewport cap on resize", () => {
  const chat = view({ mobile: false });
  try {
    chat.window.innerHeight = 600;
    chat.window.visualViewport.dispatchEvent(new chat.window.Event("resize"));
    assert.equal(chat.host.style.maxHeight, "326px");
    chat.window.dispatchEvent(new chat.window.Event("resize"));
    assert.equal(chat.host.style.maxHeight, "262px");
  } finally { chat.dispose(); }
});

test("composer pointerdown closes the list without preventing default focus or selecting a row", () => {
  const chat = view();
  try {
    const pointer = new chat.window.Event("pointerdown", { bubbles: true, cancelable: true });
    assert.equal(chat.editor.dispatchEvent(pointer), true);
    assert.equal(pointer.defaultPrevented, false);
    assert.equal(chat.closed, 1);
    chat.editor.focus();
    assert.equal(chat.window.document.activeElement, chat.editor);
    chat.host.dispatchEvent(new chat.window.Event("pointerdown", { bubbles: true }));
    chat.anchor.dispatchEvent(new chat.window.Event("pointerdown", { bubbles: true }));
    assert.equal(chat.closed, 1);
  } finally { chat.dispose(); }
});

test("placement follows phone context and flag changes; existing list styles and shared rows stay intact", () => {
  assert.equal(placement.arguments[1].getText(parsed), "[anchorRef, onClose, isMobile, phoneChatList]");
  assert.match(source, /className="absolute left-0 top-full z-\[1200\] mt-1 w-72 overflow-y-auto rounded-md bg-modalBackground py-1 text-white-black shadow-md outline-none"/);
  assert.match(source, /<CommandList\s+isMobile=\{isMobile\}\s+inline/);
});

test("ticket flag is a low-risk Everyone bugfix with an explicit Off rollback", () => {
  const js = ts.transpileModule(read("src/lib/flags/definitions/htpr-7702-phone-chat-list.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("exports", js)(loaded.exports);
  const flag = loaded.exports.default;
  assert.equal(flag.key, "htpr-7702-phone-chat-list");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.match(flag.releaseRisk.reason, /Off restores viewport-only sizing/);
});
