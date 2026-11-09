import type { SkillOfferCard } from "./contract";

export async function fetchSkillOffer(id: string): Promise<SkillOfferCard> {
  const response = await fetch(`/api/ai/skill-offers?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load skill suggestion");
  return data.offer;
}

export async function actOnSkillOffer(
  id: string,
  action: "draft" | "dismiss" | "save",
): Promise<SkillOfferCard> {
  const response = await fetch("/api/ai/skill-offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not update skill suggestion");
  return data.offer;
}

export function skillOfferDraftMessage(rule: string) {
  return `Draft a personal skill for this rule I keep repeating: "${rule}". Show the full draft and wait for my approval before saving.`;
}
