import type { IPricingSearchParams } from "@/models/model";

function baseUrl(): string {
  return String(process.env.NEXT_PUBLIC_BASEURL);
}

export function buildPricingCheckoutSuccessUrl(team: IPricingSearchParams): string {
  const q = new URLSearchParams({
    teamId: team.teamId,
    totalSeats: String(team.totalSeats),
    googleAccountId: team.googleAccountId,
    stripe_customer_id: team.stripe_customer_id,
    teamTitle: team.teamTitle,
    success: "1",
  });
  return `${baseUrl()}/pricing?${q.toString()}`;
}

export function buildPricingCheckoutCancelUrl(team: IPricingSearchParams): string {
  const q = new URLSearchParams({
    teamId: team.teamId,
    totalSeats: String(team.totalSeats),
    googleAccountId: team.googleAccountId,
    stripe_customer_id: team.stripe_customer_id,
    teamTitle: team.teamTitle,
    preSelect: "Upgrade",
    success: "0",
  });
  return `${baseUrl()}/pricing?${q.toString()}`;
}
