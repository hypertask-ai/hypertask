import { useUIStateManager } from '@/hooks/General/useUIStateManager';

export const useGlobalUIState = () => {
  const aiChat = useUIStateManager('aiChatInterface');
  const announcements = useUIStateManager('announcements');
  const keyboardShortcuts = useUIStateManager('keyboardShortcuts');
  const rightSidebar = useUIStateManager('rightSidebar');
  const leftSidebar = useUIStateManager('leftSidebar');
  const boardManager = useUIStateManager('boardManager');
  const scrollSettings = useUIStateManager('scrollSettings');

  return {
    toggleAIChatInterface: aiChat.toggle,
    openAIChatInterface: aiChat.open,
    showAiChatInterface: aiChat.isOpen,
    closeAIChatInterface: aiChat.close,

    toggleAnnouncements: announcements.toggle,
    openAnnouncements: announcements.open,
    showAnnouncements: announcements.isOpen,
    closeAnnouncements: announcements.close,
    
    toggleKeyboardShortcuts: keyboardShortcuts.toggle,
    showShortcuts: keyboardShortcuts.isOpen,
    closeKeyboardShortcuts: keyboardShortcuts.close,
    
    toggleRightSidebar: rightSidebar.toggle,
    showSidebar: rightSidebar.isOpen,
    closeRightSidebar: rightSidebar.close,
    
    toggleLeftSidebar: leftSidebar.toggle,
    showBoardManager: leftSidebar.isOpen,
    closeLeftSidebar: leftSidebar.close,

    
    toggleScrollSettings: scrollSettings.toggle,
    showScrollSettings: scrollSettings.isOpen,
    closeScrollSettings: scrollSettings.close,
    
    closeAllUI: () => {
      aiChat.close();
      announcements.close();
      keyboardShortcuts.close();
      rightSidebar.close();
      leftSidebar.close();
      boardManager.close();
      scrollSettings.close();
    },
  };
};
