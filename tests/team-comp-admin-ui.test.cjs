const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");
const { addYears, format } = require("date-fns");

const root = path.resolve(__dirname, "..");
const TEAM_ID = "11111111-1111-4111-8111-111111111111";

function stub(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

let owner = true;
stub(path.join(root, "src/lib/flags.ts"), {
  FEATURE_FLAG_OWNER_USER_ID: 6,
  isFeatureFlagOwner: async () => owner,
});
stub(require.resolve("next/headers"), { headers: async () => new Headers() });
stub(require.resolve("next/navigation"), { notFound: () => { throw new Error("NOT_FOUND"); } });
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false, jsx: { runtime: "automatic" } });
const Page = jiti(path.join(root, "src/app/admin/comp/page.tsx")).default;
const Admin = jiti(path.join(root, "src/app/admin/comp/TeamCompAdmin.tsx")).default;

test("server page requires owner identity", async () => {
  owner = false;
  await assert.rejects(Page(), /NOT_FOUND/);
  owner = true;
  assert.equal((await Page()).type, Admin);
});

test("admin finds teams by name or ID, shows state, defaults expiry one year ahead, sets and clears", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/admin/comp" });
  const names = ["window", "document", "HTMLElement", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  let reactRoot;
  try {
    for (const name of ["window", "document", "HTMLElement", "navigator"]) {
      Object.defineProperty(global, name, { value: name === "window" ? dom.window : dom.window[name], configurable: true, writable: true });
    }
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const calls = [];
    let fail = false;
    let view = { teamId: TEAM_ID, title: "Partner", currentPlan: "Free", compedPlan: "Pro", compedUntil: null, activeCompPlan: null };
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), ...options });
      if (fail) return Response.json({ error: "Comp unavailable" }, { status: 403 });
      if (options.method === "POST") {
        const input = JSON.parse(options.body);
        view = { ...view, currentPlan: input.plan, compedPlan: input.plan, compedUntil: input.until, activeCompPlan: input.plan };
      } else if (options.method === "DELETE") {
        view = { ...view, currentPlan: "Free", compedPlan: null, compedUntil: null, activeCompPlan: null };
      }
      return Response.json(String(url).includes("query=") ? { teams: [view] } : { comp: view });
    };
    const { createRoot } = require("react-dom/client");
    reactRoot = createRoot(document.getElementById("root"));
    await React.act(async () => reactRoot.render(React.createElement(Admin)));
    const setInput = async (input, value) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const submit = async (form) => React.act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    const button = (label) => [...document.querySelectorAll("button")].find((el) => el.textContent === label);
    await setInput(document.querySelector("input"), "Partner");
    await submit(document.querySelector("form"));
    assert.match(calls.at(-1).url, /query=Partner/);
    assert.match(document.querySelector("section").textContent, /Current plan: Free/);
    assert.match(document.querySelector("section").textContent, /Comp state: Not comped/);
    const date = document.querySelector('input[type="date"]');
    assert.equal(date.required, true);
    assert.equal(date.value, format(addYears(new Date(), 1), "yyyy-MM-dd"));
    const select = document.querySelector("select");
    assert.deepEqual([...select.options].map((option) => option.value), ["Pro", "BYOK"]);
    const borderUtility = /(?:^|\s)(?:[\w-]+:)*border(?:-|\s|$)/;
    assert.match("rounded-sm border border-border-light-gray-thin", borderUtility);
    assert.match("focus:border-white-black", borderUtility);
    for (const control of document.querySelectorAll("input, select")) {
      assert.doesNotMatch(control.className, borderUtility);
      assert.ok(control.classList.contains("bg-comment-description"));
    }
    for (const label of ["Find team", "Clear comp"]) {
      assert.doesNotMatch(button(label).className, borderUtility);
      assert.ok(button(label).classList.contains("text-text-light-gray"));
      assert.equal(button(label).classList.contains("bg-shadcn-primary"), false);
    }
    const actions = [...document.querySelectorAll("section form button")];
    assert.deepEqual(actions.map((action) => action.textContent), ["Clear comp", "Set comp"]);
    assert.ok(button("Set comp").classList.contains("bg-shadcn-primary"));
    assert.ok(button("Set comp").classList.contains("text-primary-foreground"));
    assert.equal(button("Set comp").classList.contains("text-text-light-gray"), false);
    assert.doesNotMatch(button("Set comp").className, borderUtility);
    await React.act(async () => {
      select.value = "BYOK";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await submit(document.querySelector("section form"));
    const mutation = calls.at(-1);
    assert.equal(mutation.method, "POST");
    assert.equal(mutation.url, "/api/admin/team-comp");
    assert.equal(JSON.parse(mutation.body).plan, "BYOK");
    assert.equal(JSON.parse(mutation.body).teamId, TEAM_ID);
    assert.ok(new Date(JSON.parse(mutation.body).until).getTime() > Date.now());
    assert.match(document.querySelector("section").textContent, /Current plan: BYOK/);
    assert.match(document.querySelector('[role="status"]').textContent, /Comp saved/);
    await React.act(async () => button("Clear comp").click());
    assert.equal(calls.at(-1).method, "DELETE");
    assert.deepEqual(JSON.parse(calls.at(-1).body), { teamId: TEAM_ID });
    assert.match(document.querySelector("section").textContent, /Comped until: None/);
    assert.match(document.querySelector('[role="status"]').textContent, /Comp cleared/);
    assert.equal(button("Clear comp").disabled, true);
    await setInput(document.querySelector("input"), TEAM_ID);
    await submit(document.querySelector("form"));
    assert.match(calls.at(-1).url, new RegExp(`teamId=${TEAM_ID}`));
    fail = true;
    await submit(document.querySelector("section form"));
    assert.equal(document.querySelector('[role="alert"]').textContent, "Comp unavailable");
    assert.equal(document.querySelector('[role="status"]'), null);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
});
