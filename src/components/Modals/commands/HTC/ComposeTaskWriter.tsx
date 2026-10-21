import { useKeepAiChatClosed } from "@/hooks/General/useKeepAiChatClosed";
import { Suspense, useContext, useEffect, useRef, useState } from "react";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { currentProjectAtom, currentUserAtom, lastUsedBoardsAtom, composeTaskChatIntroAtom, showAIChatInterfaceAtom, isAiChatSidebarModeAtom, aiChatAutoOpenSuppressedAtom, aiChatExplicitOpenAtAtom, dockedChatScopeAtom, inViewObjectAtom } from "@/store";
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
import { HintKey } from "@/components/Common/CommonModalComponents";
import { extractPastedImageFiles } from "@/utils/aiChat/extractPastedImageFiles";
import { composeTaskBoardId, composeTaskAssistantMessage, createComposedTask, type ComposeTaskStage } from "@/lib/ai/composeTask";
import globalAPIHandlers from "@/utils/api/global";
import useAddDeleteTaskInBoards from "@/hooks/MultiPages/useAddDeleteTaskInBoards";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cachedTaskDetailKey } from "@/lib/navigation/cachedTaskDetail";
import { mergeRealtimeTaskDetail, preserveTaskAssigneesChangedDuringFetch, refreshTaskDetailQueryCache, shouldPreserveTaskEditorContent } from "@/lib/realtime/taskDetailRefresh";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7305_BOARD_FROM_TEXT_FLAG, HTPR_7306_CTRLJ_FOOTER_ONE_LINE_FLAG, HTPR_7312_CTRLJ_SKILLS_FLAG } from "@/lib/flags/keys";
import { matchComposeTaskBoard } from "@/lib/ai/composeTaskBoard";
import type { CommandFocusProxy } from "@/components/commandTypes";
import { HTPR_6891_PHONE_TASK_WRITER_SHEET_FLAG, HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG, HTPR_6951_TASK_WRITING_PROGRESS_FLAG, HTPR_6962_KEEP_ASSIGNEE_FLAG, HTPR_6999_CTRL_J_VIEW_CONTEXT_FLAG, HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG, HTPR_7085_CTRLJ_WRITER_REASON_FLAG, HTPR_7051_TASK_WRITER_IMAGE_UNFURL_FLAG, HTPR_7053_COMPOSE_BOARD_CHIP_FLAG, HTPR_7313_CTRLJ_ALWAYS_BOARD_CHIP_FLAG, HTPR_7343_CTRLJ_WRITER_PROPERTIES_FLAG } from "@/lib/flags/keys";
import { HTPR_7307_CTRLJ_FOOTER_CLICKABLE_FLAG } from "@/lib/flags/keys";
import { resolveComposeBoardTarget } from "./composeBoardTarget";
import { ChatScopeChip } from "@/components/AI_CHAT/ChatScopeChip";
import MoveTaskGlobal from "@/components/Modals/MoveTaskToBoard";
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
  const { keepAiChatClosed, ready: chatAutoOpenReady } = useKeepAiChatClosed();
  const chatAutoOpenAllowed = useRef(false);
  chatAutoOpenAllowed.current = chatAutoOpenReady && !keepAiChatClosed;
  const ctrljFooterOneLine = useFlag(HTPR_7306_CTRLJ_FOOTER_ONE_LINE_FLAG);
  const invokeSkills = useFlag(HTPR_7312_CTRLJ_SKILLS_FLAG);
  const phoneTaskWriterSheetEnabled = useFlag(HTPR_6891_PHONE_TASK_WRITER_SHEET_FLAG);
  const enabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindow = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG) && enabled;
  const keepAssignee = useFlag(HTPR_6962_KEEP_ASSIGNEE_FLAG);
  const progressFlag = useFlag(HTPR_6951_TASK_WRITING_PROGRESS_FLAG);
  const viewContextEnabled = useFlag(HTPR_6999_CTRL_J_VIEW_CONTEXT_FLAG);
  const splitTasksEnabled = useFlag(HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG);
  const writerReasonEnabled = useFlag(HTPR_7085_CTRLJ_WRITER_REASON_FLAG);
  const unfurlImageUrls = useFlag(HTPR_7051_TASK_WRITER_IMAGE_UNFURL_FLAG);
  const applyWriterProperties = useFlag(HTPR_7343_CTRLJ_WRITER_PROPERTIES_FLAG);
  const boardChipEnabled = useFlag(HTPR_7053_COMPOSE_BOARD_CHIP_FLAG);
  const boardFromTextEnabled = useFlag(HTPR_7305_BOARD_FROM_TEXT_FLAG);
  const alwaysShowBoardChip = useFlag(HTPR_7313_CTRLJ_ALWAYS_BOARD_CHIP_FLAG);
  const clickableFooter = useFlag(HTPR_7307_CTRLJ_FOOTER_CLICKABLE_FLAG);
  const footerButtonClassName = "rounded-[4px] transition hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:outline-none";
  const [selectedBoardId, setSelectedBoardId] = useState<number>();
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const boardChip = useRef<HTMLButtonElement>(null);
  const caret = useRef<{ start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);
  let showProgress = false;
  if (progressFlag && newTaskWindow) showProgress = true;
  const taskContext = useContext(TaskContext);
  const taskContextRef = useRef(taskContext);
  taskContextRef.current = taskContext;
  const isApple = useDeviceContext();
  const inView = useRecoilValue(inViewObjectAtom);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const dictating = newTaskWindow && (recording || transcribing);
  useEffect(() => {
    if (newTaskWindow) return;
    setRecording(false);
    setTranscribing(false);
  }, [newTaskWindow]);
  const mobile = Boolean(useContext(MobileViewContext));
  const phoneTaskWriterSheet = phoneTaskWriterSheetEnabled && mobile && active;
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [stage, setStage] = useState<ComposeTaskStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingImages, setAddingImages] = useState(false);
  const pendingImages = useRef(0);
  const sending = useRef(false);
  const mounted = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const [writingHeight, setWritingHeight] = useState<number>();
  const user = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const lastUsedBoards = useRecoilValue(lastUsedBoardsAtom);
  const setIntro = useSetRecoilState(composeTaskChatIntroAtom);
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
  const { data: boards = [], isFetching: loadingBoards } = useQuery<IProject[]>({
    queryKey: ["projectsAllMinimal", user?.id],
    queryFn: () => globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal"),
    enabled: (boardChipEnabled || boardFromTextEnabled) && enabled && active && Boolean(user?.id),
  });
  const waitingForBoards = boardFromTextEnabled && loadingBoards && !boards.length;
  const textBoardId = boardFromTextEnabled && selectedBoardId === undefined ? matchComposeTaskBoard(text, boards) : undefined;
  let targetBoardId: number | undefined;
  let showBoardChip = false;
  if (boardChipEnabled) {
    const target = resolveComposeBoardTarget({
      url: typeof window === "undefined" ? "/" : window.location.href,
      focusedTicketBoardId: inView?.taskId ? inView.taskProjectId : undefined,
      lastUsedBoardId: composeTaskBoardId("/", parseCookies().previousBoard, lastUsedBoards),
      destinationBoardId: destinationProject?.id,
      selectedBoardId: selectedBoardId ?? textBoardId,
    });
    targetBoardId = target.boardId;
    showBoardChip = target.showChip;
    if (alwaysShowBoardChip) showBoardChip = true;
  } else {
    targetBoardId = textBoardId;
    showBoardChip = false;
  }
  const targetBoard: IProject | undefined = boards.find((board) => board.id === targetBoardId)
    ?? (destinationProject?.id === targetBoardId ? destinationProject : undefined)
    ?? (currentProject && currentProject.id === targetBoardId ? currentProject : undefined);
  const boardShortcut = getShortcutDisplay({ key: 66, modifiers: ["ctrl", "shift"], description: "Change board" }, isApple).join("+");
  const openBoardPicker = () => {
    if (!boardChipEnabled || writing || dictating) return;
    const field = input.current;
    if (field) caret.current = { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection };
    setBoardPickerOpen(true);
  };
  useEffect(() => {
    if (!active || !boardChipEnabled) setBoardPickerOpen(false);
  }, [active, boardChipEnabled]);

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
    if (!active || writing || dictating || (boardChipEnabled && boardPickerOpen)) return;
    let cancelled = false;
    let tries = 0;
    const focus = () => {
      const field = input.current;
      if (cancelled || !field || (document.activeElement === field && !(boardChipEnabled && caret.current))) return;
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
      if (boardChipEnabled && caret.current && document.activeElement === field) {
        const { start, end, direction } = caret.current;
        field.setSelectionRange(start, end, direction);
        caret.current = null;
      }
      if (mobile && document.activeElement !== field && ++tries < 30) requestAnimationFrame(focus);
    };
    focus();
    return () => { cancelled = true; };
  }, [active, writing, mobile, dictating, boardChipEnabled, boardPickerOpen, focusProxy]);
  useEffect(() => {
    if (!enabled || !active || writing) return;
    const attachShortcut = (event: KeyboardEvent) => {
      if (boardChipEnabled && boardPickerOpen) return;
      if (boardChipEnabled && event.target === input.current && !event.isComposing &&
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
  }, [enabled, active, writing, addingImages, handleAttachmentClick, boardChipEnabled, boardPickerOpen, isApple, dictating]);

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
    if (!enabled || sending.current || pendingImages.current > 0 || waitingForBoards || dictating || !text.trim()) return;
    sending.current = true;
    setWritingHeight(showProgress ? composer.current?.offsetHeight : undefined);
    setWriting(true);
    setStage(null);
    onBusyChange(true);
    setError(null);
    const assigneesAtFetchStart = taskContextRef.current?.currentTask?.assignees;
    try {
      let existingTaskId: number | undefined;
      let targetProjectId: number | undefined;
      const detail = window.location.pathname.match(/^\/detail\/project-(\d+)\/(\d+)$/);
      if (newTaskWindow && !destinationProject && detail && inView?.taskId &&
          ((!boardChipEnabled && !textBoardId) || targetBoardId === Number(detail[1]))) {
        const { data: task } = await axios.get("/api/tasks/single", { params: { id: inView.taskId } });
        if (task.projectId === Number(detail[1]) && task.uniqueIndex === Number(detail[2]) && isEmptyComposeTarget(task)) {
          existingTaskId = task.id;
          targetProjectId = task.projectId;
        }
      }
      let projectId: number | undefined;
      if (boardChipEnabled) {
        projectId = targetBoardId;
      } else {
        projectId = textBoardId ?? destinationProject?.id ?? targetProjectId ?? composeTaskBoardId(window.location.href, parseCookies().previousBoard, lastUsedBoards);
      }
      if (!projectId || !user?.id) throw new Error("Open a board first, then try again. Your note is still here.");
      let project = destinationProject?.id === projectId ? destinationProject : (currentProject?.id === projectId ? currentProject : undefined);
      if (!project) {
        const projects: IProject[] = await globalAPIHandlers.getAllProjectsMinimal();
        project = projects.find((item) => item.id === projectId);
      }
      if (!mounted.current) return;
      if (!project) throw new Error("Your last board is unavailable. Open a board and try again.");
      const { task: savedTask, writerFailed, writerFailureReason, tasks: splitResult, failedTitles } = await createComposedTask({
        text, files, project, userId: user.id, explainWriterFailure: writerReasonEnabled, unfurlImageUrls, ...(invokeSkills ? { invokeSkills } : {}), ...(applyWriterProperties ? { applyWriterProperties } : {}), ...(existingTaskId ? { existingTaskId } : {}),
        ...(viewContextEnabled && currentProject?.id === projectId && !existingTaskId &&
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
          keepAssignee,
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
            }, syncContent), assigneesAtFetchStart, keepAssignee)
            : current);
          if (syncContent) context.setDescription(task.description_?.content ?? "");
        }
      }
      if (splitTasksEnabled) {
        for (const createdTask of existingTaskId ? (splitResult ?? [task]).slice(1) : splitResult ?? [task]) {
          createTaskGlobally({ task: createdTask, sectionId: createdTask.sectionId!, position: "top" });
        }
      } else if (!existingTaskId) createTaskGlobally({ task, sectionId: task.sectionId!, position: "top" });
      if (mobile && newTaskWindow) await onCreated();
      setIntro({ taskId: task.id, content: composeTaskAssistantMessage(task.ticketNumber ?? `${project.uniqueIdentifier ?? "TASK"}-${task.uniqueIndex}`, writerFailed, Boolean(existingTaskId), splitTasksEnabled && splitResult ? { tasks: splitResult, failedTitles } : undefined, writerFailureReason) });
      updateActiveItemAndItemInView(task);
      setScope(projectId);
      if (chatAutoOpenAllowed.current) {
        setSidebar(true);
        setSuppressed(false);
        setExplicitOpen(Date.now());
        setShowChat(true);
      }
      router.push(`/detail/project-${projectId}/${task.uniqueIndex}`);
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
    if (!active || !focusProxy || focusProxy.pendingEnter === undefined ||
        text !== focusProxy.pendingEnter || document.activeElement !== input.current) return;
    delete focusProxy.pendingEnter;
    void send();
  }, [active, text, focusProxy]);

  const attachments = fileItems.length > 0 && (
    <Suspense fallback={null}>
      <ImageGallery files={fileItems} images={[]} allowDelete shouldUpload={false} mode="others" variant="chat"
        handleRemove={(name: string) => {
          discardUnboundCreateTaskUploads(files.filter((file) => file.name === name));
          removeFile(name);
        }} />
    </Suspense>
  );

  return enabled ? (
    <div hidden={!active} data-compose-task-writer data-compose-board-picker-open={boardChipEnabled && active && boardPickerOpen ? "" : undefined} className={phoneTaskWriterSheet ? "flex min-h-0 flex-1 flex-col" : newTaskWindow && mobile ? "max-h-[65dvh] overflow-y-auto" : undefined}
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
          <div className={phoneTaskWriterSheet ? "flex min-h-0 w-full flex-1 flex-col rounded-[5px] bg-ai-tiptap px-3 py-2" : "flex w-full flex-col rounded-[5px] bg-ai-tiptap px-3 py-2"}>
            {(newTaskWindow || phoneTaskWriterSheet) && attachments && (phoneTaskWriterSheet ? (
              <div className="min-h-0 overflow-y-auto">{attachments}</div>
            ) : mobile ? attachments : (
              <div className="max-h-[max(6rem,calc(65dvh-20rem))] overflow-y-auto">{attachments}</div>
            ))}
            <AiComposerTextarea
              ref={input}
              value={text}
              onChange={(event) => {
                if (focusProxy) delete focusProxy.pendingEnter;
                setText(event.target.value);
              }}
              rows={mobile ? 3 : 2}
              placeholder="Describe the task"
              aria-label="Describe the task"
              className={phoneTaskWriterSheet ? "min-h-16 flex-1 overflow-y-auto text-content caret-hypertasks-ai-purple" : newTaskWindow ? "min-h-16 max-h-52 overflow-y-auto text-content caret-hypertasks-ai-purple" : "min-h-16 text-content"}
              onPaste={(event) => {
                const images = extractPastedImageFiles(event.clipboardData?.items);
                if (!images.length) return;
                event.preventDefault();
                void addImages(images);
              }}
              disabled={dictating}
              onKeyDown={(event) => {
                if (boardChipEnabled && showBoardChip && event.key === "Tab" && !event.shiftKey &&
                    !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  boardChip.current?.focus();
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  void send();
                }
              }}
            />
            {!newTaskWindow && !phoneTaskWriterSheet && attachments}
            <div className={phoneTaskWriterSheet ? "flex w-full shrink-0 items-center justify-between pt-2" : "flex w-full items-center justify-between pt-2"}>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {!recording && <AttachmentButton disabled={addingImages || dictating} mobile={mobile} onClick={handleAttachmentClick} />}
                {newTaskWindow && <AudioButton id="compose-task-audio-button" ariaLabel="Start dictation" editor={null}
                  defaultContent={text} hasText={Boolean(text.trim())} toggleRecording={setRecording} onProcessingChange={setTranscribing}
                  disabled={!active || addingImages} projectId={boardChipEnabled ? targetBoardId : destinationProject?.id} mobilePrimaryTone="primary" mobilePresentation="compact"
                  callbackHandler={(transcript, replace) => {
                    if (replace) {
                      const plain = new DOMParser().parseFromString(transcript, "text/html").body.textContent ?? "";
                      setText((previous) => `${previous} ${plain}`.trim());
                    } else setText((previous) => previous + transcript);
                  }} />}
                {boardChipEnabled && showBoardChip && <div className="min-w-0 max-w-full">
                  <ChatScopeChip ref={boardChip} compose mobile={mobile} kind="board" label={targetBoard?.title ?? (targetBoardId ? `Board ${targetBoardId}` : "Choose a board")} title={targetBoard?.title} isOpen={boardPickerOpen} data-compose-board-chip
                    aria-label={`Change target board: ${targetBoard?.title ?? (targetBoardId ? `Board ${targetBoardId}` : "Choose a board")}`}
                    aria-haspopup="dialog" aria-expanded={boardPickerOpen} aria-keyshortcuts={isApple ? "Meta+Shift+B" : "Control+Shift+B"}
                    disabled={dictating} onClick={openBoardPicker}
                    onKeyDown={(event) => {
                      if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                        event.preventDefault();
                        event.stopPropagation();
                        input.current?.focus({ preventScroll: true });
                      } else if ((event.key === "Enter" || event.key === " ") && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        openBoardPicker();
                      }
                    }} />
                </div>}
              </div>
              <SendMessageButton disabled={addingImages || waitingForBoards || dictating || !text.trim()} mobile={mobile} onClick={() => void send()} />
            </div>
          </div>
          <input type="file" accept={newTaskWindow ? undefined : "image/*"} multiple hidden ref={fileInputRef} onChange={(event) => {
            void addImages(Array.from(event.target.files ?? []));
            event.target.value = "";
          }} />
          {error && <p role="alert" className="px-2 pt-2 text-meta text-text-light-gray">{error}</p>}
        </div>
      )}
      {!phoneTaskWriterSheet && <div className="flex flex-wrap items-center gap-4 border-t border-light-black-border-1 px-4 py-2 text-micro text-text-light-gray">
        {clickableFooter ? <button type="button" aria-label="Send" className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} disabled={writing || addingImages || dictating || !text.trim()} onClick={() => void send()}><HintKey>Enter</HintKey> Send</button> : <span><HintKey>Enter</HintKey> Send</span>}
        {clickableFooter ? <button type="button" aria-label={newTaskWindow ? "Attach files" : "Add images"} className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} disabled={writing || addingImages || dictating} onClick={handleAttachmentClick}><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 85, modifiers: ["ctrl"], description: "Attach" }, isApple).join("+") : "Ctrl+U"}</HintKey> {newTaskWindow ? "Attach files" : "Add images"}</button> : <span><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 85, modifiers: ["ctrl"], description: "Attach" }, isApple).join("+") : "Ctrl+U"}</HintKey> {newTaskWindow ? "Attach files" : "Add images"}</span>}
        {clickableFooter ? <button type="button" aria-label="Search" className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} onClick={onSearch}><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 75, modifiers: ["ctrl"], description: "Search" }, isApple).join("+") : "Ctrl+K"}</HintKey> Search</button> : <span><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 75, modifiers: ["ctrl"], description: "Search" }, isApple).join("+") : "Ctrl+K"}</HintKey> Search</span>}
        {boardChipEnabled && (clickableFooter ? <button type="button" aria-label="Board" className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} disabled={writing || dictating} onClick={openBoardPicker}><HintKey>{boardShortcut}</HintKey> Board</button> : <span><HintKey>{boardShortcut}</HintKey> Board</span>)}
        {(!ctrljFooterOneLine || !newTaskWindow || mobile) && (clickableFooter ? <button type="button" aria-label="Close" className={footerButtonClassName} onMouseDown={(event) => event.preventDefault()} disabled={writing} onClick={onClose}><HintKey>Esc</HintKey> Close</button> : <span><HintKey>Esc</HintKey> Close</span>)}
      </div>}
      {boardChipEnabled && active && boardPickerOpen && <MoveTaskGlobal
        boards={loadingBoards && !boards.length ? undefined : boards}
        closeHTC={() => setBoardPickerOpen(false)}
        onSelectBoard={(boardId) => {
          setSelectedBoardId(boardId);
          setBoardPickerOpen(false);
        }}
      />}
    </div>
  ) : null;
}
