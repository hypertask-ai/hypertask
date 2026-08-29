import type { PersonHovercardProfile } from "@/models/personHovercard";

export function agentPageHref(profile: PersonHovercardProfile): string | null {
  return profile.kind === "agent" ? `/agents/${profile.id}` : null;
}
