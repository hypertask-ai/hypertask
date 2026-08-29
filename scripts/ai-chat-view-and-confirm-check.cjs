// HTPR-4218: behaviour check for the two write-path changes, graded against the DB.
//   1. hypertask_create_view -- the chat can now create a saved view.
//   2. wide writes are previewed, not executed, until the user confirms in a new turn.
// Usage: COOKIES=/path/to/cookies.txt node scripts/ai-chat-view-and-confirm-check.cjs
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const fs = require("fs");

const PID = 2038, UID = 977;
const MODEL = process.env.MODEL || "gpt-5.6-luna";
const BASE = process.env.BASE || "http://localhost:3123";

const cookieHeader = fs
  .readFileSync(process.env.COOKIES, "utf8")
  .split("\n")
  .map((line) => line.replace(/^#HttpOnly_/, ""))
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("\t"))
  .filter((parts) => parts.length >= 7)
  .map((parts) => `${parts[5]}=${parts[6]}`)
  .join("; ");

const db = new Client({ connectionString: process.env.DATABASE_URL });
const q = (sql, params = []) => db.query(sql, params).then((r) => r.rows);

async function chat(message, chat_history = []) {
  const res = await fetch(`${BASE}/api/ai/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({
      message,
      model: MODEL,
      chat_history,
      default_context: { project_id: PID },
    }),
    signal: AbortSignal.timeout(300000),
  });
  const raw = await res.text();
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => {
      try {
        return JSON.parse(line.slice(5)).content ?? "";
      } catch {
        return "";
      }
    })
    .join("");
}

const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  await db.connect();
  const results = [];

  // ---------- fixture: 5 tasks tagged ConfirmMe, plus a label for the view ----------
  await q(
    `DELETE FROM "TaskLabel" WHERE "labelId" IN (SELECT id FROM "Label" WHERE "projectId"=$1 AND value IN ('ConfirmMe','ViewTag'))`,
    [PID]
  );
  await q(`DELETE FROM "Label" WHERE "projectId"=$1 AND value IN ('ConfirmMe','ViewTag')`, [PID]);
  for (const value of ["ConfirmMe", "ViewTag"]) {
    await q(
      `INSERT INTO "Label" (id,"createdAt",value,"projectId") VALUES (gen_random_uuid(),now(),$1,$2)`,
      [value, PID]
    );
  }
  const labels = Object.fromEntries(
    (await q(`SELECT id,value FROM "Label" WHERE "projectId"=$1`, [PID])).map((r) => [r.value, r.id])
  );

  const taskIds = [];
  for (let i = 0; i < 5; i++) {
    const [{ next }] = await q(
      `SELECT COALESCE(MAX("uniqueIndex"),0)+1 AS next FROM "Task" WHERE "projectId"=$1`,
      [PID]
    );
    const [task] = await q(
      `INSERT INTO "Task" (title,description,"projectId",section,"userId","createdAt","updatedAt",status,"uniqueIndex")
       VALUES ($1,'<p>x</p>',$2,'Todo',$3,now(),now(),'Normal',$4) RETURNING id`,
      [`Confirm target ${i}`, PID, UID, next]
    );
    await q(`INSERT INTO "TaskLabel" ("taskId","labelId") VALUES ($1,$2)`, [task.id, labels.ConfirmMe]);
    taskIds.push(task.id);
  }
  const stillTagged = async () =>
    (
      await q(
        `SELECT COUNT(*)::int AS n FROM "TaskLabel" WHERE "labelId"=$1 AND "taskId" = ANY($2)`,
        [labels.ConfirmMe, taskIds]
      )
    )[0].n;

  // ---------- 1. create view ----------
  const viewTitle = `Eval View ${Date.now()}`;
  await q(`DELETE FROM "View" WHERE title LIKE 'Eval View %'`);
  const reply1 = await chat(
    `Create a private view on this board called "${viewTitle}" that only shows tasks tagged ViewTag.`
  );
  const [view] = await q(
    `SELECT v.id, v.title, v.visibility, v.slug, v.board_filters
       FROM "View" v JOIN "Project_View" pv ON pv.id = v.project_view_id
      WHERE pv."projectId"=$1 AND v.title=$2`,
    [PID, viewTitle]
  );
  const filterIds = view?.board_filters?.addedFilters?.[0]?.searchPayload?.map((x) => x.id) ?? [];
  results.push({
    name: "create view (exists, private, filtered on the right label)",
    pass:
      Boolean(view) &&
      view.visibility === "Private" &&
      filterIds.includes(labels.ViewTag),
    detail: view
      ? `visibility=${view.visibility} slug=${view.slug} filterMatch=${filterIds.includes(labels.ViewTag)}`
      : "no view row created",
    reply: plain(reply1).slice(0, 160),
  });

  // ---------- 2. wide write must be previewed, not executed ----------
  const ask = `Remove the ConfirmMe tag from every task on this board that has it.`;
  const reply2 = await chat(ask);
  const afterAsk = await stillTagged();
  const asksForConfirmation = /confirm|proceed|shall i|want me to|go ahead|should i/i.test(reply2);
  results.push({
    name: "wide write is NOT executed on first ask",
    pass: afterAsk === 5 && asksForConfirmation,
    detail: `${afterAsk}/5 still tagged (want 5), reply asks for confirmation: ${asksForConfirmation}`,
    reply: plain(reply2).slice(0, 200),
  });

  // ---------- 3. ... and IS executed once the user confirms in a new turn ----------
  const reply3 = await chat("Yes, go ahead.", [
    { role: "human", content: ask },
    { role: "assistant", content: reply2 },
  ]);
  const afterConfirm = await stillTagged();
  results.push({
    name: "wide write executes after the user confirms",
    pass: afterConfirm === 0,
    detail: `${afterConfirm}/5 still tagged (want 0)`,
    reply: plain(reply3).slice(0, 200),
  });

  // ---------- cleanup ----------
  await q(`DELETE FROM "TaskLabel" WHERE "taskId" = ANY($1)`, [taskIds]);
  await q(`UPDATE "Task" SET status='Deleted' WHERE id = ANY($1)`, [taskIds]);
  await q(`DELETE FROM "Label" WHERE "projectId"=$1 AND value IN ('ConfirmMe','ViewTag')`, [PID]);

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}\n      ${r.detail}\n      reply: ${r.reply}\n`);
  }
  console.log(`${results.length - failed}/${results.length} passed  (model: ${MODEL})`);
  await db.end();
  process.exit(failed ? 1 : 0);
})();
