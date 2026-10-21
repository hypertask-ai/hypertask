const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migrationName = "20261021200000_board_github_connections";
const migration = read(`src/prisma/migrations/${migrationName}/migration.sql`);
const schema = read("src/prisma/schema.prisma");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  fsCache: false,
});
const { resolveLegacyBoardGithubRepository } = jiti(
  path.join(root, "src/lib/github/boardConnections.ts"),
);
const { boardForGithubRepository } = jiti(
  path.join(root, "src/lib/pullRequests/githubPullRequests.ts"),
);

function model(name) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing model ${name}`);
  return match[1];
}

function legacySeed(sql) {
  const match = sql.match(/INSERT INTO "BoardGithubRepository"[\s\S]*?;/);
  assert.ok(match, "missing legacy seed");
  return match[0];
}

function seededRepositoryNames(sql) {
  const seed = legacySeed(sql);
  return [...seed.matchAll(/\('(hypertask-ai\/[a-z0-9-]+)'\)/g)].map(
    (match) => match[1],
  );
}

const legacyMappings = seededRepositoryNames(migration).map((fullName) => ({
  projectId: 15,
  fullName,
  provenance: "legacy",
  installationId: null,
  revokedAt: null,
}));
const publicRepository = (fullName) => ({
  fullName,
  isPrivate: false,
  isFork: false,
});

function currentlyRoutedRepositoryNames() {
  const source = read("src/lib/pullRequests/githubPullRequests.ts");
  const match = source.match(
    /const BOARD_15_GITHUB_REPOSITORIES = new Set\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(match, "missing current routing allowlist");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function assertIdempotentLegacySeed(sql) {
  const seed = legacySeed(sql);
  assert.match(
    seed,
    /SELECT 'htpr-7515-legacy-15-' \|\| split_part\(repository\."fullName", '\/', 2\)/,
  );
  assert.match(seed, /FROM "Project" AS project/);
  assert.match(seed, /WHERE project\."id" = 15\s+ON CONFLICT DO NOTHING;/);
  assert.match(
    seed,
    /\("id", "projectId", "fullName", "provenance"\)/,
  );
  assert.match(seed, /'legacy'::"GithubRepositoryProvenance"/);
  assert.doesNotMatch(seed, /\bUPDATE\b|\bDELETE\b|revokedAt|repositoryId|installationId/);
}

test("GitHub installation identity is team-owned, revocable and uses string GitHub IDs", () => {
  const installation = model("GithubInstallation");
  assert.match(installation, /id\s+String\s+@id @db\.VarChar\(32\)/);
  assert.match(installation, /accountId\s+String\s+@db\.VarChar\(32\)/);
  assert.match(installation, /accountLogin\s+String\s+@db\.VarChar\(100\)/);
  assert.match(installation, /accountType\s+String\s+@db\.VarChar\(32\)/);
  assert.match(installation, /teamId\s+String/);
  assert.match(installation, /team\s+Team\s+@relation\(fields: \[teamId\], references: \[id\], onDelete: Restrict\)/);
  assert.match(installation, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(installation, /revokedAt\s+DateTime\?/);
  assert.match(model("Team"), /githubInstallations\s+GithubInstallation\[\]/);
  assert.match(migration, /"GithubInstallation_id_check" CHECK \("id" ~ '\^\[1-9\]\[0-9\]\*\$'\)/);
  assert.match(migration, /"GithubInstallation_accountId_check" CHECK/);
  assert.match(migration, /FOREIGN KEY \("teamId"\) REFERENCES "Team"\("id"\) ON DELETE RESTRICT/);
});

test("repository mappings retain nullable legacy identity and require stable installed identity", () => {
  const repository = model("BoardGithubRepository");
  assert.match(schema, /enum GithubRepositoryProvenance \{\s+legacy\s+installed\s+\}/);
  assert.match(repository, /id\s+String\s+@id @default\(uuid\(\)\)/);
  assert.match(migration, /"BoardGithubRepository_pkey" PRIMARY KEY \("id"\)/);
  assert.match(repository, /projectId\s+Int/);
  assert.match(repository, /repositoryId\s+String\?\s+@db\.VarChar\(32\)/);
  assert.match(repository, /fullName\s+String\s+@db\.VarChar\(201\)/);
  assert.match(repository, /installationId\s+String\?\s+@db\.VarChar\(32\)/);
  assert.match(repository, /provenance\s+GithubRepositoryProvenance/);
  assert.match(repository, /activatedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(repository, /revokedAt\s+DateTime\?/);
  assert.match(model("Project"), /githubRepositories\s+BoardGithubRepository\[\]/);
  assert.match(migration, /CHECK \("provenance" <> 'installed' OR \("repositoryId" IS NOT NULL AND "installationId" IS NOT NULL\)\)/);
  assert.match(migration, /CHECK \("provenance" <> 'legacy' OR "projectId" = 15\)/);
  assert.match(migration, /"fullName" = lower\("fullName"\)/);
  assert.match(migration, /FOREIGN KEY \("projectId"\) REFERENCES "Project"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /FOREIGN KEY \("installationId"\) REFERENCES "GithubInstallation"\("id"\) ON DELETE RESTRICT/);
});

test("only one active board can reserve either a stable repository ID or a legacy name", () => {
  assert.match(migration, /CREATE UNIQUE INDEX "BoardGithubRepository_active_repositoryId_key" ON "BoardGithubRepository"\("repositoryId"\) WHERE "revokedAt" IS NULL AND "repositoryId" IS NOT NULL;/);
  assert.match(migration, /CREATE UNIQUE INDEX "BoardGithubRepository_active_fullName_key" ON "BoardGithubRepository"\("fullName"\) WHERE "revokedAt" IS NULL;/);
  assert.doesNotMatch(model("BoardGithubRepository"), /@@unique|@unique/);
});

test("installed PR link origin is durable while existing rows keep a null origin", () => {
  assert.match(schema, /enum GithubPullRequestLinkOrigin \{\s+installed\s+\}/);
  assert.match(model("TaskPullRequest"), /githubLinkOrigin\s+GithubPullRequestLinkOrigin\?\s*\n/);
  assert.match(migration, /ALTER TABLE "TaskPullRequest" ADD COLUMN "githubLinkOrigin" "GithubPullRequestLinkOrigin";/);
  assert.doesNotMatch(migration, /UPDATE "TaskPullRequest"|ALTER COLUMN|DROP\b|RENAME\b/);
});

test("webhook receipts deduplicate delivery IDs and business events across senders", () => {
  const receipt = model("GithubWebhookDelivery");
  assert.match(receipt, /deliveryId\s+String\s+@id @db\.VarChar\(100\)/);
  assert.match(receipt, /businessEventKey\s+String\s+@unique @db\.VarChar\(255\)/);
  assert.match(receipt, /receivedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(receipt, /processedAt\s+DateTime\?/);
  assert.match(migration, /"GithubWebhookDelivery_pkey" PRIMARY KEY \("deliveryId"\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "GithubWebhookDelivery_businessEventKey_key" ON "GithubWebhookDelivery"\("businessEventKey"\);/);
});

test("migration follows the production baseline and only adds storage plus the legacy seed", () => {
  assert.ok(migrationName > "20261021191314_drop_htpr_6909_search_one_board_tabs_flag");
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.deepEqual(
    [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((entry) => entry[1]).sort(),
    ["BoardGithubRepository", "GithubInstallation", "GithubWebhookDelivery"],
  );
  assert.equal([...migration.matchAll(/INSERT INTO/g)].length, 1);
  assert.doesNotMatch(migration, /\b(?:DROP|RENAME|DELETE|UPDATE|TRUNCATE)\b(?! CASCADE| RESTRICT)/);
  for (const name of ["GithubInstallation", "BoardGithubRepository", "GithubWebhookDelivery"]) {
    const body = model(name);
    assert.doesNotMatch(body, /token|secret|privateKey/i);
  }
});

test("board 15 seed is retry-safe, skips a missing board and never resurrects revoked rows", () => {
  assertIdempotentLegacySeed(migration);
  assert.throws(() => assertIdempotentLegacySeed(migration.replace("ON CONFLICT DO NOTHING", "ON CONFLICT DO UPDATE SET \"revokedAt\" = NULL")));
  assert.throws(() => assertIdempotentLegacySeed(migration.replace("'htpr-7515-legacy-15-' || split_part(repository.\"fullName\", '/', 2)", "gen_random_uuid()::text")));
  assert.throws(() => assertIdempotentLegacySeed(migration.replace('WHERE project."id" = 15', 'WHERE project."id" > 0')));
  assert.throws(() => legacySeed(""));
});

test("legacy resolver still allows exactly every currently routed repo on board 15", () => {
  const currentNames = currentlyRoutedRepositoryNames();
  assert.ok(currentNames.length > 0);
  assert.deepEqual(seededRepositoryNames(migration).sort(), currentNames.sort());
  assert.equal(new Set(legacyMappings.map((mapping) => mapping.fullName)).size, currentNames.length);
  for (const fullName of currentNames) {
    for (const variant of [fullName, fullName.toUpperCase()]) {
      const repository = publicRepository(variant);
      const mapping = resolveLegacyBoardGithubRepository(repository, legacyMappings);
      assert.ok(mapping, variant);
      assert.equal(mapping.projectId, boardForGithubRepository(repository), variant);
      assert.equal(mapping.fullName, fullName);
    }
  }
});

test("legacy resolver now refuses unknown repositories beside the known-allowed parity control", () => {
  for (const fullName of ["unknown-owner/hypertask", "hypertask-ai/unknown", "hypertask-ai/hypertask/extra", "", " hypertask-ai/cli"]) {
    const repository = publicRepository(fullName);
    assert.equal(boardForGithubRepository(repository), null, fullName);
    assert.equal(resolveLegacyBoardGithubRepository(repository, legacyMappings), null, fullName);
  }
  assert.equal(resolveLegacyBoardGithubRepository(publicRepository(legacyMappings[0].fullName), []), null);
});

test("legacy resolver preserves the public, non-fork boundary and rejects missing metadata", () => {
  const repository = publicRepository(legacyMappings[0].fullName);
  for (const input of [
    { ...repository, isPrivate: true },
    { ...repository, isFork: true },
    { ...repository, isPrivate: undefined },
    { ...repository, isFork: undefined },
    { ...repository, isPrivate: "false" },
    { ...repository, fullName: undefined },
    { ...repository, fullName: 15 },
    {},
  ]) {
    assert.equal(resolveLegacyBoardGithubRepository(input, legacyMappings), null);
    assert.equal(boardForGithubRepository(input), null);
  }
});

test("legacy resolver refuses revoked, installed, foreign-board and ambiguous mappings without mutation", () => {
  const mapping = legacyMappings[0];
  const repository = publicRepository(mapping.fullName);
  const original = structuredClone(legacyMappings);
  for (const change of [
    { revokedAt: new Date("2026-10-21T00:00:00Z") },
    { provenance: "installed", installationId: "123" },
    { installationId: "123" },
    { projectId: 16 },
  ]) {
    assert.equal(resolveLegacyBoardGithubRepository(repository, [{ ...mapping, ...change }]), null);
  }
  assert.equal(resolveLegacyBoardGithubRepository(repository, [mapping, { ...mapping, projectId: 16 }]), null);
  assert.equal(resolveLegacyBoardGithubRepository(repository, [mapping, { ...mapping, revokedAt: new Date() }]), mapping);
  assert.deepEqual(legacyMappings, original);
});
