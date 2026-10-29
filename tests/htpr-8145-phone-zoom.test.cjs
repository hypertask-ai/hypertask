const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const key = "htpr-8145-phone-zoom";

function viewport({ mobile, enabled, userId = 985 }) {
  const dependencies = {
    "@/utils/serverActions": { isMobileDevice: async () => ({ isMobile: mobile }) },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "test-session" }) }) },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => userId === null ? null : { id: userId } },
    "@/lib/flags": { isFeatureEnabled: async (flag, id) => {
      assert.equal(flag, key);
      assert.equal(id, userId ?? -1);
      return enabled;
    } },
    "@/lib/flags/definitions/htpr-8145-phone-zoom": { HTPR_8145_PHONE_ZOOM_FLAG: key },
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, "../src/app/layout.tsx"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => dependencies[name] ?? {} });
  return exports.generateViewport();
}

for (const userId of [985, null]) {
  test(`phone viewport permits fivefold zoom, user ${userId ?? "guest"}`, async () => {
    const result = await viewport({ mobile: true, enabled: true, userId });
    assert.equal(result.maximumScale, 5);
    assert.equal(result.userScalable, true);
    assert.equal(result.initialScale, 1);
    assert.equal(result.minimumScale, 1);
    assert.equal(result.viewportFit, "cover");
    assert.equal(result.interactiveWidget, "resizes-content");
  });
}

test("phone flag Off restores the old viewport", async () => {
  const result = await viewport({ mobile: true, enabled: false });
  assert.equal(result.maximumScale, 1);
  assert.equal(result.userScalable, false);
});

for (const enabled of [false, true]) {
  test(`desktop scale stays unchanged, flag ${enabled}`, async () => {
    const result = await viewport({ mobile: false, enabled });
    assert.equal(result.maximumScale, 1.2);
    assert.equal(result.minimumScale, 0.5);
    assert.equal(result.userScalable, true);
  });
}

for (const file of [
  "src/components/notifications/inboxSplit/SwipeableNotificationRow.tsx",
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/SwipeableCommentRow.tsx",
]) {
  test(`${path.basename(file)} preserves pan and permits pinch only with the flag`, () => {
    for (const enabled of [false, true]) {
      const Row = loadModule(file, {
        "@/hooks/useFlag": { useFlag: flag => { assert.equal(flag, key); return enabled; } },
      }).default;
      const html = renderToStaticMarkup(React.createElement(Row, { onArchive() {}, onSnooze() {}, onMore() {} }, "Existing row"));
      const row = new JSDOM(html).window.document.body.firstElementChild;
      assert.equal(row.getAttribute("style").includes(`touch-action:${enabled ? "pan-y pinch-zoom" : "pan-y"};`), true);
      assert.equal(row.textContent, "Existing row");
    }
  });
}

test("phone zoom bug fix defaults to Everyone", () => {
  const flag = loadModule("src/lib/flags/definitions/htpr-8145-phone-zoom.ts").default;
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});
