const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
function stub(file, exports) {
  const filename = file.startsWith("src/") ? path.join(root, file) : require.resolve(file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub("next/navigation", { useSearchParams: () => new URLSearchParams() });
stub("src/hooks/MultiPages/HTC/useSignout.ts", { useSignout: () => ({ handleHardReset: async () => true }) });
stub("src/hooks/useFlag.tsx", { useFlag: () => true });
stub("src/lib/auth/betterAuthClient.ts", {
  authClient: { useListPasskeys: () => ({ data: [], isPending: false, refetch: async () => {} }) },
});
stub("src/lib/auth/accounts.ts", {
  getActiveAccountId: () => 6,
  listAccounts: async () => [],
  mergeCurrentAccount: (accounts) => accounts,
});
stub("src/components/Modals/SignOut/SignOutModal.tsx", { default: () => null });
stub("src/components/Common/UserAvatar.tsx", { default: () => null });
const AccountsSection = createJiti(__filename, {
  alias: { "@": path.join(root, "src") }, interopDefault: true, jsx: true,
})(path.join(root, "src/components/Modals/Settings/AccountsSection.tsx")).default;

test("Accounts disables unconfigured Figma, enables configured OAuth, and keeps disconnect", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/settings/accounts" });
  const originals = { React: global.React, window: global.window, document: global.document, fetch: global.fetch, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { React, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require("react-dom/client");
  const reactRoot = createRoot(document.getElementById("root"));
  try {
    for (const configured of [false, true]) {
      global.fetch = async (url) => {
        assert.equal(url, "/api/figma/connection");
        return Response.json({ configured, connection: null });
      };
      await React.act(async () => reactRoot.render(React.createElement(AccountsSection, { key: String(configured) })));
      const connect = [...document.querySelectorAll("a, button")].find((element) => element.textContent === "Connect Figma");
      assert.ok(connect);
      if (configured) {
        assert.equal(connect.tagName, "A");
        const url = new URL(connect.href);
        assert.equal(url.pathname, "/api/figma/oauth/start");
        assert.equal(url.searchParams.get("returnTo"), "/settings/accounts");
        assert.doesNotMatch(document.body.textContent, /not set up on this server yet/);
      } else {
        assert.equal(connect.tagName, "BUTTON");
        assert.equal(connect.disabled, true);
        assert.equal(connect.hasAttribute("href"), false);
        assert.match(document.body.textContent, /Figma is not set up on this server yet/);
        assert.doesNotMatch(document.body.textContent, /—/);
      }
    }
    global.fetch = async () => Response.json({ configured: true, connection: { figmaUserId: "figma-user", figmaUserName: "Designer" } });
    await React.act(async () => reactRoot.render(React.createElement(AccountsSection, { key: "connected" })));
    assert.match(document.body.textContent, /Designer/);
    assert.ok([...document.querySelectorAll("button")].some((button) => button.textContent === "Disconnect"));
    assert.ok(![...document.querySelectorAll("a, button")].some((element) => element.textContent === "Connect Figma"));
  } finally {
    await React.act(async () => reactRoot.unmount());
    Object.assign(global, originals);
    dom.window.close();
  }
});
