// HTPR-4209: a ticket open on screen must not narrow a board-wide request.
// Reproduces exactly what happened on prod: 3 tasks carry the tag, one of them is
// the "open" ticket (default_context.task_id), and the user asks to retag ALL of them.
// Before the fix the model retagged only the open one and said nothing about the rest.
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const fs = require("fs");

const SC = "/tmp/claude-1000/-home-valentin-projects-hypertasks/fbbbeeae-e2ff-4aeb-a56a-a28226a8eda5/scratchpad";
const PID = 2038, UID = 977;

const cookieHeader = fs.readFileSync(`${SC}/cookies.txt`, "utf8")
  .split("\n").map((l) => l.replace(/^#HttpOnly_/, ""))
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("\t")).filter((p) => p.length >= 7)
  .map((p) => `${p[5]}=${p[6]}`).join("; ");

const db = new Client({ connectionString: process.env.DATABASE_URL });
const q = (s, p = []) => db.query(s, p).then((r) => r.rows);

async function chat(message, ctx) {
  const res = await fetch("http://localhost:3123/api/ai/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ message, model: "gpt-5.5", default_context: ctx }),
    signal: AbortSignal.timeout(240000),
  });
  const raw = await res.text();
  return raw.split("\n").filter((l) => l.startsWith("data:"))
    .map((l) => { try { return JSON.parse(l.slice(5)).content ?? ""; } catch { return ""; } })
    .join("");
}

(async () => {
  await db.connect();
  await q(`DELETE FROM "TaskLabel" WHERE "labelId" IN (SELECT id FROM "Label" WHERE "projectId"=$1 AND value IN ('ScopeOld','ScopeNew','keepme'))`, [PID]);
  await q(`DELETE FROM "Label" WHERE "projectId"=$1 AND value IN ('ScopeOld','ScopeNew','keepme')`, [PID]);
  for (const v of ["ScopeOld", "ScopeNew", "keepme"]) {
    await q(`INSERT INTO "Label" (id,"createdAt",value,"projectId") VALUES (gen_random_uuid(),now(),$1,$2)`, [v, PID]);
  }
  const L = Object.fromEntries((await q(`SELECT id,value FROM "Label" WHERE "projectId"=$1`, [PID])).map((r) => [r.value, r.id]));

  const ids = [];
  for (let i = 0; i < 3; i++) {
    const [{ next }] = await q(`SELECT COALESCE(MAX("uniqueIndex"),0)+1 AS next FROM "Task" WHERE "projectId"=$1`, [PID]);
    const [t] = await q(
      `INSERT INTO "Task" (title,description,"projectId",section,"userId","createdAt","updatedAt",status,"uniqueIndex")
       VALUES ($1,'<p>x</p>',$2,'Todo',$3,now(),now(),'Normal',$4) RETURNING id`,
      [`Scope target ${i}`, PID, UID, next]
    );
    for (const v of ["ScopeOld", "keepme"]) {
      await q(`INSERT INTO "TaskLabel" ("taskId","labelId") VALUES ($1,$2)`, [t.id, L[v]]);
    }
    ids.push(t.id);
  }
  const tags = async (id) => (await q(
    `SELECT l.value FROM "TaskLabel" tl JOIN "Label" l ON l.id=tl."labelId" WHERE tl."taskId"=$1`, [id]
  )).map((r) => r.value).sort();

  const openTicket = ids[0]; // this one is "on screen" -- the trap
  console.log(`3 tasks tagged ScopeOld: ${ids.join(", ")}  (open on screen: ${openTicket})\n`);

  const reply = await chat(
    `Every task on this board tagged "ScopeOld" should have the "ScopeNew" tag instead. Remove ScopeOld from all of them and add ScopeNew. Keep their other tags.`,
    { project_id: PID, task_id: openTicket }   // a ticket IS open, exactly like prod
  );

  let changed = 0, wiped = 0;
  for (const id of ids) {
    const t = await tags(id);
    const ok = t.includes("ScopeNew") && !t.includes("ScopeOld");
    if (ok) changed++;
    if (!t.includes("keepme")) wiped++;
    console.log(`  task ${id}: [${t.join(", ")}] ${ok ? "retagged" : "NOT retagged"}`);
  }
  console.log(`\nretagged ${changed}/3, bystander tag lost on ${wiped}`);
  console.log(`reply mentions a count: ${/\b3\b|all three|three tasks/i.test(reply) ? "yes" : "no"}`);
  console.log(`\nVERDICT: ${changed === 3 && wiped === 0 ? "PASS - all 3 retagged, bystander tags kept" : `FAIL - only ${changed}/3 (this is the prod bug)`}`);
  console.log(`\nreply: ${reply.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300)}`);
  await db.end();
})();
