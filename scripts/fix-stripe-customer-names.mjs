// HTPR-6862: repair Stripe customer names that had "undefined" or an id glued on.
// Dry run by default; pass --apply to write. Needs STRIPE_SECRET_KEY in the env.
import Stripe from "stripe";

const ID_SUFFIX = /(?:Hypertask team:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const apply = process.argv.includes("--apply");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export function repairedName(name, email) {
  if (!name || !ID_SUFFIX.test(name)) return null;
  const rest = name.replace(ID_SUFFIX, "").trim();
  const readable = rest && rest !== "undefined" && rest !== "null" ? rest : email || "";
  return readable === name ? null : readable;
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
