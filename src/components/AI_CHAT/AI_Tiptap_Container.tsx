import AIModelDropDownButton from "../Global/ModelSelectorDropdown";
import Tooltip from "../Common/Tooltip";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import styles from "@/styles/tiptap.module.scss";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import {
  ArrowDown,
  Check,
  ChevronDown,
  Clipboard,
  Image as ImageIcon,
  Layers,
  ListTodo,
  Paperclip,
  Square,
  SquareKanban,
  User,
  X,
} from "lucide-react";
import { ITeam, MentionItem } from "@/models/model";
import AudioButton from "../RTE/Components/AudioButton";
import ImageGallery from "../Common/AttachmentsUpload/ImageGalleryView";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { usePathname } from "next/navigation";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  aiChatExplicitOpenAtAtom,
  currentProjectAtom,
  currentUserAtom,
  dockedChatScopeAtom,
  inViewObjectAtom,
  recentChatBoardIdsAtom,
} from "@/store";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { sortBoardsByRecent } from "@/utils/aiChat/sortBoardsByRecent";
import { extractPastedImageFiles } from "@/utils/aiChat/extractPastedImageFiles";
import { AiChatComposerActionRow } from "./AiChatComposerActionRow";
import { SendMessageButton } from "./SendMessageButton";
export { SendMessageButton } from "./SendMessageButton";
import { QueuedMessagesStrip } from "@/components/Common/QueuedMessagesStrip";
import toast from "react-hot-toast";
import {
  FOCUS_REQUEST_WINDOW_MS,
  isEditableElement,
} from "@/utils/aiChat/focusRequestWindow";

const SCREENSHOT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type ComposerKeyDown = (event: {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
  defaultPrevented: boolean;
}) => void;

type ControlledComposer = {
  value: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  editorRef?: RefObject<Editor | null>;
  onChange: (value: string, cursor: number) => void;
  onKeyDown: ComposerKeyDown;
  placeholder: string;
  ariaLabel: string;
  isRecording: boolean;
  isProcessing: boolean;
  onRecordingChange: (recording: boolean) => void;
  onProcessingChange: (processing: boolean) => void;
  onDictation: (transcript: string) => void;
  dictationDisabled: boolean;
  projectId?: number | null;
  sendDisabled: boolean;
  queueMode: boolean;
  onSend: () => void;
};

// Dedicated editor for Agent Chat. useTiptapForAI also mounts AI-chat
// mentions and slash commands, which send to the AI chat thread, not this one.
function ControlledComposerEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
  ariaLabel,
  editorRef,
  onEditor,
}: {
  value: string;
  onChange: (value: string, cursor: number) => void;
  onKeyDown: ComposerKeyDown;
  placeholder: string;
  ariaLabel: string;
  editorRef?: RefObject<Editor | null>;
  onEditor: (editor: Editor | null) => void;
}) {
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        gapcursor: false,
        link: { autolink: false },
      }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
        emptyEditorClass: `${styles.is_editor_empty}`,
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        role: "textbox",
        class: "outline-none py-2 text-dense",
      },
      handleKeyDown: (_view, event) => {
        onKeyDownRef.current(event);
        return event.defaultPrevented;
      },
    },
    onUpdate: ({ editor: next }) => {
      const text = next.getText();
      const before = next.state.doc.textBetween(0, next.state.selection.from);
      onChangeRef.current(text, before.length);
    },
  });

  useEffect(() => {
    onEditor(editor);
    if (editorRef) editorRef.current = editor;
    return () => {
      onEditor(null);
      if (editorRef) editorRef.current = null;
    };
  }, [editor, editorRef, onEditor]);

  useEffect(() => {
    if (!editor) return;
    if (editor.getText() === value) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="h-[21px]" />;
  return <EditorContent editor={editor} />;
}

export function AI_Tiptap_Container({
  controlledComposer,
}: {
  controlledComposer?: ControlledComposer;
} = {}) {
  const pathname = usePathname();
  const isMbl = useContext(MobileViewContext);
  const [controlledEditor, setControlledEditor] = useState<Editor | null>(null);
  const {
    tiptapKeydown,
    editor,
    isTyping,
    isRecording,
    queuedMessages,
    removeQueuedMessage,
    isByokBlocked,
    dropDownButtonAICallback,
    currentAiOption,
    displayAiOptions,
    contextList,
    handleSendMessage,
    handleRemoveContext,
    handleAddContext,
    showScrollUpIndicator,
    scrollMessagesToBottom,
    handleCancelStream,
    audioTiptapCallback,
    toggleRecording,
    handleAttachmentClick,
    handleFileUpload,
    handleDroppedFiles,
    fileInputRef,
    fileItems,
    removeFile,
  } = useAiChatContext();
  const [audioProcessing, setAudioProcessing] = useState(false);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const mobileDictating = Boolean(
    isMbl &&
      (controlledComposer
        ? controlledComposer.isRecording || controlledComposer.isProcessing
        : isRecording || audioProcessing),
  );
  const handleScreenshotUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.some((file) => !SCREENSHOT_MIME_TYPES.has(file.type))) {
      toast.error("Choose a PNG, JPEG, or WebP screenshot.");
      input.value = "";
      return;
    }
    try {
      await handleFileUpload(event);
    } catch {
      toast.error("Couldn't attach that screenshot. Please try again.");
    } finally {
      input.value = "";
    }
  };

  const handleEditorPaste = (event: ClipboardEvent) => {
    const imageFiles = extractPastedImageFiles(event.clipboardData?.items);
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void handleDroppedFiles(imageFiles);
  };

  // Focus the composer as soon as it is on screen — but only when an explicit
  // user action just opened the panel. Auto-open ("Open AI chat by default",
  // reload restore) mounts this panel at page load; focusing then steals the
  // cursor so board shortcuts like c, j, k type into the chat box (HTPR-6317).
  // The loop itself exists because the focus call in useAiChat fires when the
  // open-toggle flips, before the dynamically imported panel has mounted this
  // editor, so it silently no-ops (HTPR-4565). Live tracing showed the Tiptap
  // command path also no-ops during the open transition, while plain DOM
  // .focus() on the mounted contenteditable sticks — so retry exactly that.
  const [explicitOpenAt, setExplicitOpenAt] = useRecoilState(
    aiChatExplicitOpenAtAtom
  );
  const focusRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      explicitOpenAt === null ||
      Date.now() - explicitOpenAt > FOCUS_REQUEST_WINDOW_MS
    ) {
      return;
    }
    setExplicitOpenAt(null);
    let tries = 0;
    const tick = () => {
      tries += 1;
      const pm = focusRootRef.current?.querySelector<HTMLElement>(
        ".ProseMirror[contenteditable='true']"
      );
      const active = document.activeElement as HTMLElement | null;
      if (pm && active && (active === pm || pm.contains(active))) {
        window.clearInterval(interval);
        return;
      }
      // The panel can finish loading after an explicit open while the user
      // has already moved to a comment or title. Do not steal the cursor back.
      if (isEditableElement(active)) {
        window.clearInterval(interval);
        return;
      }
      pm?.focus();
      if (tries >= 10) window.clearInterval(interval);
    };
    const interval = window.setInterval(tick, 60);
    return () => window.clearInterval(interval);
    // Only the mount-time value matters: the decision is made once, when the
    // panel appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dictation shortcuts (desktop): at rest, Chrome swallows CTRL+SHIFT+D
  // (bookmark-all-tabs) before the editor's own onKeyDown ever fires. A
  // document listener reclaims it here the same way NewCommentComponent does
  // for the task comment box (HTPR-5086). Skips when another input/editor has
  // focus, since that composer owns the shortcut instead.
  useEffect(() => {
    if (isMbl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const cmdControl = e.metaKey || e.ctrlKey;
      if (!cmdControl || !e.shiftKey) return;
      if (e.keyCode !== 68 && e.keyCode !== 70) return;
      const active = document.activeElement as HTMLElement | null;
      const inChat = Boolean(active?.closest?.("#ai-chat-tiptap-editor"));
      if (inChat) return; // the editor's own onKeyDown handles it
      const inOtherField =
        Boolean(active) &&
        (active!.tagName === "INPUT" ||
          active!.tagName === "TEXTAREA" ||
          active!.isContentEditable);
      if (inOtherField) return; // another composer owns the shortcut
      // AI chat only has a "speech to text" mic, no dictate-and-improve.
      if (e.keyCode === 70) return;
      const anchor = document.getElementById("ai-chat-audio-button");
      if (!anchor) return;
      e.preventDefault();
      anchor.click();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMbl]);

  // Tiptap v3's useEditor doesn't re-render on typing, so editor.isEmpty read
  // inline is stale (empty at mount -> Send stays disabled; only Enter, which
  // reads live editor state, worked). Subscribe so the button re-enables live.
  const isEditorEmpty =
    useEditorState({
      editor,
      selector: ({ editor }) => editor?.isEmpty ?? true,
    }) ?? true;
  const hasComposerText = controlledComposer
    ? controlledComposer.value.trim().length > 0
    : !isEditorEmpty;
  let recorderWrapperClassName: string | undefined;
  if (mobileDictating) {
    recorderWrapperClassName = "order-2 min-w-0 flex-1";
  } else if (isMbl) {
    recorderWrapperClassName = hasComposerText
      ? "order-3 ml-auto"
      : "order-4 ml-auto";
  }

  return (
    <div className={`p-2 relative`} ref={focusRootRef}>
      {!controlledComposer && showScrollUpIndicator && !isTyping && (
        <ScrollToTopButton onClick={scrollMessagesToBottom} />
      )}
      {!controlledComposer && queuedMessages.length > 0 && (
        <QueuedMessagesStrip
          items={queuedMessages}
          onRemove={removeQueuedMessage}
        />
      )}
      {!controlledComposer && isMbl && (
        <div
          data-ai-chat-mobile-context-row
          className="mb-2 flex min-w-0 items-center gap-2"
        >
          {!pathname?.startsWith("/chat") && <ChatScopeDropdown mobile />}
          <div
            data-ai-chat-mobile-context-scroll
            className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-none"
          >
            <ContextList
              items={contextList}
              onClick={handleRemoveContext}
              mobile
            />
            <AddContextButton onClick={handleAddContext} mobile />
          </div>
        </div>
      )}
      <div
        data-ai-chat-composer
        className={`
              w-full
              flex flex-col
              scrollbar-none items-center bg-ai-tiptap
              ${styles.aiChatInput} outline-none border-0
              ${isMbl ? "!rounded-[5px] px-3 pb-2 pt-3" : "!rounded-lg p-2"}
            `}
        onKeyDown={controlledComposer ? undefined : tiptapKeydown}
        data-agent-chat-ai-composer={controlledComposer ? true : undefined}
      >
        {!controlledComposer && fileItems.length > 0 && (
          <div className="flex flex-wrap items-start justify-start w-full">
            <ImageGallery
              files={fileItems}
              images={[]}
              allowDelete={true}
              shouldUpload={false}
              mode="others"
              handleRemove={removeFile}
              variant="chat"
            />
          </div>
        )}
        {!controlledComposer && !isMbl && contextList.length > 0 && (
          <ContextList items={contextList} onClick={handleRemoveContext} />
        )}
        <div
          className={`
                transition-all
                w-full
                duration-[40ms]
                scrollbar-none
                 break-normal
                 max-h-[380px]
                 overflow-y-auto
                ${styles.editorContainer}
                `}
          id={
            controlledComposer
              ? "agent-chat-composer-editor"
              : "ai-chat-tiptap-editor"
          }
          onPaste={controlledComposer ? undefined : handleEditorPaste}
        >
          {controlledComposer ? (
            <ControlledComposerEditor
              value={controlledComposer.value}
              onChange={controlledComposer.onChange}
              onKeyDown={controlledComposer.onKeyDown}
              placeholder={controlledComposer.placeholder}
              ariaLabel={controlledComposer.ariaLabel}
              editorRef={controlledComposer.editorRef}
              onEditor={setControlledEditor}
            />
          ) : editor ? (
            <EditorContent editor={editor} />
          ) : (
            <div className="h-[21px]" />
          )}
        </div>
        <AiChatComposerActionRow
          mobile={Boolean(isMbl)}
          mobileDictating={mobileDictating}
          hasText={hasComposerText}
          leadingControls={
            controlledComposer ? null : (
              <>
                <AIModelDropDownButton
                  optionCallback={dropDownButtonAICallback}
                  aiSelected={currentAiOption}
                  currentOptions={displayAiOptions}
                  className={"bottom-[110%] top-auto"}
                  stackSubmenus
                  effortLabelClassName={
                    pathname?.startsWith("/chat") ? undefined : "hidden"
                  }
                />
                {!pathname?.startsWith("/chat") && <ChatScopeDropdown />}
              </>
            )
          }
          mobileModelControl={
            controlledComposer ? null : (
              <AIModelDropDownButton
                optionCallback={dropDownButtonAICallback}
                aiSelected={currentAiOption}
                currentOptions={displayAiOptions}
                mobileQuickPicker
              />
            )
          }
          attachmentControl={
            controlledComposer ? null : (
              <AttachmentButton
                disabled={false}
                onClick={handleAttachmentClick}
              />
            )
          }
          contextControl={
            controlledComposer ? null : (
              <AddContextButton onClick={handleAddContext} />
            )
          }
          screenshotControl={
            controlledComposer ? null : (
              <ScreenshotButton
                onClick={() => screenshotInputRef.current?.click()}
              />
            )
          }
          recorder={
            controlledComposer ? (
              <AudioButton
                callbackHandler={controlledComposer.onDictation}
                editor={controlledEditor}
                id="ai-chat-audio-button"
                toggleRecording={controlledComposer.onRecordingChange}
                globalRecording={controlledComposer.isRecording}
                hasText={hasComposerText}
                onProcessingChange={controlledComposer.onProcessingChange}
                ariaLabel="Dictate message"
                wrapperClassName={recorderWrapperClassName}
                visualizerClassName={
                  mobileDictating ? "!mb-0 min-w-0 w-full" : undefined
                }
                disabled={controlledComposer.dictationDisabled}
                projectId={controlledComposer.projectId}
              />
            ) : (
              <AudioButton
                callbackHandler={audioTiptapCallback}
                editor={editor}
                id="ai-chat-audio-button"
                toggleRecording={toggleRecording!}
                globalRecording={isRecording}
                hasText={hasComposerText}
                onProcessingChange={setAudioProcessing}
                ariaLabel="Start dictation"
                wrapperClassName={recorderWrapperClassName}
                visualizerClassName={
                  mobileDictating ? "!mb-0 min-w-0 w-full" : undefined
                }
              />
            )
          }
          streamControl={
            controlledComposer ? null : isTyping ? (
              <CancelStreamButton onClick={handleCancelStream} />
            ) : null
          }
          sendControl={
            controlledComposer ? (
              <SendMessageButton
                disabled={controlledComposer.sendDisabled}
                queueMode={controlledComposer.queueMode}
                mobile={Boolean(isMbl)}
                onClick={controlledComposer.onSend}
              />
            ) : !isTyping || !isEditorEmpty ? (
              <SendMessageButton
                disabled={isEditorEmpty || isByokBlocked}
                isByokBlocked={isByokBlocked}
                queueMode={isTyping}
                mobile={Boolean(isMbl)}
                onClick={() => handleSendMessage()}
              />
            ) : null
          }
        />
        {!controlledComposer && (
          <input
            id="ai-chat-attachment-upload"
            type="file"
            multiple
            onChange={handleFileUpload}
            className="hidden"
            aria-hidden
            ref={fileInputRef}
          />
        )}
        {!controlledComposer && isMbl && (
          <input
            id="ai-chat-screenshot-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleScreenshotUpload}
            className="hidden"
            aria-hidden
            ref={screenshotInputRef}
          />
        )}
      </div>
    </div>
  );
}

function ChatScopeDropdown({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const currentUser = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const [dockedScope, setDockedScope] = useRecoilState(dockedChatScopeAtom);
  const [recentChatBoardIds, setRecentChatBoardIds] = useRecoilState<number[]>(
    recentChatBoardIdsAtom
  );
  const { data: allTeams } = useGetAllTeamsMinimal(currentUser?.id ?? null);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const teams = useMemo(
    () =>
      sortBoardsByRecent(
        (allTeams ?? []) as ITeam[],
        recentChatBoardIds
      ),
    [allTeams, recentChatBoardIds]
  );
  const selectedProject = teams
    .flatMap((team) => team.projects)
    .find((project) => project.id === dockedScope);
  // When the scope follows the current location (dockedScope === null), name the
  // concrete thing in context instead of the generic "Current board": the task
  // on a task page, otherwise the board's own name. HTPR-4563.
  const onTask =
    !!pathname?.startsWith("/detail") && inViewObject.taskId != null;
  const currentBoardName =
    currentProject?.title ?? currentProject?.name ?? "Current board";
  // A numeric dockedScope is an explicitly-picked board: always show a board
  // chip (its name, or a neutral "Board" while `allTeams` is still loading) so
  // the chip never falls through to the current task/board and misreports the
  // scope. The contextual task/board resolution runs only in follow-current
  // mode (dockedScope === null). HTPR-4563.
  const pickedBoardName =
    selectedProject?.title ?? selectedProject?.name ?? "Board";
  const scopeChip: { kind: "task" | "board" | "boards"; label: string; title: string } =
    dockedScope === "all"
      ? { kind: "boards", label: "All boards", title: "All boards" }
      : typeof dockedScope === "number"
        ? { kind: "board", label: pickedBoardName, title: pickedBoardName }
        : onTask && inViewObject.taskTicketNumber
          ? {
              kind: "task",
              label: inViewObject.taskTicketNumber,
              title: inViewObject.taskTitle ?? inViewObject.taskTicketNumber,
            }
          : { kind: "board", label: currentBoardName, title: currentBoardName };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const selectScope = (projectId: number | "all" | null) => {
    if (typeof projectId === "number") {
      setRecentChatBoardIds((previousIds) =>
        [projectId, ...previousIds.filter((id) => id !== projectId)].slice(
          0,
          12
        )
      );
    }
    setDockedScope(projectId);
    setIsOpen(false);
  };

  return (
    <div
      ref={rootRef}
      data-ai-chat-mobile-scope={mobile || undefined}
      className="relative inline-block min-w-0 max-w-full shrink-0 text-left"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`inline-flex w-full min-w-0 items-center text-dense leading-normal text-white-black outline-none transition-colors hover:bg-hover-active ${
          mobile
            ? "h-11 max-w-[65vw] rounded-[4px] bg-ai-tiptap px-3"
            : "rounded-[4px] px-2 py-1"
        }`}
        onClick={() => setIsOpen((open) => !open)}
        title={scopeChip.title}
      >
        {mobile && (
          <span className="mr-1 flex-none text-text-light-gray">Context:</span>
        )}
        <span className="mr-1 flex-none text-text-light-gray">
          {scopeChip.kind === "task" ? (
            <ListTodo size={13} strokeWidth={1.75} />
          ) : scopeChip.kind === "boards" ? (
            <Layers size={13} strokeWidth={1.75} />
          ) : (
            <SquareKanban size={13} strokeWidth={1.75} />
          )}
        </span>
        <span className="min-w-0 truncate font-medium">
          {scopeChip.label}
        </span>
        <ChevronDown
          size={16}
          className={`ml-1 flex-none text-emphasis text-text-light-gray transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+6px)] left-0 z-50 max-h-60 w-64 overflow-y-auto rounded-md bg-modalBackground py-1 shadow-lg scrollbar-thin hover:scrollbar-thumb-gray-500 scrollbar-thumb-gray-500 scrollbar-track-kanban-column-scrollbar dark:scrollbar-thumb-[#4F5766]"
        >
          <ScopeMenuRow
            label="Current board"
            selected={dockedScope === null}
            onClick={() => selectScope(null)}
          />
          <ScopeMenuRow
            label="All boards"
            selected={dockedScope === "all"}
            onClick={() => selectScope("all")}
          />
          {teams.map((team) => (
            <div key={team.id} className="pt-1">
              <div className="px-3 pb-1 pt-1 text-micro font-medium text-icon-dark-gray">
                {team.title}
              </div>
              {team.projects.map((project) => (
                <ScopeMenuRow
                  key={project.id}
                  label={project.title ?? project.name}
                  selected={dockedScope === project.id}
                  onClick={() => selectScope(project.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeMenuRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black transition-colors hover:bg-active-modal-element"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check size={16} className="shrink-0" strokeWidth={1.75} />}
    </button>
  );
}

function ContextList({
  items,
  onClick,
  mobile = false,
}: {
  items: MentionItem[];
  onClick: (index: number) => void;
  mobile?: boolean;
}) {
  if (mobile) {
    return (
      <div className="contents">
        {items.map((item: MentionItem, index: number) => (
          <button
            type="button"
            className="flex h-11 max-w-[65vw] shrink-0 items-center gap-2 rounded-[4px] bg-ai-tiptap px-3 text-white-black hover:bg-hover-active"
            key={`context-value-${index}`}
            onClick={() => onClick(index)}
            aria-label={`Remove ${item.name} from context`}
          >
            <ContextIcon type={item.type} />
            <span className="min-w-0 truncate text-meta">{item.name}</span>
            <X size={14} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 self-start flex-wrap">
      {items.map((item: MentionItem, index: number) => (
        <div
          className="relative group flex items-center justify-center gap-2 rounded-md border-[2px] border-icon-dark-gray px-2 py-1 text-white-black hover:bg-hover-active"
          key={`context-value-${index}`}
        >
          <X
            size={14}
            className="hidden group-hover:block group-hover:cursor-pointer text-white-black"
            onClick={() => onClick(index)}
            strokeWidth={1.75}
          />
          {item.type === "task" ? (
            <ListTodo
              size={14}
              className="group-hover:hidden text-icon-dark-gray"
              strokeWidth={1.75}
            />
          ) : item.type === "project" ? (
            <Clipboard
              size={14}
              className="group-hover:hidden text-icon-dark-gray"
              strokeWidth={1.75}
            />
          ) : (
            <User
              size={14}
              className="group-hover:hidden text-icon-dark-gray"
              strokeWidth={1.75}
            />
          )}
          <span className="text-meta text-white-black">{item.name}</span>
        </div>
      ))}
    </div>
  );
}

function ContextIcon({ type }: { type: string }) {
  if (type === "task") {
    return <ListTodo size={14} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} />;
  }
  if (type === "project") {
    return <Clipboard size={14} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} />;
  }
  return <User size={14} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} />;
}

function AttachmentButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: (e?: any) => void;
}) {
  const isApple = useDeviceContext();
  return (
    <button
      className="relative group rounded-sm text-icon-dark-gray hover:text-white-black"
      onClick={(e) => onClick(e)}
      disabled={disabled}
      aria-label="Attach files"
    >
      <Tooltip
        {...aiTaskWriterConfig.shortcutsAndTooltips.ai_chat.attachment_button(
          isApple
        )}
      />
      <Paperclip size={16} strokeWidth={1.75} />
    </button>
  );
}

function ScreenshotButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="relative rounded-sm text-icon-dark-gray hover:text-white-black"
      onClick={onClick}
      aria-label="Attach screenshot"
    >
      <ImageIcon size={18} strokeWidth={1.75} />
    </button>
  );
}

function CancelStreamButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className={`relative group text-icon-dark-gray hover:text-white-black`}
      onClick={onClick}
    >
      <Tooltip
        {...(aiTaskWriterConfig.shortcutsAndTooltips.ai_chat
          .cancel_stream_button as any)}
      />
      <Square size={16} strokeWidth={1.75} />
    </button>
  );
}

function AddContextButton({
  onClick,
  mobile = false,
}: {
  onClick: () => void;
  mobile?: boolean;
}) {
  return (
    <button
      data-ai-chat-mobile-add-context={mobile || undefined}
      className={
        mobile
          ? "flex h-11 shrink-0 items-center rounded-[4px] bg-ai-tiptap px-3 text-text-light-gray hover:bg-hover-active hover:text-white-black"
          : "relative group text-white"
      }
      onClick={onClick}
      aria-label="Add context"
    >
      {!mobile && (
        <Tooltip
          {...(aiTaskWriterConfig.shortcutsAndTooltips.ai_chat
            .add_context_button as any)}
        />
      )}
      <span className={mobile ? "text-meta" : "text-emphasis font-bold text-icon-dark-gray hover:text-white-black"}>
        {mobile ? "@ add" : "@"}
      </span>
    </button>
  );
}

function ScrollToTopButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick()}
      aria-label="Scroll to latest messages"
      className="group absolute -top-12 left-1/2 z-50 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full  bg-active-elementBg"
    >
      <ArrowDown size={18} className="text-content text-white-black" strokeWidth={1.75} />
    </button>
  );
}
