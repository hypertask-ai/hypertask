const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createJiti } = require("jiti");

global.React = React;
const root = path.resolve(__dirname, "..");
let viewport = {
  bottomInset: 0,
  layoutHeight: 800,
  visibleHeight: 800,
};

const viewportHookPath = path.join(
  root,
  "src/hooks/General/useMobileVisualViewport.ts",
);
require.cache[viewportHookPath] = {
  id: viewportHookPath,
  filename: viewportHookPath,
  loaded: true,
  exports: { useMobileVisualViewport: () => viewport },
};

const appSheetPath = path.join(
  root,
  "src/components/Modals/Sheets/AppSheet.tsx",
);
const Passthrough = ({ children }) => React.createElement("div", null, children);
require.cache[appSheetPath] = {
  id: appSheetPath,
  filename: appSheetPath,
  loaded: true,
  exports: { AppSheet: Passthrough, SheetScroller: Passthrough },
};

const jiti = createJiti(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});
const { MobileBottomSheet } = jiti(
  path.join(root, "src/components/Modals/Sheets/MobileBottomSheet.tsx"),
);

const renderSheet = (bottomSafeAreaFloor) =>
  renderToStaticMarkup(
    React.createElement(
      MobileBottomSheet,
      {
        bottomSafeAreaFloor,
        bottomSlot: React.createElement("span", null, "selector"),
        fullHeight: true,
        isOpen: true,
        keyboardAware: true,
        onClose: () => {},
      },
      React.createElement("span", null, "options"),
    ),
  );

test("the flagged reminder sheet clears Android bottom controls", () => {
  assert.match(
    renderSheet(true),
    /padding-bottom:max\(0\.75rem, env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(renderSheet(false), /padding-bottom:0/);
});

test("an open keyboard removes the extra bottom clearance", () => {
  viewport = {
    bottomInset: 280,
    layoutHeight: 800,
    visibleHeight: 420,
  };
  assert.match(renderSheet(true), /padding-bottom:0/);
});

test("the reminder selector alone opts into the ticket flag", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/Modals/RemindMe/RemindMeComponent.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /useFlag\("htpr-6130-mobile-reminder-safe-area"\)/,
  );
  assert.match(source, /bottomSafeAreaFloor=\{mobileSafeAreaEnabled\}/);
});
