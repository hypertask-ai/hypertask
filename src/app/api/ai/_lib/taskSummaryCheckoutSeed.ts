import prisma from "@/lib/prisma";
import { markTaskSummariesStale, taskSummaryOnViewEnabled } from "@/app/api/ai/_lib/taskSummaryFreshness";

export async function seedTeamSummaryRefreshesOnCheckout(teamId: string): Promise<boolean> {
  try {
    const tasks = await prisma.task.findMany({
      where: { project: { teamId }, status: { not: "Deleted" } },
      select: { id: true, userId: true },
    });
    const owners = new Map<number, boolean>();
    for (const task of tasks) {
      if (!owners.has(task.userId)) {
        owners.set(task.userId, await taskSummaryOnViewEnabled(task.userId));
      }
      if (owners.get(task.userId) !== true) return false;
    }
    const marked = await markTaskSummariesStale(tasks.map((task) => task.id));
    return marked === tasks.length;
  } catch (error) {
    console.error("[taskSummaries] Could not mark team summaries out of date", teamId, error);
    return false;
  }
}
