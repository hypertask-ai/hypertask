import { Suspense, useContext, useEffect, useRef, useState } from "react";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { currentProjectAtom, currentUserAtom, lastUsedBoardsAtom, composeTaskChatIntroAtom, showAIChatInterfaceAtom, isAiChatSidebarModeAtom, aiChatAutoOpenSuppressedAtom, aiChatExplicitOpenAtAtom, dockedChatScopeAtom, inViewObjectAtom } from "@/store";
import { useRouter } from "next/navigation";
import { parseCookies } from "nookies";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
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
import { composeTaskBoardId, composeTaskAssistantMessage, createComposedTask } from "@/lib/ai/composeTask";
import globalAPIHandlers from "@/utils/api/global";
import useAddDeleteTaskInBoards from "@/hooks/MultiPages/useAddDeleteTaskInBoards";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG } from "@/lib/flags/keys";
import { discardUnboundCreateTaskUploads } from "@/lib/createTaskAttachmentUploads";
import type { IProject } from "@/models/model";

export default function ComposeTaskWriter({ active, onCreated, onBusyChange }: {
  active: boolean;
  onCreated: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const enabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindowFlag = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG);
  const newTaskWindow = enabled && newTaskWindowFlag;
  const isApple = useDeviceContext();
  const inView = useRecoilValue(inViewObjectAtom);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const dictating = recording || transcribing;
  const mobile = Boolean(useContext(MobileViewContext));
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingImages, setAddingImages] = useState(false);
  const pendingImages = useRef(0);
  const sending = useRef(false);
  const mounted = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
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
  const { fileItems, files, fileInputRef, handleDroppedFiles, handleAttachmentClick, removeFile } = useFileUpload();

  useEffect(() => {
    if (!newTaskWindow || !active || !input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.max(240, Math.min(input.current.scrollHeight, 440))}px`;
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
    if (!active || writing) return;
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
  }, [active, writing, mobile]);
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
    setWriting(true);
    onBusyChange(true);
    setError(null);
    try {
      let existingTaskId: number | undefined;
      let targetProjectId: number | undefined;
      const detail = window.location.pathname.match(/^\/detail\/project-(\d+)\/(\d+)$/);
      if (newTaskWindow && detail && inView?.taskId) {
        const { data: task } = await axios.get("/api/tasks/single", { params: { id: inView.taskId } });
        if (task.projectId === Number(detail[1]) && task.uniqueIndex === Number(detail[2]) && isEmptyComposeTarget(task)) {
          existingTaskId = task.id;
          targetProjectId = task.projectId;
        }
      }
      const projectId = targetProjectId ?? composeTaskBoardId(window.location.href, parseCookies().previousBoard, lastUsedBoards);
      if (!projectId || !user?.id) throw new Error("Open a board first, then try again. Your note is still here.");
      let project = currentProject?.id === projectId ? currentProject : undefined;
      if (!project) {
        const projects: IProject[] = await globalAPIHandlers.getAllProjectsMinimal();
        project = projects.find((item) => item.id === projectId);
      }
      if (!mounted.current) return;
      if (!project) throw new Error("Your last board is unavailable. Open a board and try again.");
      const { task, writerFailed } = await createComposedTask({ text, files, project, userId: user.id, ...(existingTaskId ? { existingTaskId } : {}) });
      if (!mounted.current) return;
      if (!existingTaskId) createTaskGlobally({ task, sectionId: task.sectionId!, position: "top" });
      setIntro({ taskId: task.id, content: composeTaskAssistantMessage(task.ticketNumber ?? `${project.uniqueIdentifier ?? "TASK"}-${task.uniqueIndex}`, writerFailed) });
      updateActiveItemAndItemInView(task);
      setScope(projectId);
      setSidebar(true);
      setSuppressed(false);
      setExplicitOpen(Date.now());
      setShowChat(true);
      router.push(`/detail/project-${projectId}/${task.uniqueIndex}`);
      onCreated();
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
    <div hidden={!active} data-compose-task-writer className="max-h-[65dvh] overflow-y-auto"
      onDragOver={(event) => { if (!writing && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        void addImages(Array.from(event.dataTransfer.files));
      }}>
      {writing ? <FullScreenChatLoading inline label="Writing your ticket…" /> : (
        <div className="p-2">
          <div className="flex w-full flex-col rounded-[5px] bg-ai-tiptap px-3 py-2">
            {newTaskWindow && attachments}
            <AiComposerTextarea
              ref={input}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={newTaskWindow ? 10 : mobile ? 3 : 2}
              placeholder="Describe the task"
              aria-label="Describe the task"
              className={newTaskWindow ? "min-h-60 max-h-[440px] overflow-y-auto text-content caret-hypertasks-ai-purple" : "min-h-16 text-content"}
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
                {newTaskWindow && active && <AudioButton id="compose-task-audio-button" ariaLabel="Start dictation" editor={null}
                  defaultContent={text} hasText={Boolean(text.trim())} toggleRecording={setRecording} onProcessingChange={setTranscribing}
                  disabled={addingImages} mobilePrimaryTone="ai" mobilePresentation="compact"
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
