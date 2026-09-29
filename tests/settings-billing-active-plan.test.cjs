const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const stubs = new Map();

function stubModule(filename, exports) {
  stubs.set(filename, require.cache[filename]);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

test("billing shows the active BYOK plan when an older row comes first", () => {
  const byokPriceId = "price_test_byok";
  const previousByokPriceId =
    process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_BYOK;
  process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_BYOK = byokPriceId;
  const jiti = createJiti(__filename, {
    interopDefault: true,
    jsx: true,
    alias: { "@": path.join(root, "src") },
  });
  const { deriveTeamBilling } = jiti(
    path.join(root, "src/lib/deriveCurrentBoardBilling.ts"),
  );
  const team = {
    activeSubscriptionPlanId: "sub_byok",
    id: "team-byok",
    subscriptionPlan: [
      {
        priceId: "price_stale",
        subscriptionId: "sub_stale",
        subscriptionStatus: "canceled",
      },
      {
        priceId: byokPriceId,
        subscriptionId: "sub_byok",
        subscriptionStatus: "active",
      },
    ],
    totalSeats: 1,
  };

  stubModule(require.resolve("next/navigation"), {
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
  });
  stubModule(path.join(root, "src/components/Modals/Settings/SettingsCard.tsx"), {
    default: ({ children }) => React.createElement("div", null, children),
  });
  stubModule(
    path.join(root, "src/components/Modals/Settings/SettingsBillingRow.tsx"),
    {
      BillingActionRow: ({ action, label }) =>
        React.createElement("div", null, label, action),
      BillingRow: ({ label, value }) =>
        React.createElement(
          "div",
          null,
          React.createElement("span", null, label),
          React.createElement("span", null, value),
        ),
      settingsActionButtonClass: "",
    },
  );
  stubModule(
    path.join(root, "src/components/Modals/Settings/SettingsSectionShell.tsx"),
    {
      default: ({ children }) => React.createElement("section", null, children),
    },
  );
  stubModule(
    path.join(root, "src/components/Modals/Settings/useSettingsTeam.ts"),
    {
      useSettingsTeam: () => ({
        billing: deriveTeamBilling(team),
        ownerAndMembers: { members: [], owner: null },
        project: null,
        refetchTeam: async () => null,
        team,
      }),
    },
  );

  const previousReact = global.React;
  global.React = React;
  try {
    const BillingSection = jiti(
      path.join(
        root,
        "src/components/Modals/Settings/BillingSection.tsx",
      ),
    ).default;

    const html = renderToStaticMarkup(React.createElement(BillingSection));
    assert.match(html, /<span>Plan<\/span><span>BYOK<\/span>/);
    assert.match(
      html,
      /<span>Billing cycle<\/span><span>month<\/span>/,
    );
  } finally {
    for (const [filename, previous] of stubs) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
    if (previousByokPriceId === undefined) {
      delete process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_BYOK;
    } else {
      process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_BYOK =
        previousByokPriceId;
    }
  }
});
