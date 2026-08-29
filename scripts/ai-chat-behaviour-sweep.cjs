// AI chat behaviour sweep.
//
// The interface-parity table (hypertask.app/interface-parity) is built by reading the code, so it
// can only prove a chat tool EXISTS. It cannot prove the tool works. In HTPR-4202 "Update task
// (incl. labels)" was green there while every tag write threw "Label(s) not found".
//
// This script proves behaviour instead: it drives the real /api/ai/chat/stream endpoint with the
// same English a user would type, then asserts against the DATABASE that the change actually landed.
// A tool that is registered but throws FAILS here.
//
// Run:
//   1. dev server on :3123 against a NON-production DB
//        (set NEXT_PUBLIC_BASEURL=http://localhost:3123 or internal task-create calls go to :3000)
//   2. log in, writing cookies to <scratch>/cookies.txt (mint an email-link JWT ->
//      POST /api/auth/verify-email-token). httpOnly cookies land on "#HttpOnly_" lines --
//      do not filter them out or every request runs logged out.
//   3. node scripts/ai-chat-behaviour-sweep.cjs
//
// If the VPS egress is bot-challenged by Vercel, the AI gateway 403s and every check fails for
// reasons that have nothing to do with the code. Tunnel via a clean IP before believing a red run.
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const fs = require("fs");

const SC = "/tmp/claude-1000/-home-valentin-projects-hypertasks/fbbbeeae-e2ff-4aeb-a56a-a28226a8eda5/scratchpad";
const COOKIES = fs.readFileSync(`${SC}/cookies.txt`, "utf8");
const PID = 2038;
const UID = 977;

// curl writes httpOnly cookies (ht_session) on "#HttpOnly_" lines. Dropping every
// "#" line silently strips the session cookie and every request runs logged out.
const cookieHeader = COOKIES.split("\n")
  .map((l) => l.replace(/^#HttpOnly_/, ""))
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("\t"))
  .filter((p) => p.length >= 7)
  .map((p) => `${p[5]}=${p[6]}`)
  .join("; ");

const db = new Client({ connectionString: process.env.DATABASE_URL });

async function chat(message, ctx = { project_id: PID }) {
  const res = await fetch("http://localhost:3123/api/ai/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ message, model: "gpt-5.5", default_context: ctx }),
    signal: AbortSignal.timeout(180000),
  });
  const raw = await res.text();
  const text = raw
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => {
      try { return JSON.parse(l.slice(5)).content ?? ""; } catch { return ""; }
    })
    .join("");
  return text;
}

const FAILMSG = "couldn't produce an answer";
const results = [];

async function check(cap, message, verify, ctx) {
  let reply = "";
  try {
    reply = await chat(message, ctx);
    const detail = await verify(reply);
    const brokeDown = reply.includes(FAILMSG);
    const ok = detail.ok && !brokeDown;
    results.push({ cap, ok, note: brokeDown ? "chat gave up (no answer)" : detail.note });
    console.log(`${ok ? "PASS" : "FAIL"}  ${cap}${detail.note ? "  -- " + detail.note : ""}`);
  } catch (e) {
    results.push({ cap, ok: false, note: e.message.slice(0, 90) });
    console.log(`FAIL  ${cap}  -- ${e.message.slice(0, 90)}`);
  }
}

const q = (sql, p = []) => db.query(sql, p).then((r) => r.rows);

(async () => {
  await db.connect();

  // ---- fixtures: reproduce the reported scenario exactly
  await q(`DELETE FROM "TaskLabel" WHERE "labelId" IN (SELECT id FROM "Label" WHERE "projectId"=$1 AND value IN ('AI Task Writer','AI','stale'))`, [PID]);
  await q(`DELETE FROM "Label" WHERE "projectId"=$1 AND value IN ('AI Task Writer','AI','stale')`, [PID]);
  for (const v of ["AI Task Writer", "AI", "stale"]) {
    await q(`INSERT INTO "Label" (id,"createdAt",value,"projectId") VALUES (gen_random_uuid(),now(),$1,$2)`, [v, PID]);
  }
  const labels = Object.fromEntries((await q(`SELECT id,value FROM "Label" WHERE "projectId"=$1`, [PID])).map((r) => [r.value, r.id]));

  // a task tagged exactly like HTPR-3411: the target tag + a bystander tag
  const [{ next }] = await q(`SELECT COALESCE(MAX("uniqueIndex"),0)+1 AS next FROM "Task" WHERE "projectId"=$1`, [PID]);
  const [seed] = await q(
    `INSERT INTO "Task" (title,description,"projectId",section,"userId","createdAt","updatedAt",status,"uniqueIndex")
     VALUES ('Sweep seed: tag swap target','<p>seed</p>',$1,'Todo',$2,now(),now(),'Normal',$3) RETURNING id`,
    [PID, UID, next]
  );
  for (const v of ["AI Task Writer", "stale"]) {
    await q(`INSERT INTO "TaskLabel" ("taskId","labelId") VALUES ($1,$2)`, [seed.id, labels[v]]);
  }
  const tagsOf = async (id) =>
    (await q(`SELECT l.value FROM "TaskLabel" tl JOIN "Label" l ON l.id=tl."labelId" WHERE tl."taskId"=$1`, [id])).map((r) => r.value).sort();

  console.log(`\nfixtures: task ${seed.id} tagged [${(await tagsOf(seed.id)).join(", ")}] on project ${PID}\n`);
  console.log("=== THE REPORTED BUG ===");

  // ---- 1. the exact failing request
  await check(
    "Tag swap: replace 'AI Task Writer' with 'AI' (the reported bug)",
    `On task ${seed.id}, remove the "AI Task Writer" tag and add the "AI" tag instead. Keep every other tag it has.`,
    async () => {
      const t = await tagsOf(seed.id);
      const ok = t.includes("AI") && !t.includes("AI Task Writer") && t.includes("stale");
      return { ok, note: `tags now [${t.join(", ")}]${t.includes("stale") ? "" : " -- BYSTANDER TAG 'stale' WAS WIPED"}` };
    },
    { project_id: PID, task_id: seed.id }
  );

  console.log("\n=== BULK (the CLI can do this in one call; the chat could not) ===");
  // Five tasks all carrying the target tag plus a bystander tag. The old chat tool took one
  // task per call against a 12-step budget, so this is where it fell over at scale.
  const bulkIds = [];
  for (let i = 0; i < 5; i++) {
    const [{ next: n }] = await q(`SELECT COALESCE(MAX("uniqueIndex"),0)+1 AS next FROM "Task" WHERE "projectId"=$1`, [PID]);
    const [t] = await q(
      `INSERT INTO "Task" (title,description,"projectId",section,"userId","createdAt","updatedAt",status,"uniqueIndex")
       VALUES ($1,'<p>x</p>',$2,'Todo',$3,now(),now(),'Normal',$4) RETURNING id`,
      [`Bulk swap target ${i}`, PID, UID, n]
    );
    for (const v of ["AI Task Writer", "stale"]) {
      await q(`INSERT INTO "TaskLabel" ("taskId","labelId") VALUES ($1,$2)`, [t.id, labels[v]]);
    }
    bulkIds.push(t.id);
  }
  await check(
    `Bulk tag swap across ${bulkIds.length} tasks`,
    `On project ${PID}, find every task tagged "AI Task Writer" whose title starts with "Bulk swap target", remove that tag from all of them and give them the "AI" tag instead. Keep their other tags.`,
    async () => {
      const bad = [];
      for (const id of bulkIds) {
        const t = await tagsOf(id);
        if (!(t.includes("AI") && !t.includes("AI Task Writer") && t.includes("stale"))) bad.push(`${id}:[${t.join("|")}]`);
      }
      return { ok: bad.length === 0, note: bad.length ? `wrong on ${bad.length}/5 -> ${bad.join(" ")}` : "all 5 swapped, bystander tags kept" };
    }
  );

  console.log("\n=== TASKS ===");
  const [{ next: n2 }] = await q(`SELECT COALESCE(MAX("uniqueIndex"),0)+1 AS next FROM "Task" WHERE "projectId"=$1`, [PID]);
  const [filterTask] = await q(
    `INSERT INTO "Task" (title,description,"projectId",section,"userId","createdAt","updatedAt",status,"uniqueIndex")
     VALUES ('Sweep filter target','<p>x</p>',$1,'Todo',$2,now(),now(),'Normal',$3) RETURNING id`, [PID, UID, n2]);
  await q(`INSERT INTO "TaskLabel" ("taskId","labelId") VALUES ($1,$2)`, [filterTask.id, labels["stale"]]);
  await check("List / filter tasks by label", `List the tasks on project ${PID} tagged "stale". Give their ids.`,
    async (r) => ({ ok: r.includes(String(filterTask.id)), note: r.includes(String(filterTask.id)) ? "found it" : `did not find task ${filterTask.id}` }));

  await check("Get single task", `What is the title of task ${seed.id}?`,
    async (r) => ({ ok: /sweep seed/i.test(r), note: /sweep seed/i.test(r) ? "" : "wrong/no title" }));

  await check("Search tasks", `Search for tasks matching "Sweep seed". Give ids.`,
    async (r) => ({ ok: r.includes(String(seed.id)), note: "" }));

  let created = null;
  await check("Create task", `Create a task on project ${PID} titled "Sweep created task" in the Todo section.`,
    async () => {
      const rows = await q(`SELECT id FROM "Task" WHERE "projectId"=$1 AND title='Sweep created task' ORDER BY id DESC LIMIT 1`, [PID]);
      created = rows[0]?.id ?? null;
      return { ok: !!created, note: created ? `task ${created}` : "no task in DB" };
    });

  await check("Update task title", `Rename task ${seed.id} to "Sweep seed renamed".`,
    async () => {
      const [t] = await q(`SELECT title FROM "Task" WHERE id=$1`, [seed.id]);
      return { ok: t.title === "Sweep seed renamed", note: `title="${t.title}"` };
    }, { project_id: PID, task_id: seed.id });

  await check("Update task priority", `Set task ${seed.id} to High priority.`,
    async () => {
      const p = await q(`SELECT priority_index FROM "Priority" WHERE "taskId"=$1 ORDER BY id DESC LIMIT 1`, [seed.id]);
      const idx = p[0]?.priority_index;
      return { ok: idx != null && idx > 0, note: `priority_index=${idx ?? "none"}` };
    }, { project_id: PID, task_id: seed.id });

  await check("Set labels (full replace)", `Set the tags on task ${seed.id} to exactly: AI, stale.`,
    async () => {
      const t = await tagsOf(seed.id);
      const ok = t.join(",") === "AI,stale";
      return { ok, note: `tags [${t.join(", ")}]` };
    }, { project_id: PID, task_id: seed.id });

  await check("Move task within board", `Move task ${seed.id} to the Doing section.`,
    async () => {
      const [t] = await q(`SELECT section FROM "Task" WHERE id=$1`, [seed.id]);
      return { ok: t.section === "Doing", note: `section=${t.section}` };
    }, { project_id: PID, task_id: seed.id });

  await check("Assign user", `Assign me (user ${UID}) to task ${seed.id}.`,
    async () => {
      const a = await q(`SELECT "userId" FROM "Assignees" WHERE "taskId"=$1`, [seed.id]);
      return { ok: a.some((x) => x.userId === UID), note: `assignees=[${a.map((x) => x.userId).join(",")}]` };
    }, { project_id: PID, task_id: seed.id });

  await check("Unassign user", `Remove me (user ${UID}) from task ${seed.id}.`,
    async () => {
      const a = await q(`SELECT "userId" FROM "Assignees" WHERE "taskId"=$1`, [seed.id]);
      return { ok: !a.some((x) => x.userId === UID), note: `assignees=[${a.map((x) => x.userId).join(",")}]` };
    }, { project_id: PID, task_id: seed.id });

  console.log("\n=== COMMENTS ===");
  await check("Add comment", `Add a comment to task ${seed.id} saying "sweep comment alpha".`,
    async () => {
      const c = await q(`SELECT id,text FROM "Comment" WHERE "taskId"=$1 ORDER BY id DESC LIMIT 1`, [seed.id]);
      return { ok: !!c[0] && /sweep comment alpha/i.test(c[0].text ?? ""), note: c[0] ? "comment stored" : "no comment row" };
    }, { project_id: PID, task_id: seed.id });

  await check("List comments", `What comments are on task ${seed.id}?`,
    async (r) => ({ ok: /sweep comment alpha/i.test(r), note: "" }), { project_id: PID, task_id: seed.id });

  console.log("\n=== LABELS / SECTIONS / PROJECT ===");
  await check("Create label", `Create a new tag called "sweep-fresh-label" on project ${PID}.`,
    async () => {
      const l = await q(`SELECT id FROM "Label" WHERE "projectId"=$1 AND value='sweep-fresh-label'`, [PID]);
      return { ok: l.length > 0, note: l.length ? "label created" : "not in DB" };
    });

  await check("List labels", `What tags exist on project ${PID}?`,
    async (r) => ({ ok: /ai task writer/i.test(r) || /stale/i.test(r), note: "" }));

  await check("Create section", `Add a new column called "Sweep Column" to project ${PID}.`,
    async () => {
      const s = await q(`SELECT id FROM "Section" WHERE "projectId"=$1 AND section_title='Sweep Column' AND deleted=false`, [PID]);
      return { ok: s.length > 0, note: s.length ? "section created" : "not in DB" };
    });

  await check("List sections", `What columns does project ${PID} have?`,
    async (r) => ({ ok: /todo/i.test(r) && /doing/i.test(r), note: "" }));

  await check("List projects", `List my boards.`,
    // The chat lists boards by name, not numeric id, so assert on a name it must return.
    async (r) => ({ ok: /myboard/i.test(r), note: "" }));

  await check("List project members", `Who are the members of project ${PID}?`,
    async (r) => ({ ok: r.length > 20, note: "" }));

  await check("Get user context", `Who am I?`,
    async (r) => ({ ok: /valentin/i.test(r), note: "" }));

  console.log("\n=== INBOX ===");
  await check("List inbox", `What's in my inbox?`,
    async (r) => ({ ok: r.length > 20 && !r.includes(FAILMSG), note: "" }));

  // ---- report
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================ ${pass}/${results.length} PASS ================`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("FAILURES:");
    for (const f of failed) console.log(`  - ${f.cap} :: ${f.note}`);
  }
  fs.writeFileSync(`${SC}/sweep-results.json`, JSON.stringify(results, null, 2));
  await db.end();
})();
