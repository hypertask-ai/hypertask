import { useContext, useEffect, useRef, useState } from "react";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { currentProjectAtom, currentUserAtom, lastUsedBoardsAtom, composeTaskChatIntroAtom, showAIChatInterfaceAtom, isAiChatSidebarModeAtom, aiChatAutoOpenSuppressedAtom, aiChatExplicitOpenAtAtom, dockedChatScopeAtom } from "@/store";
import { useRouter } from "next/navigation";
import { parseCookies } from "nookies";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useFileUpload } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
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
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG } from "@/lib/flags/keys";
import { discardUnboundCreateTaskUploads } from "@/lib/createTaskAttachmentUploads";
import type { IProject } from "@/models/model";

export default function ComposeTaskWriter({ active, onCreated, onBusyChange }: {
  active: boolean;
  onCreated: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const enabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const mobile = Boolean(useContext(MobileViewContext));
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingImages, setAddingImages] = useState(false);
  const pendingImages = useRef(0);
  const sending = useRef(false);
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

  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => discardUnboundCreateTaskUploads(filesRef.current), []);
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
    if (sending.current) return;
    if (images.some((file) => !file.type.startsWith("image/"))) {
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
    if (!enabled || sending.current || pendingImages.current > 0 || !text.trim()) return;
    sending.current = true;
    setWriting(true);
    onBusyChange(true);
    setError(null);
    try {
      const projectId = composeTaskBoardId(window.location.href, parseCookies().previousBoard, lastUsedBoards);
      if (!projectId || !user?.id) throw new Error("Open a board first, then try again. Your note is still here.");
      let project = currentProject?.id === projectId ? currentProject : undefined;
      if (!project) {
        const projects: IProject[] = await globalAPIHandlers.getAllProjectsMinimal();
        project = projects.find((item) => item.id === projectId);
      }
      if (!project) throw new Error("Your last board is unavailable. Open a board and try again.");
      const { task, writerFailed } = await createComposedTask({ text, files, project, userId: user.id });
      createTaskGlobally({ task, sectionId: task.sectionId!, position: "top" });
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
      setError(failure instanceof Error ? failure.message : "Couldn’t create the task. Your note is still here — try again.");
    } finally {
      sending.current = false;
      setWriting(false);
      onBusyChange(false);
    }
  };

  return enabled ? (
    <div hidden={!active} data-compose-task-writer>
      {writing ? <FullScreenChatLoading inline label="Writing your ticket…" /> : (
        <div className="p-2">
          <div className="flex w-full flex-col rounded-[5px] bg-ai-tiptap px-3 py-2">
            <AiComposerTextarea
              ref={input}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={mobile ? 3 : 2}
              placeholder="Describe the task"
              aria-label="Describe the task"
              className="min-h-16 text-content"
              onPaste={(event) => {
                const images = extractPastedImageFiles(event.clipboardData?.items);
                if (!images.length) return;
                event.preventDefault();
                void addImages(images);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  void send();
                }
              }}
            />
            {fileItems.length > 0 && <ImageGallery files={fileItems} images={[]} allowDelete shouldUpload={false} mode="others" handleRemove={(name: string) => {
              discardUnboundCreateTaskUploads(files.filter((file) => file.name === name));
              removeFile(name);
            }} variant="chat" />}
            <div className="flex w-full items-center justify-between pt-2">
              <AttachmentButton disabled={addingImages} mobile={mobile} onClick={handleAttachmentClick} />
              <SendMessageButton disabled={addingImages || !text.trim()} mobile={mobile} onClick={() => void send()} />
            </div>
          </div>
          <input type="file" accept="image/*" multiple hidden ref={fileInputRef} onChange={(event) => {
            void addImages(Array.from(event.target.files ?? []));
            event.target.value = "";
          }} />
          {error && <p role="alert" className="px-2 pt-2 text-meta text-text-light-gray">{error}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 border-t border-light-black-border-1 px-4 py-2 text-micro text-text-light-gray">
        <span><HintKey>Enter</HintKey> Send</span>
        <span><HintKey>Ctrl+U</HintKey> Add images</span>
        <span><HintKey>Ctrl+K</HintKey> Search</span>
        <span><HintKey>Esc</HintKey> Close</span>
      </div>
    </div>
  ) : null;
}
