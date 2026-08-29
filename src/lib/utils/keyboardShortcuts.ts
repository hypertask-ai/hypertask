import { KeyCodes } from "@/lib/constants/keyboard-handler";

/**
 * Keyboard Shortcut Utility
 * 
 * Centralized utility for managing keyboard shortcut combinations across the application.
 * Provides type-safe shortcuts and helper functions to check if keyboard events match shortcuts.
 */

/**
 * Modifier keys that can be part of a shortcut
 */
export type ModifierKey = "shift" | "ctrl" | "alt" | "meta";

/**
 * Configuration for a keyboard shortcut
 */
export interface IKeyboardShortcut {
  /** The main key code (e.g., KeyCodes.D) */
  key: number;
  /** Modifier keys that must be pressed */
  modifiers?: readonly ModifierKey[];
  /** Modifier keys that must NOT be pressed */
  excludeModifiers?: readonly ModifierKey[];
  /** Description of what this shortcut does */
  description: string;
}

/**
 * Platform-specific shortcut configuration
 * Some shortcuts may differ between Mac and Windows/Linux
 */
export interface PlatformShortcut {
  mac?: IKeyboardShortcut;
  windows?: IKeyboardShortcut;
  /** Default shortcut used if platform-specific not provided */
  default: IKeyboardShortcut;
}

/**
 * Shortcut configuration that supports multiple key options
 * Useful for shortcuts like arrow keys + vim keys (HJKL)
 */
export interface MultiKeyShortcut {
  /** Array of key codes that trigger the same action */
  keys: readonly number[];
  /** Modifier keys that must be pressed */
  modifiers?: readonly ModifierKey[];
  /** Modifier keys that must NOT be pressed */
  excludeModifiers?: readonly ModifierKey[];
  /** Description of what this shortcut does */
  description: string;
}

/**
 * Union type for all shortcut configurations
 */
export type ShortcutConfig =
  | IKeyboardShortcut
  | PlatformShortcut
  | MultiKeyShortcut;

/**
 * Collection of all keyboard shortcuts in the application
 */
export const keyboard_shortcuts = {
  /**
   * Due Date Modal Trigger
   * Opens/closes the due date modal
   * 
   * Note: Currently has inconsistencies:
   * - TaskDetail: Just 'D' (no modifiers)
   * - CreateTaskModal: 'SHIFT + D'
   * - Shortcuts help: 'SHIFT + D'
   * 
   * TODO: Standardize to one shortcut across all contexts
   */
  dueDateModal: {
    default: {
      key: KeyCodes.D,
      modifiers: [],
      excludeModifiers: ["ctrl", "meta", "alt", "shift"],
      description: "Set due date",
    },
    // Task detail page uses just 'D' without shift
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

  // Add more shortcuts here as needed
  // Example:
  // createTask: {
  //   default: {
  //     key: KeyCodes.C,
  //     excludeModifiers: ["shift", "ctrl", "meta"],
  //     description: "Create task",
  //   },
  // },
} as const;

/**
 * Get the appropriate shortcut for the current platform
 */
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

/**
 * Check if all required modifiers are pressed in a keyboard event
 */
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

/**
 * Check if no excluded modifiers are pressed in a keyboard event
 */
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

/**
 * Get the display name for a modifier key
 */
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

/**
 * Get the key name from a key code
 */
function getKeyNameFromCode(keyCode: number): string | undefined {
  return Object.keys(KeyCodes).find(
    (key) => KeyCodes[key as keyof typeof KeyCodes] === keyCode
  );
}

/**
 * Check if a keyboard event matches a given shortcut
 * 
 * @param event - The keyboard event to check
 * @param shortcut - The shortcut configuration to match against
 * @param isApple - Whether the user is on a Mac (for platform-specific shortcuts)
 * @returns true if the event matches the shortcut
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: ShortcutConfig,
  isApple: boolean = false
): boolean {
  // Handle MultiKeyShortcut first
  if ("keys" in shortcut && Array.isArray(shortcut.keys)) {
    const multiKeyShortcut = shortcut as MultiKeyShortcut;

    // Check if the pressed key is one of the allowed keys
    if (!multiKeyShortcut.keys.includes(event.keyCode)) {
      return false;
    }

    // Check required and excluded modifiers
    return (
      checkRequiredModifiers(event, multiKeyShortcut.modifiers) &&
      checkExcludedModifiers(event, multiKeyShortcut.excludeModifiers)
    );
  }

  // Existing logic for IKeyboardShortcut and PlatformShortcut
  // TypeScript narrowing: at this point, shortcut is not MultiKeyShortcut
  const shortcutConfig = getShortcut(shortcut as PlatformShortcut | IKeyboardShortcut, isApple);

  // Check main key matches
  if (event.keyCode !== shortcutConfig.key) {
    return false;
  }

  // Check required and excluded modifiers
  return (
    checkRequiredModifiers(event, shortcutConfig.modifiers) &&
    checkExcludedModifiers(event, shortcutConfig.excludeModifiers)
  );
}

/**
 * Helper to get display string for a shortcut (for tooltips/help)
 * 
 * @param shortcut - The shortcut configuration
 * @param isApple - Whether the user is on a Mac
 * @returns Array of key names for display (e.g., ["CMD", "SHIFT", "D"])
 */
export function getShortcutDisplay(
  shortcut: ShortcutConfig,
  isApple: boolean = false
): string[] {
  const keys: string[] = [];
  let modifiers: readonly ModifierKey[] | undefined;
  let keyCodes: number[];

  // Handle MultiKeyShortcut
  if ("keys" in shortcut && Array.isArray(shortcut.keys)) {
    const multiKeyShortcut = shortcut as MultiKeyShortcut;
    modifiers = multiKeyShortcut.modifiers;
    keyCodes = [...multiKeyShortcut.keys];
  } else {
    // Existing logic for other shortcut types
    // TypeScript narrowing: at this point, shortcut is not MultiKeyShortcut
    const shortcutConfig = getShortcut(shortcut as PlatformShortcut | IKeyboardShortcut, isApple);
    modifiers = shortcutConfig.modifiers;
    keyCodes = [shortcutConfig.key];
  }

  // Add modifiers in order
  if (modifiers) {
    for (const modifier of modifiers) {
      keys.push(getModifierDisplayName(modifier, isApple));
    }
  }

  // Add key names
  const keyNames = keyCodes
    .map(keyCode => getKeyNameFromCode(keyCode))
    .filter(Boolean) as string[];

  keys.push(...keyNames);
  return keys;
}

/**
 * Create a keyboard event handler that checks for a shortcut and calls a callback
 * 
 * @param shortcut - The shortcut to listen for
 * @param callback - Function to call when shortcut is pressed
 * @param isApple - Whether the user is on a Mac
 * @returns Event handler function
 */
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
