const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
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
  const unusedImports = [
    "@/styles/globals.scss", "@/styles/tailwindThemes/rounded.css", "../../tokens.css",
    "@/utils/Providers", "@/hooks/useFlag", "@/components/Analytics/PostHogAnalytics",
    "@vercel/speed-insights/next", "@/components/ErrorBoundary/ClientErrorReporter",
    "@/lib/ai/AiChipEventRecorder", "@/components/System/DeploySkewGuard",
    "@/components/FilesImageFallback", "@/lib/configs/auth.config", "@/lib/configs/general.config",
    "@/lib/fonts/inter", "@/lib/fonts/newsreader", "@/lib/fonts/ibmPlexSans",
    "@/lib/themePreferences", "@/lib/themeBootScript", "@/lib/appShellBootstrap/client",
    "@/lib/firstScreen/serverBoardDocument", "@/lib/firstScreen/serverInboxDocument",
    "@/lib/firstScreen/serverTicketShell", "@/lib/ticketSidebarBoot",
  ];
  return loadModule("src/app/layout.tsx", {
    ...Object.fromEntries(unusedImports.map(name => [name, {}])),
    ...dependencies,
  }).generateViewport();
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
      assert.match(row.getAttribute("style"), new RegExp(`(?:^|;)touch-action:${enabled ? "pan-y pinch-zoom" : "pan-y"}(?:;|$)`));
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
