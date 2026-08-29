import { useUIStateManager } from '@/hooks/General/useUIStateManager';

/**
 * Global UI State Management Hook
 * 
 * Provides all UI state management functions for the GlobalProvider component.
 * This replaces the individual toggle functions with a centralized approach.
 */
export const useGlobalUIState = () => {
  const aiChat = useUIStateManager('aiChatInterface');
  const announcements = useUIStateManager('announcements');
  const keyboardShortcuts = useUIStateManager('keyboardShortcuts');
  const rightSidebar = useUIStateManager('rightSidebar');
  const leftSidebar = useUIStateManager('leftSidebar');
  const boardManager = useUIStateManager('boardManager');
  const scrollSettings = useUIStateManager('scrollSettings');

  return {
    // AI Chat Interface
    toggleAIChatInterface: aiChat.toggle,
    openAIChatInterface: aiChat.open,
    showAiChatInterface: aiChat.isOpen,
    closeAIChatInterface: aiChat.close,

    // Announcements
    toggleAnnouncements: announcements.toggle,
    openAnnouncements: announcements.open,
    showAnnouncements: announcements.isOpen,
    closeAnnouncements: announcements.close,
    
    // Keyboard Shortcuts
    toggleKeyboardShortcuts: keyboardShortcuts.toggle,
    showShortcuts: keyboardShortcuts.isOpen,
    closeKeyboardShortcuts: keyboardShortcuts.close,
    
    // Right Sidebar
    toggleRightSidebar: rightSidebar.toggle,
    showSidebar: rightSidebar.isOpen,
    closeRightSidebar: rightSidebar.close,
    
    // Left Sidebar / Board Manager
    toggleLeftSidebar: leftSidebar.toggle,
    showBoardManager: leftSidebar.isOpen,
    closeLeftSidebar: leftSidebar.close,

    
    // Scroll Settings
    toggleScrollSettings: scrollSettings.toggle,
    showScrollSettings: scrollSettings.isOpen,
    closeScrollSettings: scrollSettings.close,
    
    // Utility functions
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
