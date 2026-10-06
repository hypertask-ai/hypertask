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
import { useQueryClient } from "@tanstack/react-query";
import { cachedTaskDetailKey } from "@/lib/navigation/cachedTaskDetail";
import { mergeRealtimeTaskDetail, preserveTaskAssigneesChangedDuringFetch, refreshTaskDetailQueryCache, shouldPreserveTaskEditorContent } from "@/lib/realtime/taskDetailRefresh";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG, HTPR_6951_TASK_WRITING_PROGRESS_FLAG, HTPR_6962_KEEP_ASSIGNEE_FLAG } from "@/lib/flags/keys";
import { discardUnboundCreateTaskUploads } from "@/lib/createTaskAttachmentUploads";
import type { IProject, ITask } from "@/models/model";

export default function ComposeTaskWriter({ active, destinationProject, onCreated, onBusyChange }: {
  active: boolean;
  destinationProject?: IProject;
  onCreated: () => void | Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const enabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindow = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG) && enabled;
  const keepAssignee = useFlag(HTPR_6962_KEEP_ASSIGNEE_FLAG);
  const progressFlag = useFlag(HTPR_6951_TASK_WRITING_PROGRESS_FLAG);
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

  useEffect(() => {
    if (!newTaskWindow || !active || !input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.max(64, Math.min(input.current.scrollHeight, 208))}px`;
  }, [newTaskWindow, active, text]);

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
    if (!active || writing || dictating) return;
    let cancelled = false;
    let tries = 0;
    const focus = () => {
      const field = input.current;
      if (cancelled || !field || document.activeElement === field) return;
      field.focus({ preventScroll: true });
      // The phone sheet's entry animation can reject the first focus call.
      if (mobile && document.activeElement !== field && ++tries < 30) requestAnimationFrame(focus);
    };
    focus();
    return () => { cancelled = true; };
  }, [active, writing, mobile, dictating]);
  useEffect(() => {
    if (!enabled || !active || writing) return;
    const attachShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
          !event.isComposing && event.code === "KeyU") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!addingImages) handleAttachmentClick();
      }
    };
    document.addEventListener("keydown", attachShortcut, true);
    return () => document.removeEventListener("keydown", attachShortcut, true);
  }, [enabled, active, writing, addingImages, handleAttachmentClick]);

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
    if (!enabled || sending.current || pendingImages.current > 0 || dictating || !text.trim()) return;
    sending.current = true;
    // Keep the window the same size while the progress steps replace the composer.
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
      if (newTaskWindow && !destinationProject && detail && inView?.taskId) {
        const { data: task } = await axios.get("/api/tasks/single", { params: { id: inView.taskId } });
        if (task.projectId === Number(detail[1]) && task.uniqueIndex === Number(detail[2]) && isEmptyComposeTarget(task)) {
          existingTaskId = task.id;
          targetProjectId = task.projectId;
        }
      }
      const projectId = destinationProject?.id ?? targetProjectId ?? composeTaskBoardId(window.location.href, parseCookies().previousBoard, lastUsedBoards);
      if (!projectId || !user?.id) throw new Error("Open a board first, then try again. Your note is still here.");
      let project = destinationProject ?? (currentProject?.id === projectId ? currentProject : undefined);
      if (!project) {
        const projects: IProject[] = await globalAPIHandlers.getAllProjectsMinimal();
        project = projects.find((item) => item.id === projectId);
      }
      if (!mounted.current) return;
      if (!project) throw new Error("Your last board is unavailable. Open a board and try again.");
      const { task: savedTask, writerFailed } = await createComposedTask({
        text, files, project, userId: user.id, ...(existingTaskId ? { existingTaskId } : {}),
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
        // Board quick-add can open a regular detail provider, not the cached view.
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
      } else createTaskGlobally({ task, sectionId: task.sectionId!, position: "top" });
      // The phone form's history cleanup must finish before opening the task and chat.
      if (mobile && newTaskWindow) await onCreated();
      setIntro({ taskId: task.id, content: composeTaskAssistantMessage(task.ticketNumber ?? `${project.uniqueIdentifier ?? "TASK"}-${task.uniqueIndex}`, writerFailed, Boolean(existingTaskId)) });
      updateActiveItemAndItemInView(task);
      setScope(projectId);
      setSidebar(true);
      setSuppressed(false);
      setExplicitOpen(Date.now());
      setShowChat(true);
      router.push(`/detail/project-${projectId}/${task.uniqueIndex}`);
      if (!mobile || !newTaskWindow) onCreated();
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Couldn’t create the task. Your note is still here. Try again.");
    } finally {
      sending.current = false;
      if (mounted.current) setWriting(false);
      // The palette can outlive Compose when the feature flag turns off.
      onBusyChange(false);
    }
  };

  // A lazy thumbnail must not suspend the modal portal and remount its draft.
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
    <div hidden={!active} data-compose-task-writer className={newTaskWindow && mobile ? "max-h-[65dvh] overflow-y-auto" : undefined}
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
        <div ref={composer} className="p-2">
          <div className="flex w-full flex-col rounded-[5px] bg-ai-tiptap px-3 py-2">
            {newTaskWindow && attachments && (mobile ? attachments : (
              // Reserve space for the textarea, actions and footer without clipping their tooltips.
              <div className="max-h-[max(6rem,calc(65dvh-20rem))] overflow-y-auto">{attachments}</div>
            ))}
            <AiComposerTextarea
              ref={input}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={mobile ? 3 : 2}
              placeholder="Describe the task"
              aria-label="Describe the task"
              className={newTaskWindow ? "min-h-16 max-h-52 overflow-y-auto text-content caret-hypertasks-ai-purple" : "min-h-16 text-content"}
              onPaste={(event) => {
                const images = extractPastedImageFiles(event.clipboardData?.items);
                if (!images.length) return;
                event.preventDefault();
                void addImages(images);
              }}
              disabled={dictating}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  void send();
                }
              }}
            />
            {!newTaskWindow && attachments}
            <div className="flex w-full items-center justify-between pt-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {!recording && <AttachmentButton disabled={addingImages || dictating} mobile={mobile} onClick={handleAttachmentClick} />}
                {newTaskWindow && <AudioButton id="compose-task-audio-button" ariaLabel="Start dictation" editor={null}
                  defaultContent={text} hasText={Boolean(text.trim())} toggleRecording={setRecording} onProcessingChange={setTranscribing}
                  disabled={!active || addingImages} projectId={destinationProject?.id} mobilePrimaryTone="primary" mobilePresentation="compact"
                  callbackHandler={(transcript, replace) => {
                    if (replace) {
                      const plain = new DOMParser().parseFromString(transcript, "text/html").body.textContent ?? "";
                      setText((previous) => `${previous} ${plain}`.trim());
                    } else setText((previous) => previous + transcript);
                  }} />}
              </div>
              <SendMessageButton disabled={addingImages || dictating || !text.trim()} mobile={mobile} onClick={() => void send()} />
            </div>
          </div>
          <input type="file" accept={newTaskWindow ? undefined : "image/*"} multiple hidden ref={fileInputRef} onChange={(event) => {
            void addImages(Array.from(event.target.files ?? []));
            event.target.value = "";
          }} />
          {error && <p role="alert" className="px-2 pt-2 text-meta text-text-light-gray">{error}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 border-t border-light-black-border-1 px-4 py-2 text-micro text-text-light-gray">
        <span><HintKey>Enter</HintKey> Send</span>
        <span><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 85, modifiers: ["ctrl"], description: "Attach" }, isApple).join("+") : "Ctrl+U"}</HintKey> {newTaskWindow ? "Attach files" : "Add images"}</span>
        <span><HintKey>{newTaskWindow ? getShortcutDisplay({ key: 75, modifiers: ["ctrl"], description: "Search" }, isApple).join("+") : "Ctrl+K"}</HintKey> Search</span>
        <span><HintKey>Esc</HintKey> Close</span>
      </div>
    </div>
  ) : null;
}
