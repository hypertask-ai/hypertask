import { useCallback, useContext } from 'react';
import { usePathname } from 'next/navigation';
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { useRecoilState, useResetRecoilState, useSetRecoilState } from '@/lib/state';
import {
  aiChatAutoOpenSuppressedAtom,
  aiChatPinnedAtom,
  showBoardManagerAtom,
  showShortcutsAtom,
  showCommandsAtom,
  showSidebarAtom,
  showAIChatInterfaceAtom,
  showAnnouncementsAtom,
  showScrollSettingModalAtom,
} from '@/store';

export type UIStateKey = 
  | 'aiChatInterface'
  | 'announcements'
  | 'keyboardShortcuts' 
  | 'rightSidebar'
  | 'leftSidebar'
  | 'boardManager'
  | 'scrollSettings';

export interface UIStateConfig {
  /** Whether to close other UI elements when opening this one */
  closeOthers?: boolean;
  /** Specific UI elements to close when opening this one */
  closeSpecific?: UIStateKey[];
  /** Whether to reset commands when opening this one */
  resetCommands?: boolean;
  /** Custom toggle behavior */
  customToggle?: (currentValue: boolean) => boolean;
}

const UI_STATE_CONFIG: Record<UIStateKey, UIStateConfig> = {
  aiChatInterface: {
    closeOthers: true,
    resetCommands: true,
  },
  announcements: {
    closeOthers: true,
    resetCommands: true,
  },
  keyboardShortcuts: {
    closeOthers: true,
    resetCommands: true,
  },
  rightSidebar: {
    closeOthers: false, // Right sidebar doesn't close others
  },
  leftSidebar: {
    closeOthers: true,
    resetCommands: true,
  },
  boardManager: {
    closeOthers: true,
    resetCommands: true,
  },
  scrollSettings: {
    closeOthers: true,
    resetCommands: true,
  },
};

/**
 * Centralized UI State Manager Hook
 * 
 * Provides a unified interface for managing UI state with consistent behavior.
 * Automatically handles closing other UI elements and resetting commands.
 * 
 * @example
 * ```tsx
 * const { toggle, isOpen, close, open } = useUIStateManager('aiChatInterface');
 * 
 * // Toggle with automatic cleanup
 * <button onClick={toggle}>Toggle AI Chat</button>
 * 
 * // Check state
 * {isOpen && <AIChatInterface />}
 * 
 * // Manual control
 * <button onClick={open}>Open</button>
 * <button onClick={close}>Close</button>
 * ```
 */
export const useUIStateManager = (stateKey: UIStateKey) => {
  const pathname = usePathname();
  const isMbl = useContext(MobileViewContext);
  const isLoginPage = pathname?.startsWith('/login');

  // Get the appropriate atom based on stateKey
  const getAtom = () => {
    switch (stateKey) {
      case 'aiChatInterface':
        return showAIChatInterfaceAtom;
      case 'announcements':
        return showAnnouncementsAtom;
      case 'keyboardShortcuts':
        return showShortcutsAtom;
      case 'rightSidebar':
        return showSidebarAtom;
      case 'leftSidebar':
        return showBoardManagerAtom; // Left sidebar controls board manager
      case 'boardManager':
        return showBoardManagerAtom;
      case 'scrollSettings':
        return showScrollSettingModalAtom;
      default:
        throw new Error(`Unknown UI state key: ${stateKey}`);
    }
  };

  const [isOpen, setIsOpen] = useRecoilState(getAtom());
  const setAiChatAutoOpenSuppressed = useSetRecoilState(aiChatAutoOpenSuppressedAtom);
  const setAiChatPinned = useSetRecoilState(aiChatPinnedAtom);
  const resetCommands = useResetRecoilState(showCommandsAtom);
  
  // Get reset functions for other UI elements
  const resetShortcuts = useResetRecoilState(showShortcutsAtom);
  const resetBoardManager = useResetRecoilState(showBoardManagerAtom);
  const resetSidebar = useResetRecoilState(showSidebarAtom);
  const resetAIChat = useResetRecoilState(showAIChatInterfaceAtom);
  const resetAnnouncements = useResetRecoilState(showAnnouncementsAtom);
  const resetScrollSettings = useResetRecoilState(showScrollSettingModalAtom);

  const config = UI_STATE_CONFIG[stateKey];

  /**
   * Close other UI elements based on configuration
   */
  const closeOthers = useCallback(() => {
    if (!config.closeOthers) return;

    // Close all other UI elements
    resetShortcuts();
    resetBoardManager();
    resetSidebar();
    // On desktop the AI chat is a docked sidebar, not a modal — it shares the
    // screen with the board list, announcements and shortcuts, so opening those
    // (rail buttons, Ctrl+B) must not close it. On mobile it's a bottom sheet
    // that would stack on top of the panel being opened, so it still yields.
    if (isMbl) resetAIChat();
    if (stateKey !== 'announcements') resetAnnouncements();
    resetScrollSettings();

    // Reset commands if configured
    if (config.resetCommands) {
      resetCommands();
    }
  }, [
    config,
    stateKey,
    isMbl,
    resetShortcuts,
    resetBoardManager,
    resetSidebar,
    resetAIChat,
    resetAnnouncements,
    resetScrollSettings,
    resetCommands,
  ]);

  /**
   * Toggle the UI element with automatic cleanup
   */
  const toggle = useCallback(() => {
    if (stateKey === 'aiChatInterface' && isLoginPage && !isOpen) return;
    closeOthers();

    if (stateKey === 'aiChatInterface') {
      const nextIsOpen = !isOpen;
      setAiChatAutoOpenSuppressed(!nextIsOpen);
      if (!nextIsOpen) setAiChatPinned(false);
      setIsOpen(nextIsOpen);
      return;
    }

    if (config.customToggle) {
      setIsOpen(config.customToggle);
    } else {
      setIsOpen(prev => !prev);
    }
  }, [
    config,
    stateKey,
    isLoginPage,
    isOpen,
    closeOthers,
    setAiChatAutoOpenSuppressed,
    setAiChatPinned,
    setIsOpen,
  ]);

  /**
   * Open the UI element with automatic cleanup
   */
  const open = useCallback(() => {
    if (stateKey === 'aiChatInterface' && isLoginPage) return;
    closeOthers();
    if (stateKey === 'aiChatInterface') setAiChatAutoOpenSuppressed(false);
    setIsOpen(true);
  }, [stateKey, isLoginPage, closeOthers, setAiChatAutoOpenSuppressed, setIsOpen]);

  /**
   * Close the UI element
   */
  const close = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  /**
   * Close specific UI elements
   */
  const closeSpecific = (elements: UIStateKey[]) => {
    elements.forEach(element => {
      switch (element) {
        case 'aiChatInterface':
          resetAIChat();
          break;
        case 'announcements':
          resetAnnouncements();
          break;
        case 'keyboardShortcuts':
          resetShortcuts();
          break;
        case 'rightSidebar':
          resetSidebar();
          break;
        case 'leftSidebar':
        case 'boardManager':
          resetBoardManager();
          break;
        case 'scrollSettings':
          resetScrollSettings();
          break;
      }
    });
  };

  return {
    isOpen,
    toggle,
    open,
    close,
    closeOthers,
    closeSpecific,
  };
};

/**
 * Utility function for managing multiple UI states
 * 
 * Note: This is not a hook due to React Hook rules.
 * Use individual useUIStateManager hooks for each state you need.
 * 
 * @example
 * ```tsx
 * const aiChat = useUIStateManager('aiChatInterface');
 * const shortcuts = useUIStateManager('keyboardShortcuts');
 * 
 * const closeAll = () => {
 *   aiChat.close();
 *   shortcuts.close();
 * };
 * ```
 */
