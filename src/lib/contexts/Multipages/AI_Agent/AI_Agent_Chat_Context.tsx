"use client";
import type { FileItem } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import { useAiChat } from "@/hooks/MultiPages/AIChat/useAiChat";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6936_ASK_AI_FULLSCREEN_FLAG } from "@/lib/flags/keys";
import { isControlQFocusShortcut } from "@/lib/aiChat/chatFocusShortcut";
import { useRecoilState } from "@/lib/state";
import { aiChatPendingPromptAtom } from "@/store";
import type { TeamBillingSnapshot } from "@/lib/deriveCurrentBoardBilling";
import { TAiModal } from "@/models/AI_Task_writer_model";
import { IChatMessage, IChatSession, MentionItem } from "@/models/model";
import type { Editor } from "@tiptap/react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import {
  ChangeEvent,
  Dispatch,
  memo,
  ReactNode,
  RefObject,
  SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChatContext, useAiChatContext } from "./chatContext";

export { useAiChatContext };

export interface Message {
  id: string;
  content: string;
  role: "human" | "assistant";
  timestamp: Date;
}

export interface ChatContextType {
  isTyping: boolean;
  sendSettledVersion: number;
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
  modelTeamId: string | null;
  modelBilling: TeamBillingSnapshot | null;
  displayAiOptions: TAiModal[];
  editor: Editor | null;
  editorEnabled: boolean;
  editorMountProps: {
    contextCallback: (node: any) => void;
    projectId?: number;
    onEditor: (editor: Editor | null) => void;
  };
  sessions: IChatSession[];
  sessionPagingEnabled: boolean;
  historySessions: (Pick<IChatSession, "id" | "title" | "updatedAt" | "createdAt" | "projectId" | "agentId"> & {
    hasMessages?: boolean;
    messages?: IChatMessage[];
  })[];
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  pagingError: boolean;
  loadMoreSessions: () => Promise<void>;
  refreshHistorySessions: () => Promise<void>;
  currentSession: IChatSession | undefined;
  showWelcomeScreen: boolean;
  isSessionPending: boolean;
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
  handleSendMessage: (retryContent?: string, options?: { preserveComposer?: boolean }) => Promise<boolean>;
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
  startNewSession: () => Promise<IChatSession | undefined>;
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

const AiChatEditorMount = dynamic(
  () => import("@/hooks/MultiPages/AIChat/AiChatEditorMount"),
  { ssr: false }
);

export const ChatRuntime = memo(function ChatRuntime({
  onValue,
  children,
}: {
  onValue: (value: ChatContextType | undefined) => void;
  children?: ReactNode;
}) {
  const contextProps = useAiChat();
  const layoutKeydownRef = useRef(contextProps.layoutKeydown);
  layoutKeydownRef.current = contextProps.layoutKeydown;

  useEffect(() => {
    const handleLayoutKeydownCapture = (event: KeyboardEvent) => {
      if (!isControlQFocusShortcut(event)) return;
      if (event.target instanceof HTMLElement && event.target.closest("[data-ai-chat-surface]")) return;

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

  const [pendingAiChatPrompt, setPendingAiChatPrompt] = useRecoilState(
    aiChatPendingPromptAtom
  );
  const handleSendMessageRef = useRef(contextProps.handleSendMessage);
  handleSendMessageRef.current = contextProps.handleSendMessage;
  const { editor, fileItems } = contextProps;
  const pathname = usePathname();
  const askAiFullscreenEnabled = useFlag(HTPR_6936_ASK_AI_FULLSCREEN_FLAG);
  const [failedFullScreenQuery, setFailedFullScreenQuery] = useState<string | null>(null);
  useEffect(() => {
    if (!failedFullScreenQuery || !editor) return;
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      content: [{ type: "text", text: failedFullScreenQuery }],
    });
    editor.commands.focus("end");
    setFailedFullScreenQuery(null);
  }, [failedFullScreenQuery, editor]);
  const pendingFullScreenSessionRef = useRef<{
    prompt: typeof pendingAiChatPrompt;
    previousSessionId: string | null;
    sending: boolean;
  } | null>(null);
  useEffect(() => {
    if (pendingAiChatPrompt && typeof pendingAiChatPrompt !== "string" && !askAiFullscreenEnabled) {
      pendingFullScreenSessionRef.current = null;
      setPendingAiChatPrompt(null);
      return;
    }
    if (
      !pendingAiChatPrompt ||
      contextProps.isByokBlocked ||
      contextProps.isTyping ||
      !contextProps.sessions.length ||
      (contextProps.sessionPagingEnabled && !contextProps.chatHistoryReady)
    ) {
      return;
    }
    if (typeof pendingAiChatPrompt !== "string") {
      if (pathname !== "/chat" || !contextProps.chatHistoryReady) return;
      if (pendingFullScreenSessionRef.current?.prompt !== pendingAiChatPrompt) {
        pendingFullScreenSessionRef.current = {
          prompt: pendingAiChatPrompt,
          previousSessionId: contextProps.currentSession?.id ?? contextProps.activeSession,
          sending: false,
        };
        void contextProps.startNewSession().catch(() => {
          if (pendingFullScreenSessionRef.current?.prompt !== pendingAiChatPrompt) return;
          pendingFullScreenSessionRef.current = null;
          setPendingAiChatPrompt((pending) => pending === pendingAiChatPrompt ? null : pending);
          setFailedFullScreenQuery(pendingAiChatPrompt.query);
        });
        return;
      }
      if (pendingFullScreenSessionRef.current.sending) return;
      if (
        !contextProps.currentSession ||
        contextProps.currentSession.id === pendingFullScreenSessionRef.current.previousSessionId
      ) return;
    }
    const query = typeof pendingAiChatPrompt === "string" ? pendingAiChatPrompt : pendingAiChatPrompt.query;
    if (typeof pendingAiChatPrompt !== "string") {
      const handoff = pendingFullScreenSessionRef.current!;
      const recoverQuestion = () => {
        if (pendingFullScreenSessionRef.current !== handoff) return;
        pendingFullScreenSessionRef.current = null;
        setPendingAiChatPrompt((pending) => pending === pendingAiChatPrompt ? null : pending);
        setFailedFullScreenQuery(query);
      };
      if (contextProps.currentSession!.messages.length > 0) {
        recoverQuestion();
        return;
      }
      handoff.sending = true;
      void handleSendMessageRef.current(query, { preserveComposer: true }).then((accepted) => {
        if (pendingFullScreenSessionRef.current !== handoff) return;
        handoff.sending = false;
        if (!accepted) return;
        pendingFullScreenSessionRef.current = null;
        setPendingAiChatPrompt((pending) => pending === pendingAiChatPrompt ? null : pending);
      }).catch(recoverQuestion);
      return;
    }
    pendingFullScreenSessionRef.current = null;
    setPendingAiChatPrompt(null);
    const hasDraft = !!editor && !editor.isEmpty;
    const hasAttachments = fileItems.length > 0;
    if (!hasDraft && !hasAttachments) {
      void handleSendMessageRef.current(query).catch(() => {});
    } else if (!hasDraft && editor) {
      editor.commands.setContent(query);
      editor.commands.focus("end");
    }
  }, [
    pendingAiChatPrompt, contextProps.sessionPagingEnabled,
    askAiFullscreenEnabled,
    contextProps.isByokBlocked,
    contextProps.isTyping,
    contextProps.sendSettledVersion,
    contextProps.sessions.length,
    contextProps.chatHistoryReady,
    contextProps.activeSession,
    contextProps.currentSession,
    contextProps.startNewSession,
    pathname,
    editor,
    fileItems,
    setPendingAiChatPrompt,
  ]);

  useLayoutEffect(() => {
    onValue(contextProps);
  });
  useLayoutEffect(() => () => onValue(undefined), [onValue]);

  return (
    <ChatContext.Provider value={contextProps}>
      {contextProps.editorEnabled && (
        <AiChatEditorMount {...contextProps.editorMountProps} />
      )}
      {children}
    </ChatContext.Provider>
  );
});
