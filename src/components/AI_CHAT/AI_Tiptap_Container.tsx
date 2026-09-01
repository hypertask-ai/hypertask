import AIModelDropDownButton from "../Global/ModelSelectorDropdown";
import Tooltip from "../Common/Tooltip";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { EditorContent, useEditorState } from "@tiptap/react";
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
  Send,
  Square,
  SquareKanban,
  User,
  X,
} from "lucide-react";
import { ITeam, MentionItem } from "@/models/model";
import AudioButton from "../RTE/Components/AudioButton";
import { SendArrow } from "../Common/SendArrow";
import ImageGallery from "../Common/AttachmentsUpload/ImageGalleryView";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { usePathname } from "next/navigation";
import {
  type ChangeEvent,
  type ComponentProps,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  currentProjectAtom,
  currentUserAtom,
  dockedChatScopeAtom,
  inViewObjectAtom,
  recentChatBoardIdsAtom,
} from "@/store";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { sortBoardsByRecent } from "@/utils/aiChat/sortBoardsByRecent";
import { AiChatComposerActionRow } from "./AiChatComposerActionRow";
import toast from "react-hot-toast";

const SCREENSHOT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function AI_Tiptap_Container() {
  const pathname = usePathname();
  const isMbl = useContext(MobileViewContext);
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
    fileInputRef,
    fileItems,
    removeFile,
  } = useAiChatContext();
  const [audioProcessing, setAudioProcessing] = useState(false);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const mobileDictating = Boolean(isMbl && (isRecording || audioProcessing));
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

  // Focus the composer as soon as it is on screen. The focus call in
  // useAiChat fires when the open-toggle flips, before the dynamically
  // imported panel has mounted this editor, so it silently no-ops. Live
  // tracing (HTPR-4565) showed the Tiptap command path also no-ops during
  // the open transition, while plain DOM .focus() on the mounted
  // contenteditable sticks — so retry exactly that until it lands.
  const focusRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
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
      // Auto-open ("Open AI chat by default") mounts this panel at page
      // load; if the chunk lands after the user already started typing in
      // a comment or title, don't steal their cursor. Explicit opens pass
      // this check: clicking the toggle moved focus off the editable.
      const typingElsewhere =
        !!active &&
        (active.isContentEditable ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT");
      if (typingElsewhere) {
        window.clearInterval(interval);
        return;
      }
      pm?.focus();
      if (tries >= 10) window.clearInterval(interval);
    };
    const interval = window.setInterval(tick, 60);
    return () => window.clearInterval(interval);
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
  let recorderWrapperClassName: string | undefined;
  if (mobileDictating) {
    recorderWrapperClassName = "order-2 min-w-0 flex-1";
  } else if (isMbl) {
    recorderWrapperClassName = isEditorEmpty
      ? "order-4 ml-auto"
      : "order-3 ml-auto";
  }

  return (
    <div className={`p-2 relative`} ref={focusRootRef}>
      {showScrollUpIndicator && !isTyping && (
        <ScrollToTopButton onClick={scrollMessagesToBottom} />
      )}
      {queuedMessages.length > 0 && (
        <QueuedMessagesStrip
          items={queuedMessages}
          onRemove={removeQueuedMessage}
        />
      )}
      {isMbl && (
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
              ${isMbl ? "!rounded-[22px] px-3 pb-2 pt-3" : "!rounded-lg p-2"}
            `}
        onKeyDown={tiptapKeydown}
      >
        {fileItems.length > 0 && (
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
        {!isMbl && contextList.length > 0 && (
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
          id="ai-chat-tiptap-editor"
        >
          {editor ? (
            <EditorContent editor={editor} />
          ) : (
            <div className="h-[21px]" />
          )}
        </div>
        <AiChatComposerActionRow
          mobile={Boolean(isMbl)}
          mobileDictating={mobileDictating}
          hasText={!isEditorEmpty}
          leadingControls={
            <>
              <AIModelDropDownButton
                optionCallback={dropDownButtonAICallback}
                aiSelected={currentAiOption}
                currentOptions={displayAiOptions}
                className={"bottom-[110%] top-auto"}
                stackSubmenus
                // Docked rail is narrow: drop the effort word so the model +
                // board chips fit without colliding (effort still set in-menu).
                // Fullscreen /chat is wide, keep it. HTPR-4548.
                effortLabelClassName={
                  pathname?.startsWith("/chat") ? undefined : "hidden"
                }
                // dropDownClassName={"bg-transparent hover:bg-active-modal-element"}
              />
              {!pathname?.startsWith("/chat") && <ChatScopeDropdown />}
            </>
          }
          attachmentControl={
            <AttachmentButton
              disabled={false}
              onClick={handleAttachmentClick}
            />
          }
          contextControl={<AddContextButton onClick={handleAddContext} />}
          screenshotControl={
            <ScreenshotButton
              onClick={() => screenshotInputRef.current?.click()}
            />
          }
          recorder={
            <AudioButton
              callbackHandler={audioTiptapCallback}
              editor={editor}
              id={"ai-chat-audio-button"}
              toggleRecording={toggleRecording!}
              globalRecording={isRecording}
              hasText={!isEditorEmpty}
              onProcessingChange={setAudioProcessing}
              ariaLabel="Start dictation"
              wrapperClassName={recorderWrapperClassName}
              visualizerClassName={
                mobileDictating ? "!mb-0 min-w-0 w-full" : undefined
              }
            />
          }
          streamControl={
            isTyping ? (
              <CancelStreamButton onClick={handleCancelStream} />
            ) : null
          }
          sendControl={
            !isTyping || !isEditorEmpty ? (
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
        <input
          id="ai-chat-attachment-upload"
          type="file"
          multiple
          onChange={handleFileUpload}
          className="hidden"
          aria-hidden
          ref={fileInputRef}
        />
        {isMbl && (
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
            ? "h-11 max-w-[65vw] rounded-full bg-ai-tiptap px-3"
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
            className="flex h-11 max-w-[65vw] shrink-0 items-center gap-2 rounded-full bg-ai-tiptap px-3 text-white-black hover:bg-hover-active"
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
      className="relative group rounded-full text-icon-dark-gray hover:text-white-black"
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
      className="relative rounded-full text-icon-dark-gray hover:text-white-black"
      onClick={onClick}
      aria-label="Attach screenshot"
    >
      <ImageIcon size={18} strokeWidth={1.75} />
    </button>
  );
}

function QueuedMessagesStrip({
  items,
  onRemove,
}: {
  items: { id: string; content: string }[];
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className="mb-2 flex w-full flex-col gap-1.5 rounded-lg border border-border-light-gray-thin bg-containerBackground p-2"
      aria-label="Queued messages"
    >
      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-light-gray">
        <span>Queued · sends when reply finishes</span>
        <span>{items.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-md bg-newcomment-well px-2 py-1.5 text-meta text-white-black"
          >
            <span
              className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-hover-active text-[10px] font-bold text-text-light-gray"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.content}</span>
            <button
              type="button"
              className="shrink-0 text-icon-dark-gray hover:text-white-black"
              aria-label="Remove queued message"
              onClick={() => onRemove(item.id)}
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SendMessageButton({
  disabled,
  isByokBlocked,
  queueMode = false,
  mobile,
  onClick,
}: {
  disabled: boolean;
  isByokBlocked: boolean;
  queueMode?: boolean;
  mobile: boolean;
  onClick: () => void;
}) {
  const sendTooltip =
    aiTaskWriterConfig.shortcutsAndTooltips.ai_chat.send_button;
  let tooltipProps: ComponentProps<typeof Tooltip> = {
    ...sendTooltip,
    keyCombination: [...(sendTooltip.keyCombination ?? [])],
  };
  if (isByokBlocked) {
    tooltipProps = {
      text: "Enable API keys first",
      keyCombination: [] as string[],
      left: -175,
      bottom: 25,
    };
  } else if (queueMode) {
    tooltipProps = {
      text: "Queue message",
      keyCombination: ["enter"] as string[],
      left: -120,
      bottom: 25,
    };
  }

  let buttonClassName =
    "relative group disabled:text-gray-400 disabled:cursor-not-allowed rounded-full";
  if (mobile) {
    buttonClassName =
      "relative group flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-shadcn-primary text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50";
  } else if (!disabled && queueMode) {
    buttonClassName += " text-text-light-gray hover:text-white-black";
  } else if (!disabled) {
    buttonClassName += " text-button-arrow hover:opacity-80";
  }

  return (
    <button
      className={buttonClassName}
      onClick={onClick}
      disabled={disabled}
      aria-label={queueMode ? "Queue message" : "Send message"}
    >
      <Tooltip {...tooltipProps} />
      {mobile ? (
        <SendArrow size={22} />
      ) : (
        <Send size={16} strokeWidth={1.75} />
      )}
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
          ? "flex h-11 shrink-0 items-center rounded-full bg-ai-tiptap px-3 text-text-light-gray hover:bg-hover-active hover:text-white-black"
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
