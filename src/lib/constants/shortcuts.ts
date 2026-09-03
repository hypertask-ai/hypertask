import { RAIL_TOGGLE_KEY } from "@/lib/constants/railToggleKey";

interface IShortcut {
  title: string;
  sub: { shortTitle: string; pressKey: (string | null)[] }[];
}

type BoardSwitchKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
>;

export const isFavoriteBoardShortcut = (
  event: BoardSwitchKeyboardEvent,
  isApple: boolean
) =>
  /^Digit\d$/.test(event.code) &&
  !event.shiftKey &&
  !event.metaKey &&
  (isApple
    ? event.ctrlKey && !event.altKey
    : event.altKey && !event.ctrlKey);

export const getKeyboardShortcuts = (
  isApple: boolean,
  appShellRailOn = false
): IShortcut[] => {
  const cmdControl = isApple ? "CMD" : "CTRL";
  const altOptions = isApple ? "OPT" : "ALT";
  const boardSwitch = isApple ? "CTRL" : "ALT";

  // Helper function to clean pressKey arrays (trim strings, handle comma-separated values, preserve nulls)
  const cleanPressKey = (keys: (string | null)[]): (string | null)[] => {
    return keys
      .flatMap((key) => {
        if (key === null) {
          return [null];
        }
        const trimmed = key.trim();
        // Handle comma-separated values like "J, ⭣" by splitting
        if (trimmed.includes(", ")) {
          return trimmed.split(", ");
        }
        return [trimmed];
      });
  };

  const appShellShortcuts: IShortcut[] = appShellRailOn
    ? [
        {
          title: "App shell surfaces",
          sub: [
            { shortTitle: "Inbox", pressKey: ["1"] },
            { shortTitle: "Board", pressKey: ["2"] },
            { shortTitle: "Table", pressKey: ["3"] },
            { shortTitle: "Calendar", pressKey: ["4"] },
            { shortTitle: "Toggle AI chat", pressKey: ["5"] },
            { shortTitle: "Toggle AI chat (alternative)", pressKey: ["]"] },
            { shortTitle: "Search", pressKey: ["6"] },
            { shortTitle: "Running timers", pressKey: ["7"] },
            { shortTitle: "Collapse / expand sidebar", pressKey: [RAIL_TOGGLE_KEY] },
          ],
        },
      ]
    : [];

  const shortcuts: IShortcut[] = [
    ...appShellShortcuts,
    {
      title: "Global Shortcuts",
      sub: [
        { shortTitle: "Shortcuts", pressKey: ["?"] },
        { shortTitle: "Settings", pressKey: ["\\"] },
        { shortTitle: "Search", pressKey: ["/"] },
        { shortTitle: "Set priority", pressKey: ["P"] },
        { shortTitle: "Set task size", pressKey: ["S"] },
        { shortTitle: "Add tags", pressKey: ["T"] },
        { shortTitle: "Remove notification", pressKey: ["E"] },
        { shortTitle: "Move focus down", pressKey: ["J"] },
        { shortTitle: "Move focus up", pressKey: ["K"] },
        { shortTitle: "Move focus", pressKey: ["←", "⭡", "⭣", "→"] },
        { shortTitle: "Open Hypertask Command", pressKey: [cmdControl, "K"] },
        { shortTitle: "Undo latest action", pressKey: [cmdControl, "Z"] },
        { shortTitle: "Use snippet", pressKey: [";"] },
        { shortTitle: "Show or hide archived tasks", pressKey: ["G", null, "X"] },
        { shortTitle: "Exit (go back)", pressKey: ["ESC"] },
        { shortTitle: "Archive task or comment", pressKey: [cmdControl, "E"] },
        { shortTitle: "Delete task", pressKey: ["#"] },
        { shortTitle: "Go to task board", pressKey: ["G", null, "B"] },
        { shortTitle: "Go to inbox archives", pressKey: ["G", null, "R"] },
        { shortTitle: "Go to running timers", pressKey: ["G", null, "T"] },
        { shortTitle: "Go to reminders", pressKey: ["G", null, "H"] },
        { shortTitle: "Go to trash", pressKey: ["G", null, "#"] },
        { shortTitle: "Go to all tasks", pressKey: ["G", null, "A"] },
        { shortTitle: "Go to my tasks", pressKey: ["G", null, "M"] },
        { shortTitle: "Go to inbox", pressKey: ["G", null, "I"] },
        { shortTitle: "Go to snippets", pressKey: ["G", null, ";"] },
        { shortTitle: "Go to archived tasks", pressKey: ["G", null, "E"] },
        { shortTitle: "Go to starred", pressKey: ["G", null, "S"] },
        { shortTitle: "Go to pinned", pressKey: ["G", null, "P"] },
        { shortTitle: "Go to drafts", pressKey: ["G", null, "D"] },
        { shortTitle: "Go to scheduled tasks", pressKey: ["G", null, "U"] },
        { shortTitle: "Go to calendar", pressKey: ["G", null, "C"] },
        { shortTitle: "Cycle focus forward", pressKey: ["TAB"] },
        { shortTitle: "Cycle focus backward", pressKey: ["SHIFT", "TAB"] },
        { shortTitle: "Switch boards", pressKey: [boardSwitch, "0-9"] },
        { shortTitle: "Switch Kanban boards", pressKey: [cmdControl, "B"] },
        { shortTitle: "Set due date", pressKey: ["SHIFT", "D"] },
        { shortTitle: "Move task to a different board", pressKey: ["SHIFT", "M"] },
      ],
    },
    {
      title: "Board",
      sub: [
        { shortTitle: "Add task", pressKey: ["C"] },
        { shortTitle: "Add task with AI Task Writer", pressKey: [cmdControl, "J"] },
        { shortTitle: "Add sub-task", pressKey: [cmdControl, "SHIFT", "+"] },
        { shortTitle: "Add task at top", pressKey: [cmdControl, "SHIFT", "C"] },
        { shortTitle: "Add task at bottom", pressKey: ["SHIFT", "C"] },
        { shortTitle: "Open task", pressKey: ["ENTER"] },
        // [ / ] cycle views on the old shell only; on the rail shell "[" is
        // the sidebar toggle (HTPR-4890) and views cycle with TAB/Shift+TAB.
        ...(appShellRailOn
          ? []
          : [
              { shortTitle: "Next view", pressKey: ["]"] },
              { shortTitle: "Previous view", pressKey: ["["] },
            ]),
        { shortTitle: "Move focus to top", pressKey: ["gg"] },
        { shortTitle: "Move focus to bottom", pressKey: ["GG"] },
        { shortTitle: "Move task down", pressKey: cleanPressKey(["SHIFT", "J, ⭣"]) },
        { shortTitle: "Move task up", pressKey: cleanPressKey(["SHIFT ", "K, ⭡"]) },
        { shortTitle: "Move task right", pressKey: cleanPressKey(["SHIFT", "L, ⭣"]) },
        { shortTitle: "Move task left", pressKey: cleanPressKey(["SHIFT ", "H, ⭡"]) },
        { shortTitle: "Move task to the left", pressKey: cleanPressKey(["SHIFT", "L, →"]) },
        { shortTitle: "Sort Kanban board", pressKey: ["SHIFT", "S"] },
        { shortTitle: "Add a sort level (table column)", pressKey: ["SHIFT", "CLICK"] },
        { shortTitle: "Toggle table layout", pressKey: ["SHIFT", "T"] },
        { shortTitle: "Match any / all values (inside a filter's list)", pressKey: ["←", "→"] },
        { shortTitle: "Show task options", pressKey: [cmdControl, "SHIFT", "+"] },
        { shortTitle: "Move task to the right", pressKey: cleanPressKey(["SHIFT", "H, ←"]) },
        { shortTitle: "Assign a user", pressKey: ["A"] },
      ],
    },
    {
      title: "Task View",
      sub: [
        { shortTitle: "Activate description/comment or reply to comment", pressKey: ["ENTER"] },
        { shortTitle: "Save/edit text entry", pressKey: [cmdControl, "ENTER"] },
        { shortTitle: "Write with AI", pressKey: [cmdControl, "J"] },
        { shortTitle: "Assign a user", pressKey: ["A"] },
        { shortTitle: "Blocked by person", pressKey: ["SHIFT", "B"] },
        { shortTitle: "Start / stop timer", pressKey: ["W"] },
        { shortTitle: "Log time", pressKey: ["B"] },
        { shortTitle: "Add a comment", pressKey: [cmdControl, "M"] },
        { shortTitle: "Suggest reply with AI", pressKey: ["SHIFT", "R"] },
        { shortTitle: "Switch boards", pressKey: [boardSwitch, "0-9"] },
        { shortTitle: "Expand summary", pressKey: ["I"] },
        { shortTitle: "Expand single comment", pressKey: ["O"] },
        { shortTitle: "Expand all comments", pressKey: ["SHIFT", "O"] },
        { shortTitle: "Toggle history events", pressKey: [cmdControl, "SHIFT", "H"] },
        { shortTitle: "View all links", pressKey: ["CTRL", "O"] },
        { shortTitle: "Write Comment", pressKey: ["CTRL", "M"] },
        { shortTitle: "Edit Description", pressKey: ["CTRL", "D"] },
        { shortTitle: "Edit Title", pressKey: ["F2"] },
        { shortTitle: "Delete comment", pressKey: [cmdControl, "SHIFT", "3"] },
        { shortTitle: "Paste as plain text", pressKey: [cmdControl, "SHIFT", "V"] },
        { shortTitle: "View all sub-tasks", pressKey: ["CTRL", "O"] },
        { shortTitle: "Share task", pressKey: [cmdControl, "S"] },
        { shortTitle: "Show task options", pressKey: [cmdControl, "SHIFT", "+"] },
        { shortTitle: "Private share link (URL only)", pressKey: [cmdControl, "SHIFT", ":"] },
        { shortTitle: "Private share link (Title + URL)", pressKey: [cmdControl, ":"] },
        { shortTitle: "Public share link (URL only)", pressKey: [cmdControl, "SHIFT", "."] },
        { shortTitle: "Public share link (Title + URL)", pressKey: [cmdControl, "."] },
        { shortTitle: "Copy task ID", pressKey: [cmdControl, "SHIFT", "I"] },
        { shortTitle: "Copy task title and ID", pressKey: [cmdControl, "I"] },
        { shortTitle: "Star task", pressKey: ["ALT", "S"] },
        { shortTitle: "Star comment", pressKey: [cmdControl, "SHIFT", "S"] },
        { shortTitle: "Pin comment", pressKey: [cmdControl, "SHIFT", "P"] },
        { shortTitle: "Follow task", pressKey: ["F"] },
        { shortTitle: "Unfollow task", pressKey: ["ALT", "F"] },
        { shortTitle: "Speech to text", pressKey: [cmdControl, "SHIFT", "D"] },
        { shortTitle: "Dictate and Improve", pressKey: [cmdControl, "SHIFT", "F"] },
        { shortTitle: "Discard draft", pressKey: [cmdControl, "SHIFT", ","] },
      ],
    },
    {
      title: "Saving new task",
      sub: [
        { shortTitle: "Save", pressKey: [cmdControl, "ENTER"] },
        { shortTitle: "Save and close", pressKey: [cmdControl, altOptions, "ENTER"] },
        { shortTitle: "Save and create new task", pressKey: [cmdControl, altOptions, "SHIFT", "ENTER"] },
      ],
    },
    {
      title: "AI Chat",
      sub: [
        { shortTitle: "Toggle AI chat", pressKey: [cmdControl, "SHIFT", "?"] },
        { shortTitle: "Reset session", pressKey: [cmdControl, "SHIFT", "O"] },
        { shortTitle: "Switch focus: AI chat / workspace", pressKey: ["CTRL", "Q"] },
        { shortTitle: "Send message", pressKey: ["Enter"] },
      ],
    },
    {
      title: "Agent Chat",
      sub: [
        // Ctrl+Tab also cycles agents but browsers (and, on Mac, the OS)
        // reserve it for switching tabs/apps before it ever reaches the
        // page, so Option/Alt+Arrow is the one advertised here as reliable
        // on every platform.
        { shortTitle: "Next agent", pressKey: [altOptions, "⭣"] },
        { shortTitle: "Previous agent", pressKey: [altOptions, "⭡"] },
        { shortTitle: "Send message", pressKey: [cmdControl, "ENTER"] },
        { shortTitle: "Open all links in latest reply", pressKey: ["CTRL", "O"] },
        { shortTitle: "Search tasks to reference", pressKey: ["@"] },
        { shortTitle: "Next team (any page)", pressKey: [altOptions, "SHIFT", "⭣"] },
        { shortTitle: "Previous team (any page)", pressKey: [altOptions, "SHIFT", "⭡"] },
      ],
    },
    {
      title: "Format",
      sub: [
        { shortTitle: "Tiptap menu", pressKey: ["/"] },
        { shortTitle: "Add Video Embed", pressKey: [cmdControl, "Y"] },
        { shortTitle: "Autocomplete sentence", pressKey: ["2xTAB"] },
        { shortTitle: "Add a line break", pressKey: ["SHIFT", "ENTER"] },
        { shortTitle: "Italicize", pressKey: [cmdControl, "I"] },
        { shortTitle: "Underline", pressKey: [cmdControl, "U"] },
        { shortTitle: "Quote", pressKey: [cmdControl, "SHIFT", "B"] },
        { shortTitle: "Highlight", pressKey: [cmdControl, "SHIFT", "H"] },
        { shortTitle: "Code", pressKey: [cmdControl, "E"] },
        { shortTitle: "Bullet list", pressKey: [cmdControl, "SHIFT", "8"] },
        { shortTitle: "Undo", pressKey: [cmdControl, "Z"] },
        { shortTitle: "Redo", pressKey: [cmdControl, "SHIFT", "Z"] },
        { shortTitle: "Apply normal text style", pressKey: [cmdControl, altOptions, "0"] },
        { shortTitle: "Apply heading style 1", pressKey: [cmdControl, altOptions, "1"] },
        { shortTitle: "Apply heading style 2", pressKey: [cmdControl, altOptions, "2"] },
        { shortTitle: "Apply heading style 3", pressKey: [cmdControl, altOptions, "3"] },
        { shortTitle: "Apply heading style 4", pressKey: [cmdControl, altOptions, "4"] },
        { shortTitle: "Apply heading style 5", pressKey: [cmdControl, altOptions, "5"] },
        { shortTitle: "Apply heading style 6", pressKey: [cmdControl, altOptions, "6"] },
        { shortTitle: "Code block", pressKey: [cmdControl, altOptions, "SHIFT", "C"] },
        { shortTitle: "Code", pressKey: [cmdControl, "SHIFT", "C"] },
      ],
    },
    {
      title: "Inbox",
      sub: [
        { shortTitle: "Select ALL", pressKey: [cmdControl, "SHIFT", "E"] },
        { shortTitle: "Select all from current split", pressKey: [cmdControl, "A"] },
        { shortTitle: "Select message", pressKey: ["X"] },
        { shortTitle: "Bulk Archive", pressKey: ["SHIFT", "E"] },
        { shortTitle: "Bulk Reminder", pressKey: ["SHIFT", "H"] },
        { shortTitle: "Archive notification", pressKey: ["E"] },
        { shortTitle: "Open task", pressKey: ["ENTER"] },
        { shortTitle: "Move focus down", pressKey: ["J"] },
        { shortTitle: "Move focus up", pressKey: ["K"] },
        { shortTitle: "Archive task", pressKey: [cmdControl, "E"] },
      ],
    },
    {
      title: "Calendar",
      sub: [
        { shortTitle: "Add task", pressKey: ["C"] },
        { shortTitle: "Update due date", pressKey: ["D"] },
        { shortTitle: "Next month/week", pressKey: ["I"] },
        { shortTitle: "Previous month/week", pressKey: ["U"] },
        { shortTitle: "Month view", pressKey: ["M"] },
        { shortTitle: "Week view", pressKey: ["W"] },
        { shortTitle: "Day view", pressKey: ["SHIFT", "D"] },
        { shortTitle: "Focus on today", pressKey: ["T"] },
        { shortTitle: "Focus on next day", pressKey: ["TAB"] },
        { shortTitle: "Focus on yesterday", pressKey: ["SHIFT", "TAB"] },
        { shortTitle: "Toggle through project filters", pressKey: [cmdControl, "[", "]"] },
        { shortTitle: "Select project from filters", pressKey: ["SPACE"] },
        { shortTitle: "Filter tasks", pressKey: ["SHIFT", "F"] },
        { shortTitle: "Save calendar view", pressKey: ["SHIFT", "V"] },
      ],
    },
    {
      title: "Unarchive View (g -> e)",
      sub: [
        { shortTitle: "Unarchive task", pressKey: [cmdControl, "E"] },
        { shortTitle: "Delete task", pressKey: ["#"] },
      ],
    },
  ];

  return shortcuts;
};
