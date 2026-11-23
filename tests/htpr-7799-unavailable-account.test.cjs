const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

function setup({ enabled = true, user = { id: 985, email: "member@example.com" }, project = { id: 7049 } } = {}) {
  const calls = { switcher: [], boardManager: [], navigation: [], signOut: 0, lookup: 0 };
  let currentUser = user;
  const setBoardManager = value => calls.boardManager.push(value);
  const load = loader({
    "@/store": { currentUserAtom: "user", showAccountSwitcherAtom: "switcher", showBoardManagerAtom: "manager" },
    "@/lib/state": {
      useRecoilValue: atom => { assert.equal(atom, "user"); return currentUser; },
      useSetRecoilState: atom => { assert.equal(atom, "switcher"); return value => calls.switcher.push(value); },
      useRecoilState: atom => { assert.equal(atom, "manager"); return [false, setBoardManager]; },
    },
    "@/hooks/useFlag": { useFlag: key => { assert.equal(key, "htpr-7799-project-entry"); return enabled; } },
    "@/lib/flags/keys": { HTPR_7799_PROJECT_ENTRY_FLAG: "htpr-7799-project-entry" },
    "@/utils/api/Homepage": { getFirstProject: async () => { calls.lookup++; return { data: project }; } },
    "@/hooks/MultiPages/HTC/useSignout": { useSignout: () => ({ handleHardReset: async () => { calls.signOut++; } }) },
    "next/head": { default: () => null },
    "next/navigation": { useRouter: () => ({ replace: url => calls.navigation.push(url) }) },
  });
  const Page = load("src/app/unauthorized/page.tsx").default;
  const view = mount();
  const render = () => view.render(React.createElement(Page));
  render();
  return { view, calls, updateUser: user => { currentUser = user; render(); } };
}

function button(view, name) {
  return [...view.container.querySelectorAll("button")].find(element => element.textContent.trim() === name);
}

test("unavailable board names only the current account and opens the shared switcher without signing out", () => {
  const { view, calls, updateUser } = setup();
  try {
    window.localStorage.setItem("previousAccount", "owner@example.com");
    assert.ok(view.container.textContent.includes("Signed in as member@example.com"));
    assert.equal(view.container.textContent.includes("owner@example.com"), false);
    assert.equal(view.container.querySelector("h1").textContent.trim(), "This board or ticket is unavailable");
    React.act(() => button(view, "Switch account").click());
    assert.deepEqual(calls.switcher, [true]);
    assert.equal(calls.signOut, 0);
    assert.equal(calls.lookup, 0);
    assert.deepEqual(calls.navigation, []);
    assert.deepEqual(calls.boardManager, [false]);
    updateUser({ id: 4037, email: "second@example.com" });
    assert.ok(view.container.textContent.includes("Signed in as second@example.com"));
    assert.equal(view.container.textContent.includes("member@example.com"), false);
    updateUser(null);
    assert.equal(view.container.textContent.includes("Signed in as"), false);
    assert.equal(button(view, "Switch account"), undefined);
  } finally { view.close(); }
});

test("flag-off and anonymous recovery preserve the existing unavailable screen", () => {
  for (const options of [{ enabled: false }, { user: null }, { user: { id: 985 } }]) {
    const { view, calls } = setup(options);
    try {
      assert.equal(view.container.textContent.includes("Signed in as"), false);
      assert.equal(button(view, "Switch account"), undefined);
      assert.equal(view.container.querySelectorAll("button").length, 1);
      assert.ok(button(view, "Return to previous board"));
      assert.deepEqual(calls.switcher, []);
    } finally { view.close(); }
  }
});

test("legitimate members still return to their readable board through the unchanged recovery boundary", async () => {
  for (const enabled of [true, false]) {
    const { view, calls } = setup({ enabled });
    try {
      await React.act(async () => button(view, "Return to previous board").click());
      assert.equal(calls.lookup, 1);
      assert.deepEqual(calls.navigation, ["/project?id=7049"]);
      assert.equal(calls.signOut, 0);
      assert.deepEqual(calls.switcher, []);
    } finally { view.close(); }
  }
});

test("no-readable-board return still follows the existing sign-out fallback", async () => {
  const { view, calls } = setup({ project: null });
  try {
    await React.act(async () => button(view, "Return to previous board").click());
    assert.equal(calls.lookup, 1);
    assert.equal(calls.signOut, 1);
    assert.deepEqual(calls.navigation, []);
    assert.deepEqual(calls.switcher, []);
  } finally { view.close(); }
});
