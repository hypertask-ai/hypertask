import { buildTaskLink } from "@/lib/mcp-server/utils/task-link";

export type SlackBlock = Record<string, unknown>;

export type SlackTaskView = {
  boardTitle?: string;
  commentCount?: number;
  dueDate?: Date | string | null;
  priority?: string | { Priority_Value?: string } | null;
  projectId: number;
  section?: string | null;
  status?: string;
  ticketNumber?: string | null;
  title: string;
  totalComments?: number;
  uniqueIndex: number;
};

export type SlackProjectView = {
  memberCount?: number;
  sections?: Array<{ section_title: string }>;
  taskCount?: number;
  title?: string | null;
};

export type SlackInboxView = {
  fromAgent?: { displayName?: string | null } | null;
  fromUser?: { displayName?: string | null } | null;
  id: number | string;
  project?: { title?: string | null } | null;
  task?: {
    projectId: number;
    ticketNumber?: string | null;
    title: string;
    uniqueIndex: number;
  } | null;
};

export function taskCard(task: SlackTaskView): SlackBlock[] {
  const url = buildTaskLink(task.projectId, task.uniqueIndex);
  const ticket = task.ticketNumber || `Task ${task.uniqueIndex}`;
  const fields: SlackBlock[] = [
    field("Project", task.boardTitle || "Unknown"),
    field("Section", task.section || "Unknown"),
    field("Priority", priorityLabel(task.priority)),
    field("Status", task.status || "Normal"),
  ];
  if (task.dueDate) fields.push(field("Due", formatDate(task.dueDate)));
  fields.push(
    field("Comments", String(task.commentCount ?? task.totalComments ?? 0)),
  );

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${url}|${escapeSlackText(`${ticket}: ${task.title}`)}>*`,
      },
    },
    { type: "section", fields },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Hypertask" },
          url,
        },
      ],
    },
    { type: "divider" },
  ];
}

export function taskList(tasks: SlackTaskView[]): SlackBlock[] {
  if (tasks.length === 0) return section("No tasks found.");
  return tasks.slice(0, 20).map((task) => {
    const url = buildTaskLink(task.projectId, task.uniqueIndex);
    const ticket = task.ticketNumber || `Task ${task.uniqueIndex}`;
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*<${url}|${escapeSlackText(ticket)}>* ${escapeSlackText(task.title)}` +
          `  ·  ${escapeSlackText(priorityLabel(task.priority))}` +
          `  ·  ${escapeSlackText(task.section || "—")}`,
      },
    };
  });
}

export function projectList(projects: SlackProjectView[]): SlackBlock[] {
  if (projects.length === 0) return section("No projects found.");
  return projects.slice(0, 20).map((project) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text:
        `*${escapeSlackText(project.title || "Untitled project")}* — ` +
        `${project.taskCount ?? 0} tasks, ${project.memberCount ?? 0} members` +
        (project.sections?.length
          ? `\nSections: ${escapeSlackText(project.sections.map((item) => item.section_title).join(", "))}`
          : ""),
    },
  }));
}

export function inboxList(notifications: SlackInboxView[]): SlackBlock[] {
  if (notifications.length === 0) return section("Inbox is empty.");
  return notifications.slice(0, 20).map((notification) => {
    const task = notification.task;
    if (!task) return section("A workspace notification is waiting in Hypertask.")[0];
    const actor =
      notification.fromAgent?.displayName ||
      notification.fromUser?.displayName ||
      "Someone";
    const ticket = task.ticketNumber || `Task ${task.uniqueIndex}`;
    const url = buildTaskLink(task.projectId, task.uniqueIndex);
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${escapeSlackText(actor)}* on ` +
          `*<${url}|${escapeSlackText(`${ticket}: ${task.title}`)}>*` +
          (notification.project?.title
            ? ` (${escapeSlackText(notification.project.title)})`
            : "") +
          `\nNotification ID: \`${escapeSlackText(String(notification.id))}\``,
      },
    };
  });
}

export function errorBlock(message: string, suggestion?: string): SlackBlock[] {
  const text = suggestion
    ? `${escapeSlackText(message)}\n_${escapeSlackText(suggestion)}_`
    : escapeSlackText(message);
  return section(`:x: ${text}`);
}

export function confirmBlock(message: string): SlackBlock[] {
  return section(`:white_check_mark: ${escapeSlackText(message)}`);
}

export function textBlock(message: string): SlackBlock[] {
  return section(escapeSlackText(message));
}

export function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function section(text: string): SlackBlock[] {
  return [{ type: "section", text: { type: "mrkdwn", text } }];
}

function field(label: string, value: string): SlackBlock {
  return {
    type: "mrkdwn",
    text: `*${label}:* ${escapeSlackText(value)}`,
  };
}

function priorityLabel(
  priority: SlackTaskView["priority"],
): string {
  return typeof priority === "string"
    ? priority
    : priority?.Priority_Value || "None";
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}
