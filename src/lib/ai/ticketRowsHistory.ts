import type { IChatMessage } from "@/models/model";

export function historyContent(message: Pick<IChatMessage, "content" | "ticketGroups">): string {
  const lines = (message.ticketGroups ?? []).flatMap((group) =>
    group.tasks.map((task) =>
      `- ${group.label ? `[${group.label}] ` : ""}${task.ticketNumber ?? `#${task.uniqueIndex}`} (task_id ${task.id}): ${task.title}`,
    ),
  );
  return lines.length ? `${message.content}\n\nTicket rows shown, in order:\n${lines.join("\n")}` : message.content;
}
