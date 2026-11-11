import type { ITask } from "@/models/model";

export const CARD_PARTS = [
  { key: "people", label: "People" },
  { key: "ticketNumber", label: "Ticket number" },
  { key: "inboxIcon", label: "Inbox icon", description: "Blue when unread, grey when read" },
  { key: "comments", label: "Comments" },
  { key: "subTasks", label: "Sub-tasks" },
  { key: "priority", label: "Priority" },
  { key: "size", label: "Size" },
  { key: "dueDate", label: "Due date" },
  { key: "tags", label: "Tags" },
  { key: "staleness", label: "Staleness", description: "Clock and days on stale cards" },
  { key: "blockedEdge", label: "Blocked edge", description: "Red edge and blocker on blocked cards" },
] as const;

export type CardPart = (typeof CARD_PARTS)[number]["key"];
export type CardParts = Readonly<Record<CardPart, boolean>>;

const cardPartsWith = (pick: (part: CardPart) => boolean): CardParts =>
  Object.fromEntries(CARD_PARTS.map(({ key }) => [key, pick(key)])) as CardParts;

export const ALL_CARD_PARTS = cardPartsWith(() => true);
export const EMPTY_CARD_PARTS = cardPartsWith(() => false);
const DEFAULT_ON: readonly CardPart[] = ["people", "ticketNumber", "tags", "inboxIcon"];
export const DEFAULT_CARD_PARTS = cardPartsWith((part) => DEFAULT_ON.includes(part));

export const parseCardParts = (raw: unknown): CardParts => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_CARD_PARTS;
  const saved = raw as Record<string, unknown>;
  return cardPartsWith((part) => part === "people" ? saved[part] !== false : saved[part] === true);
};

type CardTask = ITask & { customFieldValues?: unknown[] };

export function cardPartsView<Blocker>(task: CardTask, blockingUser: Blocker | undefined, parts: CardParts) {
  return {
    task:
      parts.blockedEdge && parts.tags
        ? task
        : {
            ...task,
            blockingTasks: parts.blockedEdge ? task.blockingTasks : [],
            customFieldValues: parts.tags ? task.customFieldValues : [],
          },
    ticketNumber: parts.ticketNumber ? task.ticketNumber ?? "" : "",
    notifications: parts.inboxIcon ? task.notifications : [],
    notificationCount: parts.inboxIcon ? task._count?.notifications : 0,
    commentCount: parts.comments ? task.totalComments ?? task._count?.comments : undefined,
    subTasks: parts.subTasks ? task.subTasks : undefined,
    subTaskCount: parts.subTasks ? task.subTasks?.length ?? 0 : 0,
    priority: parts.priority ? task.priority : undefined,
    estimate: parts.size ? task.estimate : undefined,
    dueDate: parts.dueDate ? task.dueDate : undefined,
    taskLabels: parts.tags ? task.taskLabels : [],
    staleness: parts.staleness,
    blocked:
      parts.blockedEdge &&
      ((task.waitingOnUserId !== null && task.waitingOnUserId !== undefined) ||
        (task.blockingTasks?.length ?? 0) > 0),
    blockingUser: parts.blockedEdge ? blockingUser : undefined,
  };
}
