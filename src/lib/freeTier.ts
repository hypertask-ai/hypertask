// HTPR-4839: the free tier. Out-of-trial teams keep using the app, but BYOK is a
// paid feature. Premium models are gated separately by assertModelAllowedForPlan.
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";

/** True when the team has a non-Free plan (active subscription, comped, or internal). */
export async function isPaidTeam(
  teamId: string | null | undefined
): Promise<boolean> {
  if (!teamId) return false;
  return (await storePlanIdForProject(null, teamId)) !== "Free";
}
