import { errorBlock, type SlackBlock } from "@/lib/slack/blocks";

export async function runAsLinkedSlackUser<T>(
  actor: T | null,
  execute: (actor: T) => Promise<SlackBlock[]>,
): Promise<{ authorized: boolean; blocks: SlackBlock[] }> {
  if (!actor) {
    return {
      authorized: false,
      blocks: errorBlock(
        "Your Slack account is not connected to Hypertask.",
        "Run `/ht connect` first. Nothing was changed.",
      ),
    };
  }
  return { authorized: true, blocks: await execute(actor) };
}
