import { themeOptions } from "@/lib/themePreferences";
import type { SettingsScope } from "./catalog";
import type { SettingProposalCard } from "./catalog";

// Client-side calls for a setting change card. No React here, so the card keeps only rendering.

export function settingValueLabel(value: string | boolean) {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return themeOptions.find((option) => option.value === value)?.title ?? value;
}

export async function fetchSettingProposal(id: string): Promise<SettingProposalCard> {
  const response = await fetch(`/api/ai/settings?id=${id}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load setting change");
  return data.proposal;
}

export async function actOnSettingProposalCard(id: string, action: "apply" | "cancel" | "undo", scope?: SettingsScope): Promise<SettingProposalCard> {
  const response = await fetch("/api/ai/settings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action, scope }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not change setting");
  return data.proposal;
}
