import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { matchesShortcut as matchesShortcutUtil, getShortcutDisplay as getShortcutDisplayUtil, PlatformShortcut, IKeyboardShortcut } from "@/lib/utils/keyboardShortcuts";

/**
 * React hook for keyboard shortcuts
 * Automatically includes isApple from device context, so you don't need to pass it every time
 */
export const useKeyboardShortcuts = () => {
  const isApple = useDeviceContext();

  /**
   * Check if a keyboard event matches a given shortcut
   * Automatically uses isApple from context
   */
  const matchesShortcut = (
    event: KeyboardEvent,
    shortcut: PlatformShortcut | IKeyboardShortcut
  ): boolean => {
    return matchesShortcutUtil(event, shortcut, isApple);
  };

  /**
   * Get display string for a shortcut (for tooltips/help)
   * Automatically uses isApple from context
   */
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
