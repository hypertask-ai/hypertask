const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname, '../src/prisma/migrations/20261111070000_htpr_8973_personal_table_settings/migration.sql'), 'utf8');
const image = process.env.HTPR_PG_IMAGE || 'ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';

const stack = [{ column: 'priority', direction: 'desc' }, { column: 'updated', direction: 'desc' }];
const columns = { keys: ['ticket', 'title', 'updated'], widths: { title: 420, updated: 173 } };

test('upgrade preserves legacy account/view preferences after deleting drafts', { timeout: 120_000 }, (t) => {
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (docker.status !== 0 && process.env.HT_REQUIRE_PG_TESTS === '1') assert.fail('Docker is required for table preference migration proof');
  if (docker.status !== 0) return t.skip('Docker is unavailable');
  const backfill = migration.slice(migration.indexOf('INSERT INTO'));
  const snapshot = `SELECT jsonb_agg(to_jsonb(p) ORDER BY p."userId") FROM "View_Last_Used" p`;
  const result = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--user', 'postgres', image,
    'sh', '-c', 'initdb -D /tmp/table-settings-pg -A trust >/tmp/init.log && pg_ctl -D /tmp/table-settings-pg -w -l /tmp/pg.log start >/tmp/start.log && psql -U postgres -v ON_ERROR_STOP=1 -Atq'], {
    encoding: 'utf8', timeout: 110_000, maxBuffer: 4 * 1024 * 1024,
    input: `
      CREATE TABLE "Project_View" (id text PRIMARY KEY, default_view_id text);
      CREATE TABLE "View" (id text PRIMARY KEY, "userId" int, project_view_id text,
        table_sort_stack jsonb, table_sort_column text, table_sort_direction text, table_columns jsonb);
      CREATE TABLE "User_Project_View" ("userId" int, project_view_id text,
        "appliedViewId" text, "unsavedViewId" text REFERENCES "View"(id) ON DELETE SET NULL);
      CREATE TABLE "View_Last_Used" (id text PRIMARY KEY, "createdAt" timestamp DEFAULT now(),
        "lastUsedAt" timestamp, board_empty_sections text, "userId" int, "viewId" text,
        UNIQUE ("userId", "viewId"));
      INSERT INTO "Project_View" VALUES ('board', 'default');
      INSERT INTO "View" (id, "userId", project_view_id) VALUES
        ('default', 99, 'board'), ('saved', 99, 'board'), ('other', 99, 'elsewhere');
      INSERT INTO "View" (id, "userId", project_view_id, table_sort_stack, table_columns)
        SELECT 'draft-' || i, i, 'board', '${JSON.stringify(stack)}', '${JSON.stringify(columns)}'
        FROM generate_series(1, 10) i;
      UPDATE "View" SET table_sort_stack = NULL, table_sort_column = 'due', table_sort_direction = 'asc' WHERE id = 'draft-4';
      UPDATE "View" SET table_sort_stack = '[]', table_columns = NULL WHERE id = 'draft-5';
      UPDATE "View" SET table_sort_stack = NULL, table_columns = NULL WHERE id = 'draft-6';
      UPDATE "View" SET "userId" = 99 WHERE id = 'draft-8';
      UPDATE "View" SET table_sort_stack = 'null', table_columns = NULL WHERE id = 'draft-9';
      UPDATE "View" SET table_sort_stack = NULL WHERE id = 'draft-10';
      INSERT INTO "User_Project_View"
        SELECT i, 'board', CASE WHEN i = 2 THEN NULL WHEN i = 7 THEN 'other' ELSE 'saved' END, 'draft-' || i
        FROM generate_series(1, 10) i;
      INSERT INTO "View_Last_Used" VALUES ('existing', '2026-10-01', '2026-11-01', 'Hide', 1, 'saved');
      ${migration}
      ${snapshot};
      UPDATE "View_Last_Used" SET table_sort_stack = '[]', table_columns = '{"keys":["title"],"widths":{}}' WHERE "userId" = 1;
      ${backfill}
      DELETE FROM "View" WHERE id LIKE 'draft-%';
      ${snapshot};
      SELECT count(*) FROM "User_Project_View" WHERE "unsavedViewId" IS NOT NULL;
    `,
  });
  assert.equal(result.status, 0, [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n'));
  const [before, after, drafts] = result.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(before.map(row => [row.userId, row.viewId]), [[1, 'saved'], [2, 'default'], [3, 'saved'], [4, 'saved'], [5, 'saved'], [9, 'saved'], [10, 'saved']]);
  for (const row of before.slice(0, 3)) {
    assert.deepEqual([row.table_sort_stack, row.table_columns], [stack, columns]);
  }
  assert.deepEqual(['id', 'createdAt', 'lastUsedAt', 'board_empty_sections'].map(key => before[0][key]), ['existing', '2026-10-01T00:00:00', '2026-11-01T00:00:00', 'Hide']);
  assert.deepEqual([before[3].table_sort_stack, before[3].table_columns], [[{ column: 'due', direction: 'asc' }], columns]);
  assert.deepEqual([before[4].table_sort_stack, before[4].table_columns], [[], null]);
  assert.deepEqual([after[0].table_sort_stack, after[0].table_columns], [[], { keys: ['title'], widths: {} }]);
  assert.deepEqual(after.slice(1), before.slice(1));
  const { getActiveTableSortStackFromProject } = require('./helpers/htpr-7166-fixture.cjs').fixture().load('src/utils/helperFunctions/Views/ViewsHelperFunctions.ts');
  const project = row => ({ project_view: { default_view: { table_sort_stack: stack, ViewLastUsed: [row] } } });
  assert.deepEqual(getActiveTableSortStackFromProject(project(after[5])), []);
  assert.deepEqual(getActiveTableSortStackFromProject(project(after[6])), stack);
  assert.equal(drafts, 0);
});
