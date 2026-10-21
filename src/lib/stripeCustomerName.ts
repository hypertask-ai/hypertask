export function stripeCustomerName(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const name = candidate.trim();
    if (name && name !== "undefined" && name !== "null") return name;
  }
  return undefined;
}
