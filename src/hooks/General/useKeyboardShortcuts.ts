import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { matchesShortcut as matchesShortcutUtil, getShortcutDisplay as getShortcutDisplayUtil, PlatformShortcut, IKeyboardShortcut } from "@/lib/utils/keyboardShortcuts";

export const useKeyboardShortcuts = () => {
  const isApple = useDeviceContext();

  const matchesShortcut = (
    event: KeyboardEvent,
    shortcut: PlatformShortcut | IKeyboardShortcut
  ): boolean => {
    return matchesShortcutUtil(event, shortcut, isApple);
  };

  const getShortcutDisplay = (
    shortcut: PlatformShortcut | IKeyboardShortcut
  ): string[] => {
    return getShortcutDisplayUtil(shortcut, isApple);
  };

  return {
    matchesShortcut,
    getShortcutDisplay,
    isApple,
  };
};
