
export const aiTaskWriterConfig = {
  history: {
    maxHistoryItems: 10,
    contextWindowSize: 3,
    autoClearOnAccept: true,
    autoClearOnDiscard: true,
  },
  fontSizes: {
    icon: "24px",
    moderateIcon: "18px",
    input: "14px",
    layout: "12px",
    response: "14px",
    placeholder: "37px",
  },

  navigation: {
    showNavigator: true,
    showAcceptButton: true,
    showResponseCounter: true,
  },

  ai: {
    defaultLoadingText: "Thinking...",
    maxContextLength: 2000,
  },

  ui: {
    autoFocus: true,
    showModeToggle: true,
    enableKeyboardShortcuts: true,
  },


  shortcutsAndTooltips: {
    submit: "ENTER",
    toggleMode: "CMD/CTRL+J",
    audioRecord: "SHIFT+CMD/CTRL+D",
    audioImprove: "SHIFT+CMD/CTRL+F",
    ai_chat: {
      minimize_button: (isApple: boolean) => {
        return {
          text: "Minimize Chat",
          keyCombination: [`${!isApple ? "CTRL" : "CMD"}`, "SHIFT", "?"],
          left: -245,
          bottom: -45,
        };
      },
      toggle_sidebar_button: (isSidebarMode: boolean) => {
        return {
          text: isSidebarMode ? "Toggle Floating View" : "Toggle Sidebar View",
          keyCombination: [],
          left: -180,
          bottom: -45,
        };
      },
      delete_chat_button: {
        text: "Delete Chat",
        keyCombination: [],
        left: -120,
        bottom: -45,
      },
      rename_chat_button: {
        text: "Rename Chat",
        keyCombination: [],
        tool_left: -100,
        tool_bottom: -45,
      },
      new_chat_button: (isApple: boolean) => {
        return {
          text: "New Chat",
          keyCombination: [`${!isApple ? "CTRL" : "CMD"}`, "SHIFT", "O"],
          left: -200,
          bottom: -45,
        };
      },
      send_button: {
        text: "Send Message",
        keyCombination: ["ENTER"],
        left: -160,
        bottom: 25,
      },
      cancel_stream_button: {
        text: "Cancel Stream",
        keyCombination: ["ESCAPE"],
        left: -160,
        bottom: 25,
      },
      attachment_button: (isApple: boolean) => {
        return {
          text: "Attach Files",
          keyCombination: [`${!isApple ? "CTRL" : "CMD"}`, "U"],
          left: -160,
          bottom: 25,
        };
      },
      add_context_button: {
        text: "Add Context",
        keyCombination: [],
        left: -60,
        bottom: 32,
      },
    },
  },

  placeholders: {
    taskWriter: {
      default: "What is this task about?",
    },
    writeWithAI: {
      default: "What do you want to write about?",
    },
  },

  modal: {
    showConfirmationOnEscape: true,
    confirmationText: "Discard AI Response?",
    confirmationSubtext: "The AI Response will not be saved",
  },

  elementIds: {
    createTaskModalTrigger: "create-task-modal-ai-writer-trigger-internal",
  },

  tiptapDimension: {
    createTaskModal: {
      maxHeight: "60svh",
      minHeight: "80px",
    },
    taskDetail: {
      maxHeight: "full",
      minHeight: "64px",
    },
  },
} as const;

export type AITaskWriterConfig = typeof aiTaskWriterConfig;
