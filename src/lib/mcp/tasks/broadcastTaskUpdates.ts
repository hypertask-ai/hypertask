import {
  broadcastBoardChange,
  broadcastTaskChange,
} from "@/lib/realtime/server";

type UpdatedTask = {
  id: number;
  projectId: number;
};

type RealtimeBroadcasters = {
  board: typeof broadcastBoardChange;
  task: typeof broadcastTaskChange;
};

export async function broadcastTaskUpdates(
  tasks: readonly UpdatedTask[],
  originUserId: number,
  broadcasters: RealtimeBroadcasters = {
    board: broadcastBoardChange,
    task: broadcastTaskChange,
  },
): Promise<void> {
  const payload = { originUserId };
  const projectIds = [...new Set(tasks.map((task) => task.projectId))];

  const results = await Promise.allSettled([
    ...projectIds.map((projectId) => broadcasters.board(projectId, payload)),
    ...tasks.map((task) => broadcasters.task(task.id, payload)),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[MCP Update Task] Realtime delivery failed:", result.reason);
    }
  }
}
