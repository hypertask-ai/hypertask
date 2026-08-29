import { ITips } from "@/models/model";

export const HTCTipsConstants: ITips[] = [
  {
    startText: "Try:",
    hint: `"Search"`,
    key: [],
  },
  {
    hint: `"Go to"`,
    key: [],
  },
  {
    hint: `"Manage"`,
    key: [],
  },
  {
    hint: `"Remind me"`,
    key: [],
  },
  {
    hint: `"Add"`,
    key: [],
  },
  {
    hint: `"Create"`,
    key: [],
  },
];

export const KanbanTipsConstants: ITips[] = [
  {
    key: ["CTRL", "K"],
    hint: "command center",
  },
  {
    key: ["J"],
    hint: "down",
  },
  {
    key: ["K"],
    hint: "up",
  },
  {
    key: ["TAB"],
    hint: "next column",
  },
  {
    key: ["C"],
    hint: "add task",
  },
  {
    key: ["CTRL", "E"],
    hint: "archive",
  },
  {
    key: ["CTRL", "B"],
    hint: "Change Board",
  },
  {
    key: ["/"],
    hint: "search",
  },
];

export const TaskDetailTipsConstants: ITips[] = [
  {
    key: ["CTRL", "K"],
    hint: "command center",
  },
  {
    key: ["A"],
    hint: "assign",
  },
  {
    key: ["M"],
    hint: "change status(move)",
  },
  {
    key: ["P"],
    hint: "priority",
  },
  {
    key: ["S"],
    hint: "task size",
  },
  {
    key: ["T"],
    hint: "tags",
  },
  {
    key: ["CTRL", "E"],
    hint: "archive",
  },
  {
    key: ["ESC"],
    hint: "back",
  },
  {
    key: ["TAB"],
    hint: "cycle",
  },
];

export const SearchPageTipsConstants: ITips[] = [
  {
    key: ["CTRL", "K"],
    hint: "command center",
  },
  {
    key: ["/"],
    hint: "edit search term",
  },
  {
    key: ["J"],
    hint: "down",
  },
  {
    key: ["K"],
    hint: "up",
  },
  {
    key: ["Tab"],
    hint: "cycle search splits | Autocomplete",
  },
  {
    key: ["Enter"],
    hint: "open task",
  },
  {
    key: ["ESC"],
    hint: "back",
  },
];

export const InboxPageTipsConstants: ITips[] = [
  {
    key: ["CTRL", "K"],
    hint: "command center",
  },
  {
    key: ["J"],
    hint: "down",
  },
  {
    key: ["K"],
    hint: "up",
  },
  {
    key: ["Enter"],
    hint: "open task",
  },
  {
    key: ["TAB"],
    hint: "cycle inbox splits",
  },
  {
    key: ["E"],
    hint: "Remove notification",
  },
  {
    key: ["CTRL", "E"],
    hint: "Mark task as done",
  },
];
