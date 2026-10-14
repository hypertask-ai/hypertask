import { useCallback, useContext } from 'react';
import { usePathname } from 'next/navigation';
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { useRecoilState, useResetRecoilState, useSetRecoilState } from '@/lib/state';
import {
  aiChatAutoOpenSuppressedAtom,
  aiChatExplicitOpenAtAtom,
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
  closeOthers?: boolean;
  closeSpecific?: UIStateKey[];
  resetCommands?: boolean;
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
    closeOthers: false,
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

export const useUIStateManager = (stateKey: UIStateKey) => {
  const pathname = usePathname();
  const isMbl = useContext(MobileViewContext);
  const isLoginPage = pathname?.startsWith('/login');

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
        return showBoardManagerAtom;
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
  const setAiChatExplicitOpenAt = useSetRecoilState(aiChatExplicitOpenAtAtom);
  const resetCommands = useResetRecoilState(showCommandsAtom);
  
  const resetShortcuts = useResetRecoilState(showShortcutsAtom);
  const resetBoardManager = useResetRecoilState(showBoardManagerAtom);
  const resetSidebar = useResetRecoilState(showSidebarAtom);
  const resetAIChat = useResetRecoilState(showAIChatInterfaceAtom);
  const resetAnnouncements = useResetRecoilState(showAnnouncementsAtom);
  const resetScrollSettings = useResetRecoilState(showScrollSettingModalAtom);

  const config = UI_STATE_CONFIG[stateKey];

  const closeOthers = useCallback(() => {
    if (!config.closeOthers) return;

    resetShortcuts();
    resetBoardManager();
    resetSidebar();
    if (isMbl) resetAIChat();
    if (stateKey !== 'announcements') resetAnnouncements();
    resetScrollSettings();

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

  const toggle = useCallback(() => {
    if (stateKey === 'aiChatInterface' && isLoginPage && !isOpen) return;
    closeOthers();

    if (stateKey === 'aiChatInterface') {
      const nextIsOpen = !isOpen;
      setAiChatAutoOpenSuppressed(!nextIsOpen);
      if (!nextIsOpen) setAiChatPinned(false);
      if (nextIsOpen) setAiChatExplicitOpenAt(Date.now());
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
    setAiChatExplicitOpenAt,
    setIsOpen,
  ]);

  const open = useCallback(() => {
    if (stateKey === 'aiChatInterface' && isLoginPage) return;
    closeOthers();
    if (stateKey === 'aiChatInterface') {
      setAiChatAutoOpenSuppressed(false);
      setAiChatExplicitOpenAt(Date.now());
    }
    setIsOpen(true);
  }, [stateKey, isLoginPage, closeOthers, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, setIsOpen]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

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
