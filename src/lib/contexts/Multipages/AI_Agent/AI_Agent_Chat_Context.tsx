"use client";
import type { FileItem } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import { useAiChat } from "@/hooks/MultiPages/AIChat/useAiChat";
import { useRecoilState } from "@/lib/state";
import { aiChatPendingPromptAtom } from "@/store";
import { TAiModal } from "@/models/AI_Task_writer_model";
import { IChatMessage, IChatSession, MentionItem } from "@/models/model";
// Type-only: a value import here would pull tiptap back into every page's
// initial chunk and defeat the dynamic mount below (HTPR-4508).
import type { Editor } from "@tiptap/react";
import dynamic from "next/dynamic";
import {
  ChangeEvent,
  createContext,
  Dispatch,
  ReactNode,
  RefObject,
  SetStateAction,
  useContext,
  useEffect,
  useRef,
} from "react";

export interface Message {
  id: string;
  content: string;
  role: "human" | "assistant";
  timestamp: Date;
}

// Define the context type
interface ChatContextType {
  isTyping: boolean;
  isRecording: boolean;
  queuedMessages: {
    id: string;
    content: string;
    html: string;
    files: FileItem[];
  }[];
  removeQueuedMessage: (id: string) => void;
  isByokBlocked: boolean;
  showAiChatInterface: boolean;
  activeSession: string | null;
  chatHistoryReady: boolean;
  minimized: boolean;
  minimizeChat: () => void;
  restoreChat: () => void;
  isSidebarMode: boolean;
  setIsSidebarMode: Dispatch<SetStateAction<boolean>>;
  chatMounted: boolean;
  setChatMounted: Dispatch<SetStateAction<boolean>>;
  currentAiOption: TAiModal;
  displayAiOptions: TAiModal[];
  editor: Editor | null;
  editorEnabled: boolean;
  editorMountProps: {
    contextCallback: (node: any) => void;
    projectId?: number;
    onEditor: (editor: Editor | null) => void;
  };
  sessions: IChatSession[];
  currentSession: IChatSession | undefined;
  showWelcomeScreen: boolean;
  contextList: MentionItem[];
  agentStatus: string | undefined;
  showScrollUpIndicator: boolean;
  isDetailPage: boolean;
  showRenameChatModal: boolean;
  setShowAIChat: Dispatch<SetStateAction<boolean>>;
  setAiChatAutoOpenSuppressed: Dispatch<SetStateAction<boolean>>;
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>;
  togglePopover: () => void;
  toggleSidebarMode: () => void;
  dropDownButtonAICallback: (selectedAiModel: TAiModal) => void;
  handleRemoveContext: (index: number) => void;
  handleAddContext(): void;
  handleSendMessage: (retryContent?: string) => Promise<void>;
  tiptapKeydown: (event: any) => void;
  layoutKeydown: (event: any) => void;
  handleMessageListScroll: (element?: HTMLElement | null) => void;
  registerMessageListRef: (element: HTMLDivElement | null) => void;
  scrollMessagesToBottom: (behavior?: ScrollBehavior) => void;
  copyResponse: (message: IChatMessage) => void;
  editMessage: (message: IChatMessage) => void;
  createTaskFromResponse: (message: IChatMessage) => void;
  handleCancelStream: () => Promise<void>;
  retryStream: (message?: IChatMessage) => void
  audioTiptapCallback: (text: string, setContent?: boolean) => void;
  toggleRecording: (val: boolean) => void;
  startNewSession: () => Promise<void>;
  selectSession: (sessionId: string) => void;
  toggleRenameChatModal: () => void;
  renameChat: (newTitle: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  fileItems: FileItem[];
  files: File[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  triggerFileInput: () => void;
  handleFileUpload: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDroppedFiles: (files: File[]) => Promise<void>;
  removeFile: (name: string) => void;
  clearFiles: () => void;
  resetFiles: (newFiles?: FileItem[]) => void;
  setFileItems: Dispatch<SetStateAction<FileItem[]>>;
  handleAttachmentClick: (e?: unknown) => void;
}

// ponytail: ChatProvider wraps every route, so building the chat editor inline
// put the whole tiptap/ProseMirror stack (~250 KB) in the initial chunk of every
// page even with the chat closed. It loads here instead, and only after the chat
// has been opened once — the flag latches, so closing the chat keeps the draft
// alive rather than paying to rebuild the editor (HTPR-4508).
const AiChatEditorMount = dynamic(
  () => import("@/hooks/MultiPages/AIChat/AiChatEditorMount"),
  { ssr: false }
);

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const contextProps = useAiChat();
  const layoutKeydownRef = useRef(contextProps.layoutKeydown);
  layoutKeydownRef.current = contextProps.layoutKeydown;

  useEffect(() => {
    // Tiptap consumes Control+Q before a bubbling document listener can see it.
    // Route only this established focus shortcut during capture; every other AI
    // shortcut keeps the existing bubble-phase behavior (HTPR-5204 follow-up).
    const handleLayoutKeydownCapture = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "q" ||
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat
      ) {
        return;
      }

      layoutKeydownRef.current(event);
      if (event.defaultPrevented) event.stopPropagation();
    };
    const handleLayoutKeydown = (event: KeyboardEvent) => {
      layoutKeydownRef.current(event);
    };
    document.addEventListener("keydown", handleLayoutKeydownCapture, true);
    document.addEventListener("keydown", handleLayoutKeydown);
    return () => {
      document.removeEventListener("keydown", handleLayoutKeydownCapture, true);
      document.removeEventListener("keydown", handleLayoutKeydown);
    };
  }, []);

  // Consume a query handed over from Search's "Ask AI": send it into this single
  // general chat, then clear it. Done here (the one ChatProvider instance) rather
  // than in the composer so it can't double-send across mounts. Wait until the
  // chat is ready — a session exists (handleSendMessage resolves its own), BYOK
  // isn't blocking, and nothing is streaming — so the query is never dropped or
  // overlapped; the effect re-runs and fires once readiness flips.
  const [pendingAiChatPrompt, setPendingAiChatPrompt] = useRecoilState(
    aiChatPendingPromptAtom
  );
  const handleSendMessageRef = useRef(contextProps.handleSendMessage);
  handleSendMessageRef.current = contextProps.handleSendMessage;
  const { editor, fileItems } = contextProps;
  useEffect(() => {
    if (
      !pendingAiChatPrompt ||
      contextProps.isByokBlocked ||
      contextProps.isTyping ||
      !contextProps.sessions.length
    ) {
      return;
    }
    const query = pendingAiChatPrompt;
    setPendingAiChatPrompt(null);
    // handleSendMessage() sends the composer's existing attachments and clears
    // its editor, so only auto-send when the composer is CLEAN — otherwise we'd
    // mis-send the user's attachments or wipe their unsent draft. With an empty
    // composer that only has attachments, drop the query in for review; with a
    // real draft present, leave everything untouched (the chat is already open).
    const hasDraft = !!editor && !editor.isEmpty;
    const hasAttachments = fileItems.length > 0;
    if (!hasDraft && !hasAttachments) {
      void handleSendMessageRef.current(query).catch(() => {});
    } else if (!hasDraft && editor) {
      editor.commands.setContent(query);
      editor.commands.focus("end");
    }
  }, [
    pendingAiChatPrompt,
    contextProps.isByokBlocked,
    contextProps.isTyping,
    contextProps.sessions.length,
    editor,
    fileItems,
    setPendingAiChatPrompt,
  ]);

  return (
    <ChatContext.Provider
      value={{
        ...contextProps,
      }}
    >
      {contextProps.editorEnabled && (
        <AiChatEditorMount {...contextProps.editorMountProps} />
      )}
      {children}
    </ChatContext.Provider>
  );
};

export const useAiChatContext = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useAiChatContext must be used within a ChatProvider");
  }
  return context;
};
