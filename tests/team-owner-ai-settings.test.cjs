const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const ownerGateSource = read(
  "src/utils/controllers/teams/assertTeamByokAccess.ts",
);
const providerRouteSource = read("src/pages/api/teams/aiProviderSettings.ts");
const featureModelsRouteSource = read("src/pages/api/teams/aiFeatureModels.ts");
const settingsViewerSource = read(
  "src/utils/controllers/teams/getTeamAiSettingsForViewer.ts",
);
const atomicSettingsSource = read(
  "src/utils/controllers/teams/updateTeamAiSettingsAtomically.ts",
);
const byokRouteSource = read("src/pages/api/teams/byokKeys.ts");
const byokTestRouteSource = read("src/app/api/settings/byok-test/route.ts");
const aiModelsSectionSource = read(
  "src/components/Modals/Settings/AiModelsSection.tsx",
);
const apiKeysSectionSource = read(
  "src/components/Modals/Settings/ApiKeysSection.tsx",
);

test("team AI settings derive ownership from the team Google account", () => {
  assert.match(ownerGateSource, /team\.googleAccount\.userId === userId/);
  assert.match(ownerGateSource, /accountId === team\.googleAccountId/);
  assert.match(ownerGateSource, /status: 403/);
});

test("all team AI settings mutations and key tests use the owner gate", () => {
  const providerPostSource = providerRouteSource.split(
    'if (req.method === "POST")',
  )[1];
  const byokPostSource = byokRouteSource.split('if (req.method === "POST")')[1];

  assert.match(providerPostSource, /assertUserCanManageTeamByok/);
  assert.match(byokPostSource, /assertUserCanManageTeamByok/);
  assert.match(byokTestRouteSource, /assertUserCanManageTeamByok/);
});

test("GDPR safe mode is enforced across provider and BYOK mutations", () => {
  assert.match(providerRouteSource, /gdprSafeMode/);
  assert.match(
    providerRouteSource,
    /getAiProviderInfo\(provider\)\?\.chinaHosted/,
  );
  assert.match(byokRouteSource, /isByokProviderRestrictedInGdprSafeMode/);
  assert.match(byokRouteSource, /isGdprSafeModeEnabled/);
  assert.match(byokTestRouteSource, /isGdprSafeModeEnabled/);
  assert.match(byokRouteSource, /withLockedTeamAiSettings/);
  assert.match(byokTestRouteSource, /setGdprProviderTestLease/);
  assert.match(byokTestRouteSource, /isByokProviderRestrictedInGdprSafeMode/);
  assert.match(byokTestRouteSource, /clearGdprProviderTestLease/);
  assert.match(providerRouteSource, /getActiveGdprProviderTestLease/);
  assert.match(featureModelsRouteSource, /resolveTeamCustomEndpoint/);
  assert.match(featureModelsRouteSource, /customEndpointConfigured/);
  assert.match(featureModelsRouteSource, /getAiModelOptionById/);
  assert.match(
    featureModelsRouteSource,
    /Configure an available custom endpoint before selecting it/,
  );
  assert.match(byokRouteSource, /visibleProviders/);
  assert.match(byokRouteSource, /config\.gdprCompliant/);
  assert.match(byokTestRouteSource, /customEndpointGdprCompliant/);
  assert.match(byokTestRouteSource, /requiresGdprLease/);
  assert.match(
    byokRouteSource,
    /const snapshot = await withLockedTeamAiSettings/,
  );
  assert.match(aiModelsSectionSource, /settings-gdpr-safe-mode/);
  assert.match(apiKeysSectionSource, /!gdprSafeMode \|\| !isByokProviderRestrictedInGdprSafeMode\(row\.source\)/);
  assert.match(
    apiKeysSectionSource,
    /Custom endpoint operates under an EU\/US data agreement/,
  );
});

test("all JSON settings mutations serialize on the team row", () => {
  assert.match(atomicSettingsSource, /FOR UPDATE/);
  assert.match(atomicSettingsSource, /prisma\.\$transaction/);
  assert.match(providerRouteSource, /updateTeamAiSettingsAtomically/);
  assert.match(featureModelsRouteSource, /updateTeamAiSettingsAtomically/);
  assert.doesNotMatch(providerRouteSource, /prisma\.team\.update/);
  assert.doesNotMatch(featureModelsRouteSource, /prisma\.team\.update/);
});

test("team AI settings reads authorize before fetching providers", () => {
  assert.match(settingsViewerSource, /prisma\.team\.findFirst/);
  assert.match(settingsViewerSource, /googleAccount: \{ is: \{ userId \} \}/);
  assert.match(
    settingsViewerSource,
    /members: \{ some: \{ userId, status: "Accepted" \} \}/,
  );
  assert.match(providerRouteSource, /getTeamAiSettingsForViewer/);
  assert.match(featureModelsRouteSource, /getTeamAiSettingsForViewer/);
  assert.doesNotMatch(providerRouteSource, /team\.members\.length/);
  assert.doesNotMatch(featureModelsRouteSource, /team\.members\.length/);
});

test("accepted team members can read only masked BYOK state", () => {
  const byokGetSource = byokRouteSource.split('if (req.method === "POST")')[0];

  assert.match(
    byokGetSource,
    /where: \{ userId: user\.id, status: "Accepted" \}/,
  );
  assert.match(byokGetSource, /maskedKey = maskByokSecret/);
  assert.doesNotMatch(byokGetSource, /apiKey\s*[:,]/);
});

test("non-owners see read-only provider and API-key controls", () => {
  for (const source of [aiModelsSectionSource, apiKeysSectionSource]) {
    assert.match(source, /Only the team owner can change this\./);
    assert.match(source, /ownerAndMembers\.owner\?\.id === currentUser\.id/);
  }

  assert.match(aiModelsSectionSource, /disabled=\{!canManage \|\|/);
  assert.match(apiKeysSectionSource, /disabled=\{!canManage\}/);
  assert.match(
    apiKeysSectionSource,
    /disabled=\{!canManage \|\| clearingKey\[row\.source\]\}/,
  );
  assert.match(
    apiKeysSectionSource,
    /disabled=\{\s*!canManage \|\|\s*testState/,
  );
});

test("viewer receives enabled providers only after authorization", async () => {
  const { loadModule } = require("./helpers/loadModule.cjs");
  const calls = [];
  let authorized = true;
  let exists = true;
  const prisma = {
    team: {
      findFirst: async (args) => {
        calls.push(["team", args]);
        return authorized ? { aiProviderSettings: { example: true }, aiKeyOnly: true, googleAccount: { userId: 42 } } : null;
      },
      findUnique: async () => exists ? { id: "team" } : null,
    },
    teamByokApiKey: { findMany: async (args) => { calls.push(["keys", args]); return [{ provider: "claude" }]; } },
  };
  const { getTeamAiSettingsForViewer } = loadModule("src/utils/controllers/teams/getTeamAiSettingsForViewer.ts", { "@/lib/prisma": { default: prisma } });
  assert.deepEqual(await getTeamAiSettingsForViewer(7, undefined, "team"), {
    ok: true, settings: { example: true }, aiKeyOnly: true, ownerUserId: 42, savedByokProviders: ["claude"],
  });
  assert.deepEqual(calls[0][1].select, { aiProviderSettings: true, aiKeyOnly: true, googleAccount: { select: { userId: true } } });
  assert.deepEqual(calls[1], ["keys", { where: { teamId: "team", enabled: true }, select: { provider: true } }]);
  authorized = false;
  calls.length = 0;
  assert.deepEqual(await getTeamAiSettingsForViewer(7, undefined, "team"), { ok: false, status: 403, message: "Forbidden" });
  exists = false;
  assert.deepEqual(await getTeamAiSettingsForViewer(7, undefined, "team"), { ok: false, status: 404, message: "Team not found" });
  assert.deepEqual(calls.map(([kind]) => kind), ["team", "team"]);
});
