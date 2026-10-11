/**
 * HTPR-7098: smart label backfill as one half-price gateway batch instead of many instant calls.
 * The collector (collectBatches.ts) applies each verdict later with the stored snapshot time, so a
 * task edited while the batch ran is left alone exactly as on the instant path.
 */
import {
  buildSmartLabelBatchRequest,
  chunkForBatch,
  labelTaskContentHash,
  type SmartLabelBatchItem,
} from "@/lib/ai/batch/batchJobs";
import { submitBatch } from "@/lib/ai/batch/submitBatch";

export type SmartLabelBatchTask = {
  id: number;
  projectId: number;
  title: string;
  /** Plain text, as the instant path sends it. */
  description: string;
  updatedAt: Date;
};

export async function submitSmartLabelBatch(args: {
  label: { id: string; prompt: string };
  model: string;
  gatewayKey: string;
  teamId: string;
  /** User the usage rows are attributed to (same as the instant path). */
  usageUserId: number;
  tasks: SmartLabelBatchTask[];
}): Promise<void> {
  const definitions = [{ labelId: args.label.id, prompt: args.label.prompt }];
  for (const chunk of chunkForBatch(args.tasks)) {
    await submitBatch({
      kind: "smart-label",
      teamId: args.teamId,
      userId: args.usageUserId,
      model: args.model,
      gatewayKey: args.gatewayKey,
      requests: chunk.map((task) =>
        buildSmartLabelBatchRequest({
          id: `t${task.id}`,
          model: args.model,
          task,
          definitions,
        }),
      ),
      items: Object.fromEntries(
        chunk.map((task): [string, SmartLabelBatchItem] => [
          `t${task.id}`,
          {
            taskId: task.id,
            projectId: task.projectId,
            labelId: args.label.id,
            promptAtSubmit: args.label.prompt,
            contentHash: labelTaskContentHash(task),
            snapshotAt: task.updatedAt.toISOString(),
          },
        ]),
      ),
    });
  }
}
