// HTPR-6862: repair Stripe customer names that had "undefined" or an id glued on.
// Dry run by default; pass --apply to write. Needs STRIPE_SECRET_KEY in the env.
// HTPR-6864: --fill-blank names blank customers after the team (or owner email)
// that uses them, read from the app database (needs DATABASE_URL).
import Stripe from "stripe";
import pg from "pg";

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
  // Only customers the HTPR-6862 repair blanked: Stripe's change log shows a
  // previous name with a glued-on id and no name now. Customers that never had a
  // name are left alone.
  const since = Number(process.env.SINCE_UNIX || Math.floor(Date.now() / 1000) - 7 * 86400);
  const blank = new Set();
  for await (const event of stripe.events.list({ type: "customer.updated", created: { gte: since }, limit: 100 })) {
    const previous = event.data.previous_attributes?.name;
    const customer = event.data.object;
    if (typeof previous === "string" && ID_SUFFIX.test(previous) && !readable(customer.name)) blank.add(customer.id);
  }
  for (const id of [...blank]) {
    const current = await stripe.customers.retrieve(id);
    if (current.deleted || readable(current.name)) blank.delete(id);
  }
  const names = await appNamesFor([...blank]);
  if (apply) for (const [id, name] of names) await stripe.customers.update(id, { name });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", blank: blank.size, toFill: names.size }));
  process.exit(0);
}

let scanned = 0, fixed = 0;
for await (const customer of stripe.customers.list({ limit: 100 })) {
  scanned++;
  const next = repairedName(customer.name, customer.email);
  if (next === null) continue;
  fixed++;
  if (apply) await stripe.customers.update(customer.id, { name: next });
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, toFix: fixed }));
