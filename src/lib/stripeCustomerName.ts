// HTPR-6862: Stripe shows this name to the customer on the billing portal and
// invoices, so it must be readable. Ids go in metadata, never in the name.
export function stripeCustomerName(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const name = candidate.trim();
    if (name && name !== "undefined" && name !== "null") return name;
  }
  return undefined;
}
