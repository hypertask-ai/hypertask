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
// Type-only: a value import here would pull tiptap back into every page's
// initial chunk and defeat the dynamic mount below (HTPR-4508).
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

// Define the context type
export interface ChatContextType {
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
  handleSendMessage: (retryContent?: string, options?: { preserveComposer?: boolean }) => Promise<void>;
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

// Runs the chat hook graph. It provides the context to its own children (pages
// that need chat from their first render) and hands the same value to the
// app shell's provider, which holds every other page beside it. Loading it
// therefore never remounts a page that is already on screen (HTPR-6751).
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
    // Tiptap consumes Control+Q before a bubbling document listener can see it.
    // Route only this established focus shortcut during capture; every other AI
    // shortcut keeps the existing bubble-phase behavior (HTPR-5204 follow-up).
    const handleLayoutKeydownCapture = (event: KeyboardEvent) => {
      if (!isControlQFocusShortcut(event)) return;

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
      !contextProps.sessions.length
    ) {
      return;
    }
    if (typeof pendingAiChatPrompt !== "string") {
      // A warm side-panel runtime must not consume this before /chat is ready.
      if (pathname !== "/chat" || !contextProps.chatHistoryReady) return;
      if (pendingFullScreenSessionRef.current?.prompt !== pendingAiChatPrompt) {
        pendingFullScreenSessionRef.current = {
          prompt: pendingAiChatPrompt,
          previousSessionId: contextProps.activeSession,
        };
        void contextProps.startNewSession().catch(() => {
          if (pendingFullScreenSessionRef.current?.prompt !== pendingAiChatPrompt) return;
          pendingFullScreenSessionRef.current = null;
          setPendingAiChatPrompt(null);
          setFailedFullScreenQuery(pendingAiChatPrompt.query);
        });
        return;
      }
      if (
        !contextProps.currentSession ||
        contextProps.activeSession === pendingFullScreenSessionRef.current.previousSessionId ||
        contextProps.currentSession.messages.length > 0
      ) return;
    }
    const query = typeof pendingAiChatPrompt === "string" ? pendingAiChatPrompt : pendingAiChatPrompt.query;
    pendingFullScreenSessionRef.current = null;
    setPendingAiChatPrompt(null);
    if (typeof pendingAiChatPrompt !== "string") {
      void handleSendMessageRef.current(query, { preserveComposer: true }).catch(() => {});
      return;
    }
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
    askAiFullscreenEnabled,
    contextProps.isByokBlocked,
    contextProps.isTyping,
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
