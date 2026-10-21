import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";

export async function isPaidTeam(
  teamId: string | null | undefined
): Promise<boolean> {
  if (!teamId) return false;
  return (await storePlanIdForProject(null, teamId)) !== "Free";
}
