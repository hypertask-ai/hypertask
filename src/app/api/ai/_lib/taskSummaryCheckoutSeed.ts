import prisma from "@/lib/prisma";
import { markTaskSummariesStale } from "@/app/api/ai/_lib/taskSummaryFreshness";

export async function seedTeamSummaryRefreshesOnCheckout(teamId: string): Promise<number> {
  try {
    const tasks = await prisma.task.findMany({
      where: { project: { teamId }, status: { not: "Deleted" } },
      select: { id: true },
    });
    return await markTaskSummariesStale(tasks.map((task) => task.id));
  } catch (error) {
    console.error("[taskSummaries] Could not mark team summaries out of date", teamId, error);
    return 0;
  }
}
