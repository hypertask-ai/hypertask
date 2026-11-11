import { useKeepAiChatClosed } from "@/hooks/General/useKeepAiChatClosed";
import { Suspense, useContext, useEffect, useRef, useState } from "react";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { currentProjectAtom, currentUserAtom, lastUsedBoardsAtom, composeTaskChatIntroAtom, composeTaskSkillFollowupAtom, composeTaskQuestionsTaskIdAtom, composeTaskOriginalNoteAtom, showAIChatInterfaceAtom, isAiChatSidebarModeAtom, aiChatAutoOpenSuppressedAtom, aiChatExplicitOpenAtAtom, aiChatNewTicketPathAtom, dockedChatScopeAtom, inViewObjectAtom } from "@/store";
import { useRouter } from "next/navigation";
import { parseCookies } from "nookies";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { TaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useFileUpload } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import axios from "axios";
import { isEmptyComposeTarget } from "@/lib/ai/composeTaskTarget";
import AudioButton from "@/components/RTE/Components/AudioButton";
import { getShortcutDisplay } from "@/lib/utils/keyboardShortcuts";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import ImageGallery from "@/components/Common/AttachmentsUpload/ImageGalleryView";
import { AttachmentButton } from "@/components/AI_CHAT/AttachmentButton";
import { SendMessageButton } from "@/components/AI_CHAT/SendMessageButton";
import { AiComposerTextarea } from "@/components/AI_CHAT/AiComposerTextarea";
import FullScreenChatLoading from "@/components/AI_CHAT/FullScreenChatLoading";
import Tooltip from "@/components/Common/Tooltip";
import { HTPR_8141_BOARD_SHORTCUT_TOOLTIP_FLAG } from "@/lib/flags/keys";
import { HintKey } from "@/components/Common/CommonModalComponents";
import { extractPastedImageFiles } from "@/utils/aiChat/extractPastedImageFiles";
import { composeTaskBoardId, composeTaskAssistantMessage, createComposedTask, requestComposeSkillFollowup, type ComposeTaskStage } from "@/lib/ai/composeTask";
import globalAPIHandlers from "@/utils/api/global";
import useAddDeleteTaskInBoards from "@/hooks/MultiPages/useAddDeleteTaskInBoards";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cachedTaskDetailKey } from "@/lib/navigation/cachedTaskDetail";
import { mergeRealtimeTaskDetail, preserveTaskAssigneesChangedDuringFetch, refreshTaskDetailQueryCache, shouldPreserveTaskEditorContent } from "@/lib/realtime/taskDetailRefresh";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { HTPR_8140_CTRLJ_DICTATION_SHORTCUT_FLAG, HTPR_7979_ACTION_CHIPS_FLAG } from "@/lib/flags/keys";
import { HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG, HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG, HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG, HTPR_7305_BOARD_FROM_TEXT_FLAG, HTPR_7306_CTRLJ_FOOTER_ONE_LINE_FLAG, HTPR_7312_CTRLJ_SKILLS_FLAG } from "@/lib/flags/keys";
import { matchComposeTaskBoard } from "@/lib/ai/composeTaskBoard";
import type { CommandFocusProxy } from "@/components/commandTypes";
import { HTPR_7085_CTRLJ_WRITER_REASON_FLAG, HTPR_7514_INLINE_AGENT_IMAGES_FLAG, HTPR_7313_CTRLJ_ALWAYS_BOARD_CHIP_FLAG, HTPR_7343_CTRLJ_WRITER_PROPERTIES_FLAG, HTPR_9028_INLINE_CREATION_SCREENSHOTS_FLAG } from "@/lib/flags/keys";
import { HTPR_7307_CTRLJ_FOOTER_CLICKABLE_FLAG, HTPR_7652_CTRLJ_ENTER_QUEUE_FLAG, HTPR_7675_CTRLJ_ENTER_BEFORE_TEXT_RENDERS_FLAG, HTPR_7656_CTRLJ_SKILL_MENU_FLAG, HTPR_8253_CTRLJ_CTRL_ENTER_SEND_FLAG } from "@/lib/flags/keys";
import { useSkillSlashMenu } from "@/components/PageComponents/TaskDetail/AI Task Writer/useSkillSlashMenu";
import { HTPR_8260_CTRLJ_COMPOSER_KEYS_FLAG } from "@/lib/flags/definitions/htpr-8260-ctrlj-composer-keys";
import { HTPR_8829_CTRLJ_PLUS_COMPOSER_FLAG } from "@/lib/flags/definitions/htpr-8829-ctrlj-plus-composer";
import { HTPR_8945_CTRL_TAB_PALETTE_FLAG } from "@/lib/flags/definitions/htpr-8945-ctrl-tab-palette";
import { HTPR_8931_CTRLK_INTEGRATED_TABS_FLAG } from "@/lib/flags/definitions/htpr-8931-ctrlk-integrated-tabs";
import { composeWriterFooterKeys } from "@/lib/configs/composeWriterFooterKeys";
import { resolveComposeBoardTarget } from "./composeBoardTarget";
import { ChatScopeChip } from "@/components/AI_CHAT/ChatScopeChip";
import { Plus, X } from "lucide-react";
import { ComposerPlusActions } from "@/components/Common/ComposerPlusActions";
import { HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG } from "@/lib/flags/definitions/htpr-8824-ai-chat-one-composer";
import MoveTaskGlobal from "@/components/Modals/MoveTaskToBoard";
import { TaskWriterModelPicker, useTaskWriterModel } from "@/components/Global/ModelSelectorDropdown";
import { HTPR_8265_TASK_SHORTCUTS_WRITER_MODEL_FLAG } from "@/lib/flags/definitions/htpr-8265-task-shortcuts-writer-model";
import { discardUnboundCreateTaskUploads } from "@/lib/createTaskAttachmentUploads";
import type { IProject, ITask } from "@/models/model";

export default function ComposeTaskWriter({ active, focusProxy, destinationProject, onCreated, onBusyChange, onSearch, onClose }: {
  active: boolean;
  focusProxy?: CommandFocusProxy;
  destinationProject?: IProject;
  onCreated: () => void | Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onSearch?: () => void;
  onClose?: () => void;
}) {
  const aiChatOpenSwitchesEnabled = useFlag(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG);
  const aiChatOpenSwitchesReady = useFlagReady(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG);
  const { keepAiChatClosed, ready: chatAutoOpenReady } = useKeepAiChatClosed();
  const chatAutoOpenAllowed = useRef(false);
  chatAutoOpenAllowed.current = false;
  if (!aiChatOpenSwitchesEnabled) chatAutoOpenAllowed.current = aiChatOpenSwitchesReady && chatAutoOpenReady && !keepAiChatClosed;
  const boardShortcutTooltip = useFlag(HTPR_8141_BOARD_SHORTCUT_TOOLTIP_FLAG);
  const dictationShortcutEnabled = useFlag(HTPR_8140_CTRLJ_DICTATION_SHORTCUT_FLAG);
  const ctrljFooterOneLine = useFlag(HTPR_7306_CTRLJ_FOOTER_ONE_LINE_FLAG);
  const skillFollowupFlag = useFlag(HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG);
  let skillFollowupEnabled = false;
  if (skillFollowupFlag) skillFollowupEnabled = true;
  const invokeSkills = useFlag(HTPR_7312_CTRLJ_SKILLS_FLAG);
  const skillMenuFlag = useFlag(HTPR_7656_CTRLJ_SKILL_MENU_FLAG);
  let skillMenuEnabled = false;
  if (skillMenuFlag && invokeSkills) skillMenuEnabled = true;
  const ticketQuestionsEnabled = useFlag(HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG);
  const actionChipsEnabled = useFlag(HTPR_7979_ACTION_CHIPS_FLAG);
  const newTaskWindow = true;
  const writerReasonEnabled = useFlag(HTPR_7085_CTRLJ_WRITER_REASON_FLAG);
  const inlineAgentImages = useFlag(HTPR_7514_INLINE_AGENT_IMAGES_FLAG);
  const guaranteeScreenshots = useFlag(HTPR_9028_INLINE_CREATION_SCREENSHOTS_FLAG);
  const applyWriterProperties = useFlag(HTPR_7343_CTRLJ_WRITER_PROPERTIES_FLAG);
  const boardFromTextEnabled = useFlag(HTPR_7305_BOARD_FROM_TEXT_FLAG);
  const alwaysShowBoardChip = useFlag(HTPR_7313_CTRLJ_ALWAYS_BOARD_CHIP_FLAG);
  const clickableFooter = useFlag(HTPR_7307_CTRLJ_FOOTER_CLICKABLE_FLAG);
  const queueEnterWhileBoardsLoad = useFlag(HTPR_7652_CTRLJ_ENTER_QUEUE_FLAG);
  const holdEnterUntilTextRenders = useFlag(HTPR_7675_CTRLJ_ENTER_BEFORE_TEXT_RENDERS_FLAG);
  const ctrlEnterSends = useFlag(HTPR_8253_CTRLJ_CTRL_ENTER_SEND_FLAG);
  const footerButtonClassName = "rounded-[4px] transition hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:outline-none";
  const composerKeysEnabled = useFlag(HTPR_8260_CTRLJ_COMPOSER_KEYS_FLAG);
  const plusComposerEnabled = useFlag(HTPR_8829_CTRLJ_PLUS_COMPOSER_FLAG);
  const tabPaletteCycle = useFlag(HTPR_8945_CTRL_TAB_PALETTE_FLAG);
  const sharedPlusMenu = useFlag(HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG);
  const integratedTabsFlag = useFlag(HTPR_8931_CTRLK_INTEGRATED_TABS_FLAG);
  const stopDictationButtonId = "compose-task-stop-dictation";
  const cancelDictationButtonId = "compose-task-cancel-dictation";
  const createAfterDictation = useRef(false);
  const dictationDelivered = useRef(false);
  const writerModelPicker = useFlag(HTPR_8265_TASK_SHORTCUTS_WRITER_MODEL_FLAG);
  const [selectedBoardId, setSelectedBoardId] = useState<number>();
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const boardChip = useRef<HTMLButtonElement>(null);
  const plusMenu = useRef<HTMLDetailsElement>(null);
  const caret = useRef<{ start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);
  const showProgress = newTaskWindow;
  const taskContext = useContext(TaskContext);
  const taskContextRef = useRef(taskContext);
  taskContextRef.current = taskContext;
  const isApple = useDeviceContext();
  const commandKey = isApple ? "Cmd" : "Ctrl";
  const sendHint = ctrlEnterSends ? `${commandKey} Enter` : "Enter";
  const inView = useRecoilValue(inViewObjectAtom);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const dictating = newTaskWindow && (recording || transcribing);
  const mobile = Boolean(useContext(MobileViewContext));
  const phoneTaskWriterSheet = mobile && active;
  const plusLayout = Boolean(plusComposerEnabled && newTaskWindow && !mobile && !phoneTaskWriterSheet);
  const tabPaletteCycleActive = plusLayout && tabPaletteCycle;
  const composerKeysLayout = Boolean(composerKeysEnabled && newTaskWindow && !plusLayout);
  const [text, setText] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [writing, setWriting] = useState(false);
  const [stage, setStage] = useState<ComposeTaskStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingImages, setAddingImages] = useState(false);
  const pendingImages = useRef(0);
  const sending = useRef(false);
  const textHeldUntilBoardsLoad = useRef<string | null>(null);
  const typedTextNotRendered = useRef<string | null>(null);
  const textHeldUntilRendered = useRef<string | null>(null);
  const mounted = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tabPaletteCycleActive || !active) return;
    const root = composer.current;
    if (!root) return;
    const tabOut = "[data-compose-plus-row] summary, [data-compose-plus-row] button, #compose-task-audio-button, [data-compose-below-row] [data-compose-board-chip]";
    for (const node of root.querySelectorAll<HTMLElement>(tabOut)) node.tabIndex = -1;
    return () => {
      for (const node of root.querySelectorAll<HTMLElement>(tabOut)) {
        if (node.tabIndex === -1) node.tabIndex = 0;
      }
    };
  }, [tabPaletteCycleActive, active, text, dictating, addingImages, boardPickerOpen]);
  const [writingHeight, setWritingHeight] = useState<number>();
  const user = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const lastUsedBoards = useRecoilValue(lastUsedBoardsAtom);
  const setPendingFollowup = useSetRecoilState(composeTaskSkillFollowupAtom);
  const setIntro = useSetRecoilState(composeTaskChatIntroAtom);
  const setQuestionsTaskId = useSetRecoilState(composeTaskQuestionsTaskIdAtom);
  const setOriginalNote = useSetRecoilState(composeTaskOriginalNoteAtom);
  const setNewTicketPath = useSetRecoilState(aiChatNewTicketPathAtom);
  const setShowChat = useSetRecoilState(showAIChatInterfaceAtom);
  const setSidebar = useSetRecoilState(isAiChatSidebarModeAtom);
  const setSuppressed = useSetRecoilState(aiChatAutoOpenSuppressedAtom);
  const setExplicitOpen = useSetRecoilState(aiChatExplicitOpenAtAtom);
  const setScope = useSetRecoilState(dockedChatScopeAtom);
  const router = useRouter();
  const { createTaskGlobally } = useAddDeleteTaskInBoards();
  const { updateActiveItemAndItemInView } = useProjectQuery();
  const { updateTaskInCache } = UpdateKanban();
  const queryClient = useQueryClient();
  const { fileItems, files, fileInputRef, handleDroppedFiles, handleAttachmentClick, removeFile } = useFileUpload();
  const { data: boards = [], isFetching: loadingBoards, isSuccess: boardsLoaded } = useQuery<IProject[]>({
    queryKey: ["projectsAllMinimal", user?.id],
    queryFn: () => globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal"),
    enabled: active && Boolean(user?.id),
  });
  const waitingForBoards = boardFromTextEnabled && loadingBoards && !boards.length;
  const textBoardId = boardFromTextEnabled && selectedBoardId === undefined ? matchComposeTaskBoard(text, boards) : undefined;
  const target = resolveComposeBoardTarget({
    url: typeof window === "undefined" ? "/" : window.location.href,
    focusedTicketBoardId: inView?.taskId ? inView.taskProjectId : undefined,
    lastUsedBoardId: composeTaskBoardId("/", parseCookies().previousBoard, lastUsedBoards),
    destinationBoardId: destinationProject?.id,
    selectedBoardId: selectedBoardId ?? textBoardId,
  });
  const targetBoardId: number | undefined = target.boardId;
  let showBoardChip = target.showChip;
  if (alwaysShowBoardChip) showBoardChip = true;
  const targetBoard: IProject | undefined = boards.find((board) => board.id === targetBoardId)
    ?? (destinationProject?.id === targetBoardId ? destinationProject : undefined)
    ?? (currentProject && currentProject.id === targetBoardId ? currentProject : undefined);
  const writerModel = useTaskWriterModel(targetBoard);
  const skillMenu = useSkillSlashMenu({ textAreaRef: input, setValue: setText });
  const skillMenuConsumedKey = useRef(false);
  const boardShortcut = getShortcutDisplay({ key: 66, modifiers: ["ctrl", "shift"], description: "Change board" }, isApple).join("+");
  const closePlusMenu = () => {
    if (plusMenu.current) plusMenu.current.open = false;
  };
  const insertContextMark = () => {
    const field = input.current;
    const current = field?.value ?? text;
    const start = field?.selectionStart ?? current.length;
    const end = field?.selectionEnd ?? start;
    const previous = current[start - 1];
    const mark = start > 0 && previous !== " " && previous !== "\n" ? " @" : "@";
    const next = current.slice(0, start) + mark + current.slice(end);
    typedTextNotRendered.current = next;
    textHeldUntilRendered.current = null;
    setText(next);
    const caretAt = start + mark.length;
    requestAnimationFrame(() => {
      const nextField = input.current;
      if (!nextField) return;
      nextField.focus();
      nextField.setSelectionRange(caretAt, caretAt);
    });
  };
  const openBoardPicker = () => {
    if (writing || dictating) return;
    const field = input.current;
    if (field) caret.current = { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection };
    setBoardPickerOpen(true);
  };
  useEffect(() => {
    if (!active) {
      setBoardPickerOpen(false);
      closePlusMenu();
    }
  }, [active]);
  useEffect(() => {
    if (!plusLayout) return;
    const onPointerDown = (event: PointerEvent) => {
      const menu = plusMenu.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !plusMenu.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      closePlusMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [plusLayout]);

  useEffect(() => {
    if (!newTaskWindow || !active || !input.current) return;
    if (phoneTaskWriterSheet) {
      input.current.style.height = "";
      return;
    }
    input.current.style.height = "auto";
    input.current.style.height = `${Math.max(64, Math.min(input.current.scrollHeight, 208))}px`;
  }, [newTaskWindow, active, text, phoneTaskWriterSheet]);

  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discardUnboundCreateTaskUploads(filesRef.current);
    };
  }, []);
  useEffect(() => {
    if (!active || writing || dictating || boardPickerOpen) return;
    let cancelled = false;
    let tries = 0;
    const focus = () => {
      const field = input.current;
      if (cancelled || !field || (document.activeElement === field && !caret.current)) return;
      const proxy = focusProxy?.current;
      const transferring = proxy && (document.activeElement === proxy || (tries === 0 && proxy.value));
      const selectionStart = proxy?.selectionStart ?? null;
      const selectionEnd = proxy?.selectionEnd ?? null;
      if (transferring) {
        if (focusProxy.pendingEnter !== proxy.value) delete focusProxy.pendingEnter;
        field.value = proxy.value;
        setText(proxy.value);
      }
      field.focus({ preventScroll: true });
      if (transferring && document.activeElement === field) {
        field.setSelectionRange(selectionStart, selectionEnd);
        proxy.value = "";
      }
      if (caret.current && document.activeElement === field) {
        const { start, end, direction } = caret.current;
        field.setSelectionRange(start, end, direction);
        caret.current = null;
      }
      if (mobile && document.activeElement !== field && ++tries < 30) requestAnimationFrame(focus);
    };
    focus();
    return () => { cancelled = true; };
  }, [active, writing, mobile, dictating, boardPickerOpen, focusProxy]);
  useEffect(() => {
    if (!active || writing) return;
    const attachShortcut = (event: KeyboardEvent) => {
      if (boardPickerOpen) return;
      const cmdControl = (isApple && event.metaKey && !event.ctrlKey) || (!isApple && event.ctrlKey && !event.metaKey);
      if ((composerKeysLayout || plusLayout) && dictating && cmdControl && !event.altKey && !event.shiftKey && !event.isComposing && event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        createAfterDictation.current = true;
        document.getElementById(stopDictationButtonId)?.click();
        return;
      }
      if (dictationShortcutEnabled && newTaskWindow && !event.repeat && !event.isComposing &&
          cmdControl &&
          !event.altKey && event.shiftKey && event.code === "KeyD") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!addingImages) {
          const dictationButtonId = (composerKeysLayout || plusLayout) && dictating ? stopDictationButtonId : "compose-task-audio-button";
          document.getElementById(dictationButtonId)?.click();
        }
        return;
      }
      if (event.target === input.current && !event.isComposing &&
          ((isApple && event.metaKey && !event.ctrlKey) || (!isApple && event.ctrlKey && !event.metaKey)) &&
          !event.altKey && event.shiftKey && event.code === "KeyB") {
        event.preventDefault();
        event.stopImmediatePropagation();
        openBoardPicker();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
          !event.isComposing && event.code === "KeyU") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!addingImages) handleAttachmentClick();
      }
    };
    document.addEventListener("keydown", attachShortcut, true);
    return () => document.removeEventListener("keydown", attachShortcut, true);
  }, [active, writing, addingImages, handleAttachmentClick, boardPickerOpen, isApple, dictating, dictationShortcutEnabled, newTaskWindow, composerKeysLayout, plusLayout]);

  const addImages = async (images: File[]) => {
    if (sending.current || dictating) return;
    if (!newTaskWindow && images.some((file) => !file.type.startsWith("image/") && !/\.(?:png|jpe?g|gif|webp|heic|heif|avif)$/i.test(file.name))) {
      setError("Choose images to attach.");
      return;
    }
    pendingImages.current += 1;
    setAddingImages(true);
    try {
      await handleDroppedFiles(images);
      setError(null);
    } catch {
      setError("Couldn’t attach those images. Your note is still here.");
    } finally {
      pendingImages.current -= 1;
      setAddingImages(pendingImages.current > 0);
    }
  };

  const send = async () => {
    if (queueEnterWhileBoardsLoad && waitingForBoards && !sending.current && !dictating && text.trim()) {
      textHeldUntilBoardsLoad.current = text;
      return;
    }
    if (sending.current || pendingImages.current > 0 || waitingForBoards || dictating || !text.trim()) return;
    sending.current = true;
    setWritingHeight(showProgress ? composer.current?.offsetHeight : undefined);
    setWriting(true);
    setStage(null);
    onBusyChange(true);
    setError(null);
    const assigneesAtFetchStart = taskContextRef.current?.currentTask?.assignees;
    try {
      let existingTaskId: number | undefined;
      const detail = window.location.pathname.match(/^\/detail\/project-(\d+)\/(\d+)$/);
      if (newTaskWindow && !destinationProject && detail && inView?.taskId &&
          targetBoardId === Number(detail[1])) {
        const { data: task } = await axios.get("/api/tasks/single", { params: { id: inView.taskId } });
        if (task.projectId === Number(detail[1]) && task.uniqueIndex === Number(detail[2]) && isEmptyComposeTarget(task)) {
          existingTaskId = task.id;
        }
      }
      const projectId: number | undefined = targetBoardId;
      if (!projectId || !user?.id) throw new Error("Open a board first, then try again. Your note is still here.");
      let project = destinationProject?.id === projectId ? destinationProject : (currentProject?.id === projectId ? currentProject : undefined);
      if (!project) {
        const projects: IProject[] = await globalAPIHandlers.getAllProjectsMinimal();
        project = projects.find((item) => item.id === projectId);
      }
      if (!mounted.current) return;
      if (!project) throw new Error("Your last board is unavailable. Open a board and try again.");
      const { task: savedTask, writerFailed, writerFailureReason, tasks: splitResult, failedTitles, skills } = await createComposedTask({
        text, files, project, userId: user.id, explainWriterFailure: writerReasonEnabled, ...(inlineAgentImages ? { inlineAgentImages } : {}), ...(guaranteeScreenshots ? { guaranteeScreenshots } : {}), ...(invokeSkills ? { invokeSkills } : {}), ...(applyWriterProperties ? { applyWriterProperties } : {}), ...(existingTaskId ? { existingTaskId } : {}),
        ...(writerModelPicker && writerModel ? { writerModel } : {}),
        ...(currentProject?.id === projectId && !existingTaskId &&
          /^\/project(?:\/|$)/.test(window.location.pathname) ? { viewProject: currentProject } : {}),
        ...(showProgress ? { onProgress: (next: ComposeTaskStage) => { if (mounted.current) setStage(next); } } : {}),
      });
      let task = savedTask;
      if (!mounted.current) return;
      if (existingTaskId) {
        const queryKey = cachedTaskDetailKey(user.id, task.id);
        await queryClient.cancelQueries({ queryKey });
        if (!mounted.current) return;
        task = queryClient.setQueryData<ITask>(queryKey, (previous) => preserveTaskAssigneesChangedDuringFetch(
          taskContextRef.current?.currentTask ?? null,
          {
            ...previous,
            ...task,
            project: previous?.project ? { ...previous.project, ...task.project } : task.project,
          },
          assigneesAtFetchStart,
        )) ?? task;
        await refreshTaskDetailQueryCache({ queryClient, taskId: task.id, fetchTask: async () => task });
        if (!mounted.current) return;
        updateTaskInCache(task, task.id, task.projectId, task.sectionId);
        const context = taskContextRef.current;
        if (context?.currentTask?.id === task.id && context.currentTask.projectId === task.projectId) {
          const syncContent = !shouldPreserveTaskEditorContent(context);
          context.setCurrentTask((current) => current?.id === task.id && current.projectId === task.projectId
            ? preserveTaskAssigneesChangedDuringFetch(current, mergeRealtimeTaskDetail(current, {
              ...current,
              ...task,
              project: current.project ? { ...current.project, ...task.project } : task.project,
            }, syncContent), assigneesAtFetchStart)
            : current);
          if (syncContent) context.setDescription(task.description_?.content ?? "");
        }
      }
      for (const createdTask of existingTaskId ? (splitResult ?? [task]).slice(1) : splitResult ?? [task]) {
        createTaskGlobally({ task: createdTask, sectionId: createdTask.sectionId!, position: "top" });
      }
      if (mobile && newTaskWindow) await onCreated();
      const content = composeTaskAssistantMessage(task.ticketNumber ?? `${project.uniqueIdentifier ?? "TASK"}-${task.uniqueIndex}`, writerFailed, Boolean(existingTaskId), splitResult ? { tasks: splitResult, failedTitles } : undefined, writerFailureReason);
      if (ticketQuestionsEnabled && / from your note\. Want me to refine it\?/.test(content)) {
        if (actionChipsEnabled) setOriginalNote({ taskId: task.id, note: text });
        setQuestionsTaskId(task.id);
      }
      if (skillFollowupEnabled && !writerFailed && skills?.length) {
        setPendingFollowup({ taskId: task.id });
        void (async () => {
          const result = await requestComposeSkillFollowup(task.id, skills, text);
          if (result) queryClient.setQueryData(["task-questions", "new-ticket", task.id], { questions: result.questions });
          const enriched = result
            ? composeTaskAssistantMessage(task.ticketNumber ?? `${project.uniqueIdentifier ?? "TASK"}-${task.uniqueIndex}`, false, Boolean(existingTaskId), splitResult ? { tasks: splitResult, failedTitles } : undefined, undefined, result.followup)
            : content;
          setIntro({ taskId: task.id, content: enriched, skillFollowup: true });
          setPendingFollowup((pending) => pending?.taskId === task.id ? null : pending);
        })();
      } else setIntro({ taskId: task.id, content });
      updateActiveItemAndItemInView(task);
      setScope(projectId);
      if (chatAutoOpenAllowed.current) {
        setSidebar(true);
        setSuppressed(false);
        setExplicitOpen(Date.now());
        setShowChat(true);
      }
      const taskPath = `/detail/project-${projectId}/${task.uniqueIndex}`;
      setNewTicketPath(taskPath);
      router.push(taskPath);
      if (!mobile || !newTaskWindow) onCreated();
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Couldn’t create the task. Your note is still here. Try again.");
    } finally {
      sending.current = false;
      if (mounted.current) setWriting(false);
      onBusyChange(false);
    }
  };

  useEffect(() => {
    if (!createAfterDictation.current || dictating) return;
    createAfterDictation.current = false;
    const delivered = dictationDelivered.current;
    dictationDelivered.current = false;
    if (delivered && text.trim()) void send();
  }, [dictating, text]);

  useEffect(() => {
    if (!active || !focusProxy || focusProxy.pendingEnter === undefined ||
        text !== focusProxy.pendingEnter || document.activeElement !== input.current) return;
    delete focusProxy.pendingEnter;
    void send();
  }, [active, text, focusProxy, inputFocused]);

  useEffect(() => {
    typedTextNotRendered.current = null;
    const heldText = textHeldUntilRendered.current;
    textHeldUntilRendered.current = null;
    if (holdEnterUntilTextRenders && active && heldText === text) void send();
  }, [text]);

  useEffect(() => {
    const heldText = textHeldUntilBoardsLoad.current;
    if (heldText === null) return;
    const holdStillValid = queueEnterWhileBoardsLoad && boardFromTextEnabled && active && !dictating && text === heldText;
    if (holdStillValid && (waitingForBoards || addingImages)) return;
    textHeldUntilBoardsLoad.current = null;
    if (holdStillValid && boardsLoaded) void send();
  }, [waitingForBoards, addingImages, active, queueEnterWhileBoardsLoad, boardFromTextEnabled, boardsLoaded, dictating, text]);

  const attachments = fileItems.length > 0 && (
    <Suspense fallback={null}>
      <ImageGallery files={fileItems} images={[]} allowDelete shouldUpload={false} mode="others" variant="chat"
        handleRemove={(name: string) => {
          discardUnboundCreateTaskUploads(files.filter((file) => file.name === name));
          removeFile(name);
        }} />
    </Suspense>
  );

  const dictationControl = newTaskWindow && (
    <div className={composerKeysLayout && dictating ? "hidden" : undefined}>
      <AudioButton id="compose-task-audio-button" ariaLabel="Start dictation" editor={null}
        defaultContent={text} hasText={Boolean(text.trim())} toggleRecording={(on: boolean) => {
          if (on) dictationDelivered.current = false;
          setRecording(on);
        }} onProcessingChange={setTranscribing}
        disabled={!active || addingImages} projectId={targetBoardId} mobilePrimaryTone="primary" mobilePresentation="compact"
        {...(plusLayout ? { compactListeningPill: true, primaryMic: true, hideDevicePicker: true, stopButtonId: stopDictationButtonId, hoverTooltip: { text: "Dictate", keyCombination: dictationShortcutEnabled ? [isApple ? "CMD" : "CTRL", "SHIFT", "D"] : [] } } : {})}
        {...(composerKeysLayout ? { hoverTooltip: { text: "Dictate", keyCombination: dictationShortcutEnabled ? [isApple ? "CMD" : "CTRL", "SHIFT", "D"] : [] }, stopButtonId: stopDictationButtonId, cancelButtonId: cancelDictationButtonId } : {})}
        callbackHandler={(transcript, replace) => {
          dictationDelivered.current = true;
          if (replace) {
            const plain = new DOMParser().parseFromString(transcript, "text/html").body.textContent ?? "";
            setText((previous) => `${previous} ${plain}`.trim());
          } else setText((previous) => previous + transcript);
        }} />
    </div>
  );

  const boardControl = showBoardChip && <div className="min-w-0 max-w-full">
    {boardShortcutTooltip && <Tooltip portal bottom={0} left={0} text="Change board" keyCombination={boardShortcut.split("+")} />}
    <ChatScopeChip ref={boardChip} compose mobile={mobile} kind="board" label={targetBoard?.title ?? (targetBoardId ? `Board ${targetBoardId}` : "Choose a board")} title={targetBoard?.title} isOpen={boardPickerOpen} data-compose-board-chip
      aria-label={`Change target board: ${targetBoard?.title ?? (targetBoardId ? `Board ${targetBoardId}` : "Choose a board")}`}
      aria-haspopup="dialog" aria-expanded={boardPickerOpen} aria-keyshortcuts={isApple ? "Meta+Shift+B" : "Control+Shift+B"}
      disabled={dictating} onClick={openBoardPicker}
      onKeyDown={(event) => {
        if (!plusLayout && event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          input.current?.focus({ preventScroll: true });
        } else if ((event.key === "Enter" || event.key === " ") && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          openBoardPicker();
        }
      }} />
  </div>;

  const footerKeys = composeWriterFooterKeys({
    recording,
    transcribing,
    commandKey,
    board: Boolean(showBoardChip),
    dictate: Boolean(dictationShortcutEnabled),
    ctrlEnterSends,
  });

  return (
    <div hidden={!active} data-compose-task-writer data-compose-board-picker-open={active && boardPickerOpen ? "" : undefined} data-compose-skill-menu-open={skillMenuEnabled && skillMenu.menu ? "" : undefined} className={phoneTaskWriterSheet ? "flex min-h-0 flex-1 flex-col" : newTaskWindow && mobile ? "max-h-[65dvh] overflow-y-auto" : undefined}
      onDragOver={(event) => { if (!writing && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        void addImages(Array.from(event.dataTransfer.files));
      }}>
      {writing ? (
        <div className="flex items-center justify-center" style={writingHeight ? { minHeight: writingHeight } : undefined}>
          <FullScreenChatLoading inline label={showProgress && stage ? stage : "Writing your ticket…"} />
        </div>
      ) : (
        <div ref={composer} className={phoneTaskWriterSheet ? "flex min-h-0 flex-1 flex-col p-2" : "p-2"}>
          <div className={phoneTaskWriterSheet ? "flex min-h-0 w-full flex-1 flex-col rounded-[5px] bg-ai-tiptap px-3 py-2" : plusLayout || (integratedTabsFlag && newTaskWindow && !mobile) ? "flex w-full flex-col rounded-[4px] bg-ai-tiptap px-3 py-2" : "flex w-full flex-col rounded-[5px] bg-ai-tiptap px-3 py-2"}>
            {(newTaskWindow || phoneTaskWriterSheet) && attachments && (phoneTaskWriterSheet ? (
              <div className="min-h-0 overflow-y-auto">{attachments}</div>
            ) : mobile ? attachments : (
              <div className="max-h-[max(6rem,calc(65dvh-20rem))] overflow-y-auto">{attachments}</div>
            ))}
            <AiComposerTextarea
              ref={input}
              onFocus={() => setInputFocused(true)}
              onBlur={() => {
                setInputFocused(false);
                if (skillMenuEnabled) requestAnimationFrame(skillMenu.close);
              }}
              onClick={skillMenuEnabled ? skillMenu.onCaretMove : undefined}
              onKeyUp={skillMenuEnabled ? (event) => {
                if (skillMenuConsumedKey.current) return;
                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) skillMenu.onCaretMove();
              } : undefined}
              value={text}
              onChange={(event) => {
                if (focusProxy) delete focusProxy.pendingEnter;
                typedTextNotRendered.current = event.target.value;
                textHeldUntilRendered.current = null;
                setText(event.target.value);
                if (skillMenuEnabled) skillMenu.onInput(event.target.value, event.target.selectionStart ?? event.target.value.length);
              }}
              rows={mobile ? 3 : 2}
              placeholder="Describe the task"
              aria-label="Describe the task"
              className={phoneTaskWriterSheet ? "min-h-16 flex-1 overflow-y-auto text-content caret-hypertasks-ai-purple" : plusLayout ? "min-h-16 max-h-52 overflow-y-auto text-content caret-hypertasks-ai-purple placeholder:opacity-50" : newTaskWindow ? "min-h-16 max-h-52 overflow-y-auto text-content caret-hypertasks-ai-purple" : "min-h-16 text-content"}
              onPaste={(event) => {
                const images = extractPastedImageFiles(event.clipboardData?.items);
                if (!images.length) return;
                event.preventDefault();
                void addImages(images);
              }}
              disabled={dictating}
              onKeyDown={(event) => {
                skillMenuConsumedKey.current = skillMenuEnabled && !event.nativeEvent.isComposing && skillMenu.onKeyDown(event);
                if (skillMenuConsumedKey.current) return;
                if (showBoardChip && !plusLayout && event.key === "Tab" && !event.shiftKey &&
                    !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  boardChip.current?.focus();
                  return;
                }
                const cmdEnter = event.key === "Enter" && (event.ctrlKey || event.metaKey);
                const plainEnter = event.key === "Enter" && !event.shiftKey;
                if ((ctrlEnterSends ? cmdEnter : plainEnter) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (holdEnterUntilTextRenders && typedTextNotRendered.current !== null && typedTextNotRendered.current !== text) {
                    textHeldUntilRendered.current = typedTextNotRendered.current;
                    return;
                  }
                  void send();
                }
              }}
            />
            {skillMenuEnabled && skillMenu.menu}
            {!newTaskWindow && !phoneTaskWriterSheet && attachments}
            {plusLayout ? (
              <div data-compose-plus-row className="flex w-full items-center justify-between pt-2">
                {sharedPlusMenu ? (
                  <ComposerPlusActions
                    disabled={addingImages || dictating}
                    active={active}
                    attachShortcut={getShortcutDisplay({ key: 85, modifiers: ["ctrl"], description: "Attach" }, isApple).join("+")}
                    onAttach={handleAttachmentClick}
                    onAddContext={insertContextMark}
                  />
                ) : (
                  <details ref={plusMenu} className="relative">
                    <summary
                      aria-label="Add"
                      aria-disabled={addingImages || dictating}
                      onClick={(event) => {
                        if (addingImages || dictating) event.preventDefault();
                      }}
                      className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-[4px] text-icon-dark-gray hover:bg-hover-active hover:text-white-black [&::-webkit-details-marker]:hidden"
                    >
                      <Plus size={18} strokeWidth={1.75} aria-hidden />
                    </summary>
                    <div role="group" aria-label="Add" className="absolute bottom-[calc(100%+0.25rem)] left-0 z-popup flex min-w-44 flex-col rounded-[4px] bg-modalBackground p-1 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
                      <button type="button" aria-label="Attach file" disabled={addingImages || dictating}
                        className="flex items-center justify-between gap-6 rounded-[4px] px-2 py-1.5 text-left text-meta text-white-black hover:bg-hover-active disabled:opacity-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => { closePlusMenu(); handleAttachmentClick(); }}>
                        <span>Attach file</span>
                        <span className="text-text-light-gray">{getShortcutDisplay({ key: 85, modifiers: ["ctrl"], description: "Attach" }, isApple).join("+")}</span>
                      </button>
                      <button type="button" aria-label="Add context" disabled={addingImages || dictating}
                        className="flex items-center justify-between gap-6 rounded-[4px] px-2 py-1.5 text-left text-meta text-white-black hover:bg-hover-active disabled:opacity-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => { closePlusMenu(); insertContextMark(); }}>
                        <span>Add context</span>
                        <span className="text-text-light-gray">@</span>
                      </button>
                    </div>
                  </details>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  {dictationControl}
                  <SendMessageButton label="Send" textButton disabled={addingImages || waitingForBoards || dictating || !text.trim()} mobile={false} onClick={() => void send()} />
                </div>
              </div>
            ) : (
            <div className={phoneTaskWriterSheet ? "flex w-full shrink-0 items-center justify-between pt-2" : "flex w-full items-center justify-between pt-2"}>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {composerKeysLayout && boardControl}
                {writerModelPicker && <TaskWriterModelPicker project={targetBoard} mobile={mobile} className="bottom-[110%] top-auto" />}
                {!recording && <AttachmentButton disabled={addingImages || dictating} mobile={mobile} onClick={handleAttachmentClick} />}
                {!composerKeysLayout && dictationControl}
                {!composerKeysLayout && boardControl}
              </div>
              <div className={composerKeysLayout ? "flex shrink-0 items-center gap-2" : "flex items-center"}>
                {composerKeysLayout && dictating && (
                  <div className="flex items-center rounded-[4px] bg-hover-active pl-2 pr-1 text-dense text-white-black max-sm:min-h-11">
                    <button type="button" aria-label="Stop dictation" disabled={transcribing}
                      onClick={() => document.getElementById(stopDictationButtonId)?.click()}
                      className="flex items-center gap-2 py-1 disabled:cursor-wait disabled:opacity-60 max-sm:min-h-11 max-sm:px-1">
                      <span className="h-2 w-2 rounded-full bg-white-black" aria-hidden />
                      Dictation
                    </button>
                    <button type="button" aria-label="Cancel dictation" disabled={transcribing}
                      onClick={() => document.getElementById(cancelDictationButtonId)?.click()}
                      className="ml-1 flex h-6 w-6 items-center justify-center rounded-[4px] text-icon-dark-gray hover:text-white-black disabled:cursor-wait disabled:opacity-60 max-sm:h-11 max-sm:w-11">
                      <X size={14} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                )}
                {composerKeysLayout && dictationControl}
                {composerKeysEnabled && newTaskWindow ? (
                  <button type="button" aria-label="Create task" disabled={addingImages || waitingForBoards || dictating || !text.trim()}
                    onClick={() => void send()}
                    className="rounded-[4px] bg-shadcn-primary px-3 py-1 text-dense font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-11">
                    Create
                  </button>
                ) : (
                  <SendMessageButton disabled={addingImages || waitingForBoards || dictating || !text.trim()} mobile={mobile} onClick={() => void send()} />
                )}
              </div>
            </div>
            )}
          </div>
          {plusLayout && (
            <div data-compose-below-row className="flex w-full items-center justify-between gap-2 pt-2">
              {boardControl || <span />}
              {writerModelPicker && <TaskWriterModelPicker project={targetBoard} mobile={false} className="bottom-[110%] top-auto right-0 left-auto" />}
            </div>
          )}
          <input type="file" accept={newTaskWindow ? undefined : "image/*"} multiple hidden ref={fileInputRef} onChange={(event) => {
            void addImages(Array.from(event.target.files ?? []));
            event.target.value = "";
          }} />
          {error && <p role="alert" className="px-2 pt-2 text-meta text-text-light-gray">{error}</p>}
        </div>
      )}
      {!phoneTaskWriterSheet && !plusLayout && (composerKeysLayout ? <div className="flex items-center justify-between gap-4 border-t border-light-black-border-1 px-4 py-2 text-micro text-text-light-gray">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          {footerKeys.left.map(([keys, action]) => <span key={`${keys}-${action}`}><HintKey>{keys}</HintKey> {action}</span>)}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {footerKeys.right.map(([keys, action]) => <span key={`${keys}-${action}`}><HintKey>{keys}</HintKey> {action}</span>)}
        </div>
      </div> : <div className="flex flex-wrap items-center gap-4 border-t border-light-black-border-1 px-4 py-2 text-micro text-text-light-gray">
        {clickableFooter ? <button type="button" aria-label="Send" className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} disabled={writing || addingImages || dictating || !text.trim()} onClick={() => void send()}><HintKey>{sendHint}</HintKey> Send</button> : <span><HintKey>{sendHint}</HintKey> Send</span>}
        {clickableFooter ? <button type="button" aria-label={newTaskWindow ? "Attach files" : "Add images"} className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} disabled={writing || addingImages || dictating} onClick={handleAttachmentClick}><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 85, modifiers: ["ctrl"], description: "Attach" }, isApple).join("+") : "Ctrl+U"}</HintKey> {newTaskWindow ? "Attach files" : "Add images"}</button> : <span><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 85, modifiers: ["ctrl"], description: "Attach" }, isApple).join("+") : "Ctrl+U"}</HintKey> {newTaskWindow ? "Attach files" : "Add images"}</span>}
        {clickableFooter ? <button type="button" aria-label="Search" className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} onClick={onSearch}><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 75, modifiers: ["ctrl"], description: "Search" }, isApple).join("+") : "Ctrl+K"}</HintKey> Search</button> : <span><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 75, modifiers: ["ctrl"], description: "Search" }, isApple).join("+") : "Ctrl+K"}</HintKey> Search</span>}
        {(clickableFooter ? <button type="button" aria-label="Board" className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} disabled={writing || dictating} onClick={openBoardPicker}><HintKey>{boardShortcut}</HintKey> Board</button> : <span><HintKey>{boardShortcut}</HintKey> Board</span>)}
        {(!ctrljFooterOneLine || !newTaskWindow || mobile) && (clickableFooter ? <button type="button" aria-label="Close" className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} disabled={writing} onClick={onClose}><HintKey>Esc</HintKey> Close</button> : <span><HintKey>Esc</HintKey> Close</span>)}
      </div>)}
      {active && boardPickerOpen && <MoveTaskGlobal
        boards={loadingBoards && !boards.length ? undefined : boards}
        closeHTC={() => setBoardPickerOpen(false)}
        onSelectBoard={(boardId) => {
          setSelectedBoardId(boardId);
          setBoardPickerOpen(false);
        }}
      />}
    </div>
  );
}
