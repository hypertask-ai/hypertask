import { KeyCodes } from "@/lib/constants/keyboard-handler";

export type ShareShortcutId = "privateFormatted" | "privateUrl" | "publicFormatted" | "publicUrl";

export const SHARE_TASK_SHORTCUTS: Record<ShareShortcutId, { tooltip: string; apple: string[]; other: string[] }> = {
  privateFormatted: {
    tooltip: "Copy private link with title",
    apple: ["CMD", ";"],
    other: ["CTRL", ";"],
  },
  privateUrl: {
    tooltip: "Copy private link",
    apple: ["CMD", "SHIFT", ";"],
    other: ["CTRL", "SHIFT", ";"],
  },
  publicFormatted: {
    tooltip: "Copy public link with title",
    apple: ["CMD", "."],
    other: ["CTRL", "."],
  },
  publicUrl: {
    tooltip: "Copy public link",
    apple: ["CMD", "SHIFT", "."],
    other: ["CTRL", "SHIFT", "."],
  },
};

export const shareTaskShortcutKeys = (id: ShareShortcutId, isApple: boolean): string[] =>
  [...SHARE_TASK_SHORTCUTS[id][isApple ? "apple" : "other"]];

export const shareTaskShortcutFor = ({ cmdControl, keyCode, shiftKey }: {
  cmdControl: boolean;
  keyCode: number;
  shiftKey: boolean;
}): ShareShortcutId | null => {
  if (!cmdControl) return null;
  if (shiftKey) {
    if (keyCode === KeyCodes.SEMICOLON) return "privateUrl";
    if (keyCode === KeyCodes.PERIOD) return "publicUrl";
    return null;
  }
  if (keyCode === KeyCodes.SEMICOLON || keyCode === KeyCodes.COMMA) return "privateFormatted";
  if (keyCode === KeyCodes.PERIOD) return "publicFormatted";
  return null;
};
