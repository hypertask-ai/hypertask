import { KeyCodes } from "@/lib/constants/keyboard-handler";


export type ModifierKey = "shift" | "ctrl" | "alt" | "meta";

export interface IKeyboardShortcut {
  key: number;
  modifiers?: readonly ModifierKey[];
  excludeModifiers?: readonly ModifierKey[];
  description: string;
}

export interface PlatformShortcut {
  mac?: IKeyboardShortcut;
  windows?: IKeyboardShortcut;
  default: IKeyboardShortcut;
}

export interface MultiKeyShortcut {
  keys: readonly number[];
  modifiers?: readonly ModifierKey[];
  excludeModifiers?: readonly ModifierKey[];
  description: string;
}

export type ShortcutConfig =
  | IKeyboardShortcut
  | PlatformShortcut
  | MultiKeyShortcut;

export const keyboard_shortcuts = {
  dueDateModal: {
    default: {
      key: KeyCodes.D,
      modifiers: [],
      excludeModifiers: ["ctrl", "meta", "alt", "shift"],
      description: "Set due date",
    },
    taskDetail: {
      key: KeyCodes.D,
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Set due date",
    },
  },

  universal_movement: {
    left: {
      keys: [KeyCodes.ARROW_LEFT, KeyCodes.H],
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Move focus left",
    },
    right: {
      keys: [KeyCodes.ARROW_RIGHT, KeyCodes.L],
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Move focus right",
    },
    up: {
      keys: [KeyCodes.ARROW_UP, KeyCodes.K],
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Move focus up",
    },
    down: {
      keys: [KeyCodes.ARROW_DOWN, KeyCodes.J],
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Move focus down",
    },
  },

  universal_shift: {
    left: {
      keys: [KeyCodes.ARROW_LEFT, KeyCodes.H],
      modifiers: ["shift"],
      excludeModifiers: ["ctrl", "meta", "alt"],
      description: "Move item left",
    },
    right: {
      keys: [KeyCodes.ARROW_RIGHT, KeyCodes.L],
      modifiers: ["shift"],
      excludeModifiers: ["ctrl", "meta", "alt"],
      description: "Move item right",
    },
    up: {
      keys: [KeyCodes.ARROW_UP, KeyCodes.K],
      modifiers: ["shift"],
      excludeModifiers: ["ctrl", "meta", "alt"],
      description: "Move item up",
    },
    down: {
      keys: [KeyCodes.ARROW_DOWN, KeyCodes.J],
      modifiers: ["shift"],
      excludeModifiers: ["ctrl", "meta", "alt"],
      description: "Move item down",
    },
  },
  calendar: {
    add_task: {
      key: KeyCodes.C,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Add task",
    },
    month_view: {
      key: KeyCodes.M,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Toggle month view",
    },
    week_view: {
      key: KeyCodes.W,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Toggle week view",
    },
    day_view: {
      key: KeyCodes.D,
      modifiers: ["shift"],
      excludeModifiers: ["ctrl", "meta", "alt"],
      description: "Toggle day view",
    },
    previous_group: {
      key: KeyCodes.U,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Previous month/week",
    },
    next_group: {
      key: KeyCodes.I,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Next month/week",
    },
    focus_today: {
      key: KeyCodes.T,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Focus on today",
    },
    focus_previous_day: {
      key: KeyCodes.TAB,
      modifiers: ["shift"],
      excludeModifiers: ["ctrl", "meta", "alt"],
      description: "Focus on previous day",
    },
    focus_next_day: {
      key: KeyCodes.TAB,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Focus on next day",
    },
    focus_previous_week: {
      key: KeyCodes.TAB,
      modifiers: ["shift"],
      excludeModifiers: ["ctrl", "meta", "alt"],
      description: "Focus on previous week",
    },
    focus_next_week: {
      key: KeyCodes.TAB,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Focus on next week",
    },
    go_back: {
      key: KeyCodes.ESCAPE,
      modifiers: [],
      excludeModifiers: ["shift", "ctrl", "meta", "alt"],
      description: "Go back",
    },
    cycle_project: {
      key: KeyCodes.BACKTICK,
      modifiers: ["shift"],
      excludeModifiers: ["ctrl", "meta", "alt"],
      description: "Cycle project",
    },
  }
} as const;

export function getShortcut(
  shortcut: PlatformShortcut | IKeyboardShortcut,
  isApple: boolean = false
): IKeyboardShortcut {
  if ("mac" in shortcut || "windows" in shortcut) {
    const platformShortcut = shortcut as PlatformShortcut;
    if (isApple && platformShortcut.mac) {
      return platformShortcut.mac;
    }
    if (!isApple && platformShortcut.windows) {
      return platformShortcut.windows;
    }
    return platformShortcut.default;
  }
  return shortcut as IKeyboardShortcut;
}

function checkRequiredModifiers(
  event: KeyboardEvent,
  modifiers?: readonly ModifierKey[]
): boolean {
  if (!modifiers) return true;

  for (const modifier of modifiers) {
    switch (modifier) {
      case "shift":
        if (!event.shiftKey) return false;
        break;
      case "ctrl":
        if (!event.ctrlKey) return false;
        break;
      case "alt":
        if (!event.altKey) return false;
        break;
      case "meta":
        if (!event.metaKey) return false;
        break;
    }
  }
  return true;
}

function checkExcludedModifiers(
  event: KeyboardEvent,
  excludeModifiers?: readonly ModifierKey[]
): boolean {
  if (!excludeModifiers) return true;

  for (const modifier of excludeModifiers) {
    switch (modifier) {
      case "shift":
        if (event.shiftKey) return false;
        break;
      case "ctrl":
        if (event.ctrlKey) return false;
        break;
      case "alt":
        if (event.altKey) return false;
        break;
      case "meta":
        if (event.metaKey) return false;
        break;
    }
  }
  return true;
}

function getModifierDisplayName(
  modifier: ModifierKey,
  isApple: boolean
): string {
  switch (modifier) {
    case "shift":
      return "SHIFT";
    case "ctrl":
      return isApple ? "CMD" : "CTRL";
    case "alt":
      return isApple ? "OPT" : "ALT";
    case "meta":
      return isApple ? "CMD" : "META";
  }
}

function getKeyNameFromCode(keyCode: number): string | undefined {
  return Object.keys(KeyCodes).find(
    (key) => KeyCodes[key as keyof typeof KeyCodes] === keyCode
  );
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: ShortcutConfig,
  isApple: boolean = false
): boolean {
  if ("keys" in shortcut && Array.isArray(shortcut.keys)) {
    const multiKeyShortcut = shortcut as MultiKeyShortcut;

    if (!multiKeyShortcut.keys.includes(event.keyCode)) {
      return false;
    }

    return (
      checkRequiredModifiers(event, multiKeyShortcut.modifiers) &&
      checkExcludedModifiers(event, multiKeyShortcut.excludeModifiers)
    );
  }

  const shortcutConfig = getShortcut(shortcut as PlatformShortcut | IKeyboardShortcut, isApple);

  if (event.keyCode !== shortcutConfig.key) {
    return false;
  }

  return (
    checkRequiredModifiers(event, shortcutConfig.modifiers) &&
    checkExcludedModifiers(event, shortcutConfig.excludeModifiers)
  );
}

export function getShortcutDisplay(
  shortcut: ShortcutConfig,
  isApple: boolean = false
): string[] {
  const keys: string[] = [];
  let modifiers: readonly ModifierKey[] | undefined;
  let keyCodes: number[];

  if ("keys" in shortcut && Array.isArray(shortcut.keys)) {
    const multiKeyShortcut = shortcut as MultiKeyShortcut;
    modifiers = multiKeyShortcut.modifiers;
    keyCodes = [...multiKeyShortcut.keys];
  } else {
    const shortcutConfig = getShortcut(shortcut as PlatformShortcut | IKeyboardShortcut, isApple);
    modifiers = shortcutConfig.modifiers;
    keyCodes = [shortcutConfig.key];
  }

  if (modifiers) {
    for (const modifier of modifiers) {
      keys.push(getModifierDisplayName(modifier, isApple));
    }
  }

  const keyNames = keyCodes
    .map(keyCode => getKeyNameFromCode(keyCode))
    .filter(Boolean) as string[];

  keys.push(...keyNames);
  return keys;
}

export function createShortcutHandler(
  shortcut: ShortcutConfig,
  callback: (event: KeyboardEvent) => void,
  isApple: boolean = false
) {
  return (event: KeyboardEvent) => {
    if (matchesShortcut(event, shortcut, isApple)) {
      event.preventDefault();
      callback(event);
    }
  };
}
