const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToStaticMarkup, renderToString } = require("react-dom/server");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const message = "Part of the team? You're almost there to begin working in Hypertask";

function load(relativePath, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => (name in mocks ? { __esModule: true, ...mocks[name] } : require(name)), exports);
  return exports;
}

const MobileViewContext = React.createContext(false);
const SharedTaskPageFooter = load("src/components/PageComponents/TaskDetail/SharedTask/Footer/Footer.tsx", {
  "@/models/model": {},
  "@prisma/client": {},
  "next/navigation": { useRouter: () => ({ push() {} }) },
  "@/lib/contexts/mobileContext": { MobileViewContext },
}).default;

let authenticatedUserId = 0;
let metaReads = 0;
const hydrated = load("src/hooks/General/useHydrated.ts", {});
const { useTaskDetailMetaField } = load("src/lib/useTaskDetailMetaField.ts", {
  "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId }) },
  "@/hooks/General/useHydrated": hydrated,
  "@/lib/taskDetailReads": {
    fetchTaskDetailMeta: async () => {
      metaReads += 1;
      return { labels: [{ id: "bug", name: "Bug" }] };
    },
    shouldRefetchDetailOnMount: true,
  },
});

function inviteHtml(mobile) {
  return renderToStaticMarkup(
    React.createElement(
      MobileViewContext.Provider,
      { value: mobile },
      React.createElement(SharedTaskPageFooter, { shareId: "share-9546" }, React.createElement("main", null, "HOME-9")),
    ),
  );
}

function inviteText(html) {
  const dom = new JSDOM(html);
  const sentence = [...dom.window.document.querySelectorAll("p, div, span")].find((node) => {
    const own = [...node.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return own === message;
  });
  const action = [...dom.window.document.querySelectorAll("div")].find((node) => node.textContent === "Sign up or Login");
  return {
    sentence: sentence ? sentence.textContent.replace(/\s+/g, " ").trim() : "",
    actionInsideSentence: sentence ? sentence.textContent.includes("Sign up or Login") : true,
    action: action ? action.textContent : "",
    stacked: Boolean(sentence && sentence.parentElement.className.includes("flex-col")),
    ticket: dom.window.document.querySelector("main")?.textContent ?? "",
  };
}

function followerNames(rows) {
  const relativePath = "src/components/PageComponents/TaskDetail/SharedTask/MainPage/shareFollowers.ts";
  if (!fs.existsSync(path.join(root, relativePath))) return null;
  const { shareFollowerPeople } = load(relativePath, { "@/models/model": {} });
  const people = shareFollowerPeople(rows);
  return people.map((person) => person.displayName);
}

function Labels() {
  const { data } = useTaskDetailMetaField("labels", ["taskLabels", 9546], 9546, async () => [{ id: "secret", name: "SECRET" }]);
  return React.createElement("ul", null, (data ?? []).map((label) => React.createElement("li", { key: label.id }, label.name)));
}

async function renderedLabels(userId) {
  authenticatedUserId = userId;
  metaReads = 0;
  const previousWindow = Object.getOwnPropertyDescriptor(global, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(global, "document");
  const previousAct = Object.getOwnPropertyDescriptor(global, "IS_REACT_ACT_ENVIRONMENT");
  delete global.window;
  delete global.document;
  const serverHtml = renderToString(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Labels)));
  const dom = new JSDOM(`<div id="root">${serverHtml}</div>`, { url: "https://app.hypertask.ai/share?id=guest" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let reactRoot;
  try {
    await React.act(async () => {
      reactRoot = hydrateRoot(document.getElementById("root"), React.createElement(QueryClientProvider, { client }, React.createElement(Labels)));
    });
    await React.act(async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    return { text: document.getElementById("root").textContent, reads: metaReads };
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    client.clear();
    dom.window.close();
    if (previousWindow) Object.defineProperty(global, "window", previousWindow);
    else delete global.window;
    if (previousDocument) Object.defineProperty(global, "document", previousDocument);
    else delete global.document;
    if (previousAct) Object.defineProperty(global, "IS_REACT_ACT_ENVIRONMENT", previousAct);
    else delete global.IS_REACT_ACT_ENVIRONMENT;
  }
}

test("a phone guest sees the invite sentence and the sign-in action on separate lines", () => {
  const phone = inviteText(inviteHtml(true));
  const desktop = inviteText(inviteHtml(false));
  assert.equal(phone.ticket, "HOME-9");
  assert.equal(phone.sentence, message);
  assert.equal(phone.action, "Sign up or Login");
  assert.equal(phone.actionInsideSentence, false);
  assert.equal(phone.stacked, true);
  assert.equal(desktop.sentence, message);
  assert.equal(desktop.action, "Sign up or Login");
  assert.equal(desktop.actionInsideSentence, false);
  assert.equal(desktop.stacked, false);
});

test("a shared follower list keeps named people and drops a missing account", () => {
  assert.deepEqual(followerNames(undefined), []);
  assert.deepEqual(
    followerNames([
      { user: null },
      { user: { id: 1, displayName: "Franziska Mayer", photoURL: null } },
      { agent: { id: "agent-1", displayName: "Private agent", photoURL: null } },
    ]),
    ["Franziska Mayer", "Private agent"],
  );
});

test("a guest share keeps the public ticket, and a signed-in member still sees that ticket's labels", async () => {
  const guest = await renderedLabels(0);
  assert.equal(guest.text, "");
  assert.equal(guest.reads, 0);

  const member = await renderedLabels(985);
  assert.equal(member.text, "Bug");
  assert.equal(member.reads, 1);
});
