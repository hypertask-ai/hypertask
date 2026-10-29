const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const FLAG = "htpr-7708-chat-list-rows";
const noop = () => {};

function load(file, mocks = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  }).outputText;
  new Function("require", "module", "exports", js)(name => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return { __esModule: true, ...mocks[name] };
  }, loaded, loaded.exports);
  return loaded.exports;
}

const flag = load("src/lib/flags/definitions/htpr-7708-chat-list-rows.ts");
const names = [
  "AI chat",
  "Archive these 60 tasks: QASA-1454, QASA-1455, QASA-1456, QASA-1457, QASA-1458",
  "HTPR-7650 QA 1792812226726-848138-phone aiChatOpenNewTickets",
  "1792812226726848138aiChatOpenNewTickets".repeat(6),
];

function rows({ mobile = false, inline, enabled = true, leadingIcon } = {}) {
  const CommandList = load("src/components/Modals/commands/HTC/CommandList.tsx", {
    "lucide-react": require("lucide-react"),
    "@/store": { currentProjectAtom: {} },
    "@/lib/state": { useRecoilState: () => [null, noop] },
    "@/utils/getCurrentUser": { getCurrentUserFromCookies: () => ({ id: 7 }) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "./MobileCommandIcon": { MobileCommandIcon: () => React.createElement("span", { "data-mobile-icon": true }) },
    "@/hooks/useFlag": { useFlag: key => { assert.equal(key, FLAG); return enabled; } },
    "@/lib/flags/definitions/htpr-7708-chat-list-rows": flag,
  }).default;
  const commandLists = names.map((name, index) => ({ key: `session:${index}`, name, commandMode: 1, leadingIcon }));
  const html = renderToStaticMarkup(React.createElement("ul", null, React.createElement(CommandList, {
    commandLists, selectedCommand: commandLists[0], groupIndex: 0, inline, isMobile: mobile,
    handleMouseLeave: noop, handleMouseEnter: noop, commandRef: { current: null }, onClickHandler: noop,
  })));
  return new JSDOM(html);
}

for (const mobile of [false, true]) {
  test(`${mobile ? "phone" : "desktop"} sidebar names clamp to two lines, break tokens and use auto-height rows`, () => {
    const dom = rows({ mobile, inline: true });
    try {
      const elements = [...dom.window.document.querySelectorAll("li")];
      assert.equal(elements.length, names.length);
      for (const [index, row] of elements.entries()) {
        assert.ok(row.classList.contains("h-auto"));
        assert.ok(row.classList.contains(mobile ? "min-h-[52px]" : "min-h-[36px]"));
        assert.ok(row.classList.contains("py-2"));
        assert.ok(!row.classList.contains("h-[36px]"));
        assert.equal(row.getAttribute("role"), "option");
        const title = row.querySelector(".line-clamp-2");
        assert.ok(title);
        for (const token of ["min-w-0", "flex-1", "[overflow-wrap:anywhere]"]) assert.ok(title.classList.contains(token));
        assert.ok(!title.classList.contains("flex"), "flex display would defeat the line clamp");
        assert.equal(title.textContent, names[index], "clamp visually, never truncate the saved title");
      }
      assert.equal(dom.window.document.querySelectorAll("[data-mobile-icon]").length, mobile ? names.length : 0);
    } finally { dom.window.close(); }
  });
}

test("non-inline Ctrl+K rows stay identical with the flag On or Off on desktop and phone", () => {
  for (const mobile of [false, true]) {
    const on = rows({ mobile });
    const off = rows({ mobile, enabled: false });
    try {
      assert.equal(on.serialize(), off.serialize());
      assert.equal(on.window.document.querySelector(".line-clamp-2"), null);
      const row = on.window.document.querySelector("li");
      assert.equal(row.getAttribute("role"), null);
      assert.ok(row.classList.contains(mobile ? "min-h-[52px]" : "h-[36px]"));
      assert.equal(row.querySelector("span.flex-grow").textContent, names[0]);
    } finally { on.window.close(); off.window.close(); }
  }
});

test("flag Off restores legacy inline row sizing and unclamped titles", () => {
  for (const mobile of [false, true]) {
    const dom = rows({ mobile, inline: true, enabled: false });
    try {
      const row = dom.window.document.querySelector("li");
      assert.ok(row.classList.contains(mobile ? "min-h-[52px]" : "h-[36px]"));
      assert.ok(!row.classList.contains("h-auto"));
      assert.equal(dom.window.document.querySelector(".line-clamp-2"), null);
      assert.equal(row.getAttribute("role"), "option");
    } finally { dom.window.close(); }
  }
});

test("only the sidebar caller opts into inline rows; the phone list cap stays in place", () => {
  const sidebar = read("src/components/AI_CHAT/AgentSidebarChatCommands.tsx");
  assert.match(sidebar, /<CommandList\s+isMobile=\{isMobile\}\s+inline\s/);
  assert.match(sidebar, /Math\.min\(window\.innerHeight, composer\.getBoundingClientRect\(\)\.top\) - host\.getBoundingClientRect\(\)\.top - 12/);
  const group = read("src/components/Modals/commands/HTC/CommandGroup.tsx").match(/<CommandList\b[\s\S]*?\/>/);
  assert.ok(group);
  assert.doesNotMatch(group[0], /\binline\b/);
});

test("row containment flag defaults to Everyone as a low-risk bugfix with Off rollback", () => {
  assert.equal(flag.default.key, FLAG);
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.match(flag.default.releaseRisk.reason, /Off restores/);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "phone" : "desktop"} agent icon renders once, ahead of its full name`, () => {
    const dom = rows({ mobile, inline: true, leadingIcon: React.createElement("svg", { "data-agent-icon": true, className: "shrink-0" }) });
    try {
      const rendered = [...dom.window.document.querySelectorAll("li")];
      assert.equal(rendered.length, names.length);
      for (const row of rendered) {
        assert.equal(row.firstElementChild.getAttribute("data-agent-icon"), "true");
        assert.equal(row.querySelectorAll("svg").length, 1);
        assert.equal(row.querySelectorAll("[data-mobile-icon]").length, 0);
      }
    } finally { dom.window.close(); }
  });
}
