import { themeOptions } from "@/lib/themePreferences";
import type { SettingProposalCard, SettingsScope } from "./catalog";


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

function isAiChatShortcut(event: KeyboardEvent) {
  if (event.isComposing || event.key.toLowerCase() !== "j") return false;
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
}

export const SETTINGS_OPEN_EVENT = "hypertask:open-settings";
export const SETTINGS_CHANGED_EVENT = "hypertask:settings-changed";

export function subscribeAiSettingsEvents(handlers: { openSettings: (path: string) => void; changed: () => void; shortcut: () => void }) {
  const open = (event: Event) => {
    const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
    if (typeof path === "string") handlers.openSettings(path);
  };
  const shortcut = (event: KeyboardEvent) => {
    if (!isAiChatShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    handlers.shortcut();
  };
  window.addEventListener(SETTINGS_OPEN_EVENT, open);
  window.addEventListener(SETTINGS_CHANGED_EVENT, handlers.changed);
  window.addEventListener("keydown", shortcut, true);
  return () => {
    window.removeEventListener(SETTINGS_OPEN_EVENT, open);
    window.removeEventListener(SETTINGS_CHANGED_EVENT, handlers.changed);
    window.removeEventListener("keydown", shortcut, true);
  };
}
