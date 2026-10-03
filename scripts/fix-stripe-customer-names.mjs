// HTPR-6862: repair Stripe customer names that had "undefined" or an id glued on.
// Dry run by default; pass --apply to write. Needs STRIPE_SECRET_KEY in the env.
// HTPR-6864: --fill-blank names blank customers after the team (or owner email)
// that uses them, read from the app database (needs DATABASE_URL).
import Stripe from "stripe";
import pg from "pg";
import fs from "node:fs";

const ID_SUFFIX = /(?:Hypertask team:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const apply = process.argv.includes("--apply");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export function repairedName(name, email) {
  if (!name || !ID_SUFFIX.test(name)) return null;
  const rest = name.replace(ID_SUFFIX, "").trim();
  const readable = rest && rest !== "undefined" && rest !== "null" ? rest : email || "";
  return readable === name ? null : readable;
}

const readable = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== "undefined" && text !== "null" ? text : null;
};

async function appNamesFor(customerIds) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const names = new Map();
    const owners = await db.query(
      `SELECT g.stripe_customer_id AS id, u.email AS name FROM "GoogleAccount" g
       JOIN "User" u ON u.id = g."userId" WHERE g.stripe_customer_id = ANY($1)
       UNION ALL SELECT stripe_customer_id, email FROM "User" WHERE stripe_customer_id = ANY($1)`,
      [customerIds]
    );
    for (const row of owners.rows) if (readable(row.name)) names.set(row.id, readable(row.name));
    // A team title wins over an owner email.
    const teams = await db.query(
      `SELECT stripe_customer_id AS id, title AS name FROM "Team" WHERE stripe_customer_id = ANY($1)`,
      [customerIds]
    );
    for (const row of teams.rows) if (readable(row.name)) names.set(row.id, readable(row.name));
    return names;
  } finally {
    await db.end();
  }
}

if (process.argv.includes("--fill-blank")) {
  // Only customers listed in the manifest the repair wrote when it blanked them
  // (--apply below), so a name cleared by anything else is never refilled.
  const manifestPath = process.argv[process.argv.indexOf("--fill-blank") + 1];
  if (!manifestPath || manifestPath.startsWith("--")) {
    console.error("Usage: --fill-blank <manifest.json written by the repair run> [--apply]");
    process.exit(1);
  }
  const blank = new Set();
  for (const id of JSON.parse(fs.readFileSync(manifestPath, "utf8")).blanked) {
    const current = await stripe.customers.retrieve(id);
    if (!current.deleted && !readable(current.name)) blank.add(id);
  }
  const names = await appNamesFor([...blank]);
  if (apply) for (const [id, name] of names) await stripe.customers.update(id, { name });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", blank: blank.size, toFill: names.size }));
  process.exit(0);
}

let scanned = 0, fixed = 0;
const blanked = [];
for await (const customer of stripe.customers.list({ limit: 100 })) {
  scanned++;
  const next = repairedName(customer.name, customer.email);
  if (next === null) continue;
  fixed++;
  if (next === "") blanked.push(customer.id);
  if (apply) await stripe.customers.update(customer.id, { name: next });
}
if (apply && blanked.length) {
  const manifest = `stripe-name-repair-${Date.now()}.json`;
  fs.writeFileSync(manifest, JSON.stringify({ blanked }, null, 2));
  console.log(`Blanked customers listed in ${manifest}; pass it to --fill-blank.`);
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, toFix: fixed }));
