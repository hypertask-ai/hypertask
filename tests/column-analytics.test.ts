import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

type Column = { id: number; projectId: number; section_title: string; ranking: string; deleted: boolean; visibility: boolean; isDone: boolean | null };

function harness(columns: Column[] = []) {
  const h = activationHarness();
  h.setFlagEnabled("htpr-7271-saved-work-events", true);
  h.setFlagEnabled("htpr-7273-column-events", true);
  h.prisma.project_View = { upsert: async () => ({ default_view_id: 1 }) };
  h.projects.get(15).seeded = false;
  const rows = [...columns];
  h.prisma.section = {
    findUnique: async ({ where }: any) => rows.find((row) => row.id === where.id) ?? null,
    findFirst: async ({ where }: any) => rows.filter((row) => row.projectId === where.projectId && !row.deleted).at(-1) ?? null,
    findMany: async ({ where }: any) => rows.filter((row) => row.projectId === where.projectId && row.deleted === where.deleted),
    create: async ({ data }: any) => {
      const row = { id: 100 + rows.length, projectId: data.project.connect.id, section_title: data.section_title, ranking: data.ranking, deleted: false, visibility: true, isDone: null };
      rows.push(row);
      return row;
    },
  };
  const transaction = h.prisma.$transaction;
  h.prisma.$transaction = (work: any, options: any) => transaction((tx: any) => work({
    ...tx,
    section: { update: async ({ where, data }: any) => Object.assign(rows.find((row) => row.id === where.id)!, data) },
    task: { updateManyAndReturn: async () => [] },
    taskSectionEvent: { createMany: async () => ({}) },
  }), options);
  h.mocks["@/utils/controllers/section/viewHelpers"] = { appendSectionToAllViews: async () => {}, updateSectionInAllViews: async () => {}, removeSectionFromAllViews: async () => {} };
  h.mocks["@/utils/controllers/notifications/agentFirstTaskEmail"] = { scheduleAgentFirstTaskEmailBatch: () => {} };
  h.mocks["@/utils/controllers/projects/getAllIncludes"] = { getProjectWhere: () => ({}), savedViewBoardAccessWhere: () => ({}) };
  h.mocks["@/utils/generateRank"] = { default: () => "A0500" };
  return { h, rows, service: () => h.load("src/utils/controllers/section/sectionService.ts") };
}

const column = (id: number, title: string): Column => ({ id, projectId: 15, section_title: title, ranking: `A0${id}00`, deleted: false, visibility: true, isDone: null });

test("a column a person adds sends one column_created marked user", async () => {
  const { h, service } = harness([column(1, "Todo")]);
  const result = await service().createSection({ projectId: 15, title: "Review", userId: 123 });
  assert.equal(result.status, 200);
  await h.drain();
  assert.equal(h.captures.length, 1);
  const [{ distinctId, event, properties }] = h.captures;
  assert.equal(distinctId, "123");
  assert.equal(event, "column_created");
  assert.equal(properties.column_id, String(result.json.id));
  assert.equal(properties.board_id, "15");
  assert.equal(properties.workspace_id, "team");
  assert.equal(properties.event_id, `column_created:${result.json.id}`);
  assert.equal(properties.creation_method, "user");
  assert.equal(properties.is_seeded, false);
  assert.equal(properties.account_category, "customer");
  assert.equal(properties.creator_type, "human");
  assert.equal(properties.actor_id, "123");
  assert.equal(properties.source, "server");
});

test("a column an agent adds is sent as agent-made", async () => {
  const { h, service } = harness();
  await service().createSection({ projectId: 15, title: "Agent column", userId: 123, agentId: "managed" });
  await h.drain();
  assert.equal(h.captures[0].properties.creator_type, "agent");
  assert.equal(h.captures[0].properties.actor_id, "agent:managed");
});

test("a saved rename sends one column_renamed and repeating it sends nothing more", async () => {
  const { h, service } = harness([column(1, "Todo")]);
  assert.equal((await service().updateSection({ sectionId: 1, section_title: "Backlog", userId: 123 })).status, 200);
  assert.equal((await service().updateSection({ sectionId: 1, section_title: "Backlog", userId: 123 })).status, 200);
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.event), ["column_renamed"]);
  assert.equal(h.captures[0].properties.column_id, "1");
  assert.match(h.captures[0].properties.event_id, /^column_renamed:1:\d+$/);
  assert.equal(h.captures[0].properties.creation_method, undefined);
});

test("moving, hiding or deleting a column sends no rename", async () => {
  const { h, service } = harness([column(1, "Todo")]);
  await service().updateSection({ sectionId: 1, ranking: "A0900", userId: 123 });
  await service().updateSection({ sectionId: 1, visibility: false, userId: 123 });
  await service().updateSection({ sectionId: 1, section_title: "Gone", deleted: true, userId: 123 });
  await h.drain();
  assert.equal(h.captures.length, 0);
});

test("a failed column save sends nothing", async () => {
  const { h, service } = harness();
  h.prisma.section.create = async () => { throw Error("mock write failed"); };
  assert.equal((await service().createSection({ projectId: 15, title: "Review", userId: 123 })).status, 500);
  await h.drain();
  assert.equal(h.captures.length, 0);
});

test("replaying the same column capture sends no duplicate", async () => {
  const { h, rows } = harness();
  rows.push(column(7, "Review"));
  const savedWork = h.load("src/lib/telemetry/savedWork.ts");
  savedWork.recordColumnCreated(7, { userId: 123 });
  savedWork.recordColumnCreated(7, { userId: 123 });
  await h.drain();
  assert.equal(h.captures.length, 1);
});

test("columns made with a new board are sent once each, marked default", async () => {
  const { h, rows } = harness([column(1, "Todo"), column(2, "Doing")]);
  h.load("src/lib/telemetry/savedWork.ts").recordBoardCreated(15, "manual", { userId: 123 });
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.event), ["board_created", "column_created", "column_created"]);
  assert.deepEqual(h.captures.slice(1).map((capture) => [capture.properties.column_id, capture.properties.creation_method, capture.properties.is_seeded]), [["1", "default", false], ["2", "default", false]]);
  assert.equal(rows.length, 2);
});

test("starter and adopted demo board columns are marked seeded", async () => {
  for (const method of ["seeded", "adopted_demo"]) {
    const { h } = harness([column(1, "To Do")]);
    h.load("src/lib/telemetry/savedWork.ts").recordBoardCreated(15, method, { userId: 123 });
    await h.drain();
    const columnEvent = h.captures.find((capture) => capture.event === "column_created")!;
    assert.equal(columnEvent.properties.creation_method, "seeded");
    assert.equal(columnEvent.properties.is_seeded, true);
  }
});

test("a column added later to a seeded board is user-made but flagged seeded", async () => {
  const { h, service } = harness();
  h.projects.get(15).seeded = true;
  await service().createSection({ projectId: 15, title: "Mine", userId: 123 });
  await h.drain();
  assert.equal(h.captures[0].properties.creation_method, "user");
  assert.equal(h.captures[0].properties.is_seeded, true);
});

test("guest boards send no column events", async () => {
  const { h, service } = harness([column(1, "Todo")]);
  h.projects.get(15).owner = h.users.get(50);
  await service().createSection({ projectId: 15, title: "Guest column", userId: 50 });
  h.load("src/lib/telemetry/savedWork.ts").recordBoardCreated(15, "seeded", { userId: 50 });
  await h.drain();
  assert.equal(h.captures.filter((capture) => capture.event.startsWith("column_")).length, 0);
});

test("with the column flag off, no column events are sent and board_created is unchanged", async () => {
  const { h, service } = harness([column(1, "Todo")]);
  h.setFlagEnabled("htpr-7273-column-events", false);
  await service().createSection({ projectId: 15, title: "Review", userId: 123 });
  await service().updateSection({ sectionId: 1, section_title: "Backlog", userId: 123 });
  h.load("src/lib/telemetry/savedWork.ts").recordBoardCreated(15, "manual", { userId: 123 });
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.event), ["board_created"]);
});

test("every column row is created where column analytics can see it", () => {
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
  const sites = files("src")
    .filter((file) => /\.section\.create(Many)?\(|\bsection:\s*\{\s*create/.test(fs.readFileSync(file, "utf8")))
    .sort();
  assert.deepEqual(sites, [
    "src/lib/demo/provisionGuest.ts",
    "src/lib/mcp/boards/createBoardFromManifest.ts",
    "src/utils/controllers/projects/create.ts",
    "src/utils/controllers/section/sectionService.ts",
    "src/utils/controllers/users/completeOnboardingStep.ts",
  ]);
});
