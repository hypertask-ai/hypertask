"use client";

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { ArrowLeft, ChevronLeft, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";

import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import DragHandleTiptap from "@/components/RTE/Components/DragHandleTiptap";
import TiptapBubbleMenu from "@/components/RTE/Components/TiptapBubbleMenu";
import useTiptap from "@/components/RTE/Tiptap";
import { useContentZoom } from "@/hooks/General/useContentZoom";
import useDebounceWithCancel from "@/hooks/General/useDebounceWithCancel";
import { useFlag } from "@/hooks/useFlag";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import { HTPR_6872_PAGE_IMAGE_GALLERY_FLAG } from "@/lib/flags/keys";
import { isContentCarouselImage } from "@/utils/helperFunctions/isContentCarouselImage";
import { pageRoute } from "@/lib/constants/APIRouteConstants";
import { HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG } from "@/lib/flags/keys";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import {
  bindPageReturnEntry,
  returnFromPage,
  shouldReturnFromPageOnEscape,
  type NavigationHistoryLike,
} from "@/lib/navigation/pageReturn";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import type { IUser, TCarousalItems } from "@/models/model";
import { appShellRailAtom, showCommandsAtom } from "@/store";
import { currentPageActionsAtom } from "@/store/currentPageActions";
import styles from "@/styles/tiptap.module.scss";

type SerializedPage = {
  publicId: string;
  title: string;
  contentHtml: string;
  version: number;
  taskId: number;
  projectId: number;
  task: {
    projectId: number;
    uniqueIndex: number;
  };
};

type PageEditorProps = {
  _page: string;
  _user: string;
};

type SaveKind = "title" | "content";
type SaveStatus = "saving" | "saved" | "error";

const SAVE_DELAY = 750;
const HypertasksCommands = dynamic(() => import("@/components/commands"), {
  ssr: false,
});

// ProseMirror adds src-less separator images after inline nodes; they are not media.
const isPageGalleryImage = (image: HTMLImageElement) =>
  Boolean(image.getAttribute("src")) && isContentCarouselImage(image);

const AttachmentCarousel = dynamic(
  () => import("@/components/Common/AttachmentsView/AttachmentsCarousel"),
  { ssr: false },
);

const PageEditor = ({ _page, _user }: PageEditorProps) => {
  const page = JSON.parse(_page) as SerializedPage;
  const currentUser = JSON.parse(_user) as IUser;
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [version, setVersion] = useState(page.version);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [toggleHighlight, setToggleHighlight] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const galleryEnabled = useFlag(HTPR_6872_PAGE_IMAGE_GALLERY_FLAG);
  const [galleryItems, setGalleryItems] = useState<TCarousalItems>();
  const railOn = useRecoilValue(appShellRailAtom);
  const showCommands = useRecoilValue(showCommandsAtom);
  const isMobile = useContext(MobileViewContext);
  const mobilePageBackRowEnabled = useFlag(HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG);
  const setCurrentPageActions = useSetRecoilState(currentPageActionsAtom);
  const showRail = railOn && !isMobile;
  const versionRef = useRef(page.version);
  const titleRef = useRef(page.title);
  const generationRef = useRef<Record<SaveKind, number>>({
    title: 0,
    content: 0,
  });
  const pendingRef = useRef<Record<SaveKind, boolean>>({
    title: false,
    content: false,
  });
  const returningRef = useRef(false);
  const titleSaveChainRef = useRef(Promise.resolve());
  const contentSaveChainRef = useRef(Promise.resolve());
  const contentRef = useRef<HTMLDivElement>(null);
  const { zoom, showIndicator } = useContentZoom(contentRef, { min: 0.5 });
  const { editor } = useTiptap({
    mode: "read-edit-description",
    defaultContent: page.contentHtml,
  });

  const openImageGallery = useCallback((
    target: HTMLImageElement | HTMLIFrameElement,
    frameImages?: string[],
    frameIndex = 0,
  ) => {
    if (!galleryEnabled || !contentRef.current) return;

    const media = Array.from(contentRef.current.querySelectorAll<HTMLImageElement | HTMLIFrameElement>(
      ".ProseMirror img, .ProseMirror .ht-html-block iframe",
    ));
    const images = media.flatMap<{ element: HTMLImageElement | HTMLIFrameElement; src: string; index: number }>((element) => {
      if (element instanceof HTMLImageElement) {
        return isPageGalleryImage(element) ? [{ element, src: element.src, index: 0 }] : [];
      }
      const sources = element === target && frameImages
        ? frameImages
        : Array.from(new DOMParser().parseFromString(element.srcdoc, "text/html").querySelectorAll("img"))
            .filter(isContentCarouselImage)
            .map((image) => new URL(image.getAttribute("src") || "", window.location.href).href);
      return sources.map((src, index) => ({ element, src, index }));
    });
    const currentIndex = images.findIndex((image) => image.element === target && image.index === frameIndex);
    if (currentIndex < 0) return;

    setGalleryItems({
      attachments: images.map((image, index) => ({
        id: index + 1,
        createdAt: -1,
        fileType: "image/png",
        taskId: page.taskId,
        fileSource: image.src,
        fileName: "Image.png",
      })),
      currentIndex,
    });
  }, [galleryEnabled, page.taskId]);

  const handleContentClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (galleryEnabled && !event.defaultPrevented && event.button === 0 &&
        !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
        event.target instanceof HTMLImageElement && isPageGalleryImage(event.target)) {
      event.preventDefault();
      openImageGallery(event.target);
      return;
    }
    editor?.commands.focus();
  };

  useEffect(() => {
    if (!galleryEnabled) return;
    // Canvas frames have opaque origins, so only accept messages from this page's frames.
    const handleMessage = (event: MessageEvent) => {
      const frames = contentRef.current?.querySelectorAll<HTMLIFrameElement>(".ht-html-block iframe");
      const frame = Array.from(frames ?? []).find((item) => item.contentWindow === event.source);
      const data = event.data;
      if (!frame || data?.__htPageImage !== 1 || !Array.isArray(data.images) ||
          !data.images.every((src: unknown) => typeof src === "string" && /^(https?:|data:image\/|blob:)/i.test(src)) ||
          !Number.isInteger(data.index) || data.index < 0 || data.index >= data.images.length) return;
      openImageGallery(frame, data.images, data.index);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [galleryEnabled, openImageGallery]);

  const taskHref = `/detail/project-${page.task.projectId}/${page.task.uniqueIndex}`;

  useEffect(() => {
    try {
      bindPageReturnEntry({
        currentHref: window.location.href,
        taskHref,
        storage: window.sessionStorage,
        history: window.history,
        runtime: window,
      });
    } catch {
      // Direct Page visits still have the canonical task replacement below.
    }
  }, [taskHref]);

  const markPending = (kind: SaveKind) => {
    generationRef.current[kind] += 1;
    pendingRef.current[kind] = true;
    setSaveStatus("saving");
  };

  const finishSave = (
    kind: SaveKind,
    generation: number,
    result: "success" | "error"
  ) => {
    if (generationRef.current[kind] !== generation) return;

    pendingRef.current[kind] = false;
    if (result === "error") {
      setSaveStatus("error");
      return;
    }

    setSaveStatus(
      pendingRef.current.title || pendingRef.current.content
        ? "saving"
        : "saved"
    );
  };

  const patchPage = async (body: Record<string, unknown>) => {
    const response = await fetch(pageRoute(page.publicId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const responseBody = await response.json().catch(() => null);

    if (response.status === 409 && responseBody?.error === "version_conflict") {
      toast.error("This page changed elsewhere");
      window.location.reload();
      return null;
    }

    if (!response.ok) {
      throw new Error(responseBody?.error ?? "Unable to save page");
    }

    return responseBody;
  };

  const saveTitle = async (nextTitle: string, generation: number) => {
    try {
      await patchPage({ title: nextTitle });
      finishSave("title", generation, "success");
    } catch (error) {
      console.error("[Page title save] Error:", error);
      toast.error("Could not save the page title");
      finishSave("title", generation, "error");
    }
  };

  const saveContent = async (content: string, generation: number) => {
    try {
      const responseBody = await patchPage({
        content,
        content_type: "html",
        if_version: versionRef.current,
      });
      const nextVersion = responseBody?.page?.version;

      if (typeof nextVersion === "number") {
        versionRef.current = nextVersion;
        setVersion(nextVersion);
      }

      finishSave("content", generation, "success");
    } catch (error) {
      console.error("[Page content save] Error:", error);
      toast.error("Could not save the page");
      finishSave("content", generation, "error");
    }
  };

  const [debouncedTitleSave, cancelTitleSave, flushTitleSave] = useDebounceWithCancel(() => {
    const nextTitle = titleRef.current;
    const generation = generationRef.current.title;

    titleSaveChainRef.current = titleSaveChainRef.current.then(() =>
      saveTitle(nextTitle, generation)
    );
  }, SAVE_DELAY);

  const [debouncedContentSave, cancelContentSave, flushContentSave] = useDebounceWithCancel(() => {
    if (!editor) return;

    const content = editor.getHTML();
    const generation = generationRef.current.content;

    contentSaveChainRef.current = contentSaveChainRef.current.then(() =>
      saveContent(content, generation)
    );
  }, SAVE_DELAY);

  const returnToTask = useCallback(async () => {
    if (returningRef.current) return;
    returningRef.current = true;
    flushTitleSave();
    flushContentSave();
    await Promise.all([titleSaveChainRef.current, contentSaveChainRef.current]);

    try {
      returnFromPage({
        router,
        navigation: (window as Window & { navigation?: NavigationHistoryLike })
          .navigation,
        historyState: window.history.state,
        currentHref: window.location.href,
        taskHref,
        storage: window.sessionStorage,
      });
    } catch {
      router.replace(taskHref);
    }
  }, [flushContentSave, flushTitleSave, router, taskHref]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((galleryEnabled && galleryItems) || !shouldReturnFromPageOnEscape(event, showCommands.show)) return;
      if (document.querySelector(
        '.modal, [role="dialog"], [role="menu"], [role="listbox"], .tippy-box[data-state="visible"], [data-radix-popper-content-wrapper]',
      )) return;

      const focused = document.activeElement as HTMLElement | null;
      if (focused?.closest('.ProseMirror, [contenteditable="true"], input, textarea, select, [role="textbox"]')) {
        event.preventDefault();
        focused.blur();
        return;
      }

      event.preventDefault();
      void returnToTask();
    };

    // Suggestion plugins get first refusal, before ProseMirror's Escape fallback.
    const escapePluginKey = new PluginKey("pageEscapeBlur");
    editor?.registerPlugin(new Plugin({
      key: escapePluginKey,
      props: {
        handleKeyDown: (_view, event) => {
          handleKeyDown(event);
          return event.defaultPrevented;
        },
      },
    }));

    // Let editor and document-level layer handlers consume Escape first.
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      editor?.unregisterPlugin(escapePluginKey);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editor, galleryEnabled, galleryItems, returnToTask, showCommands.show]);

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      markPending("content");
      debouncedContentSave();
    };

    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
      cancelContentSave();
    };
  }, [cancelContentSave, debouncedContentSave, editor]);

  useEffect(
    () => () => {
      cancelTitleSave();
    },
    [cancelTitleSave]
  );

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextTitle = event.target.value;
    titleRef.current = nextTitle;
    setTitle(nextTitle);
    markPending("title");
    debouncedTitleSave();
  };

  const deletePage = useCallback(async () => {
    if (isDeleting || !window.confirm("Delete this page?")) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/pages/${page.publicId}/archive`, {
        method: "POST",
      });
      const responseBody = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(responseBody?.error ?? "Unable to delete page");
      }

      toast.success("Page deleted");
      router.push(taskHref);
    } catch (error) {
      console.error("[Delete page] Error:", error);
      toast.error(
        error instanceof Error ? error.message : "Unable to delete page"
      );
      setIsDeleting(false);
    }
  }, [isDeleting, page.publicId, router, taskHref]);

  useEffect(() => {
    if (!mobilePageBackRowEnabled || !isMobile) return;

    setCurrentPageActions({ publicId: page.publicId, version, onDelete: deletePage });
    return () => setCurrentPageActions(null);
  }, [deletePage, isMobile, mobilePageBackRowEnabled, page.publicId, setCurrentPageActions, version]);

  const statusText =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "error"
        ? "Save failed"
        : "Saved";

  return (
    <main
      aria-label={`Page editor for ${currentUser.displayName || "current user"}`}
      className="min-h-SVH-full bg-taskDetailPage text-white-black"
    >
      {galleryEnabled && galleryItems && (
        <AttachmentCarousel
          attachments={galleryItems.attachments}
          currentIndex={galleryItems.currentIndex}
          closeCallback={() => setGalleryItems(undefined)}
        />
      )}
      {showCommands.show && <HypertasksCommands />}
      {showRail && <AppShellRail variant="global" currentUser={currentUser} />}

      <div className={showRail ? "pl-[var(--app-shell-rail-w,48px)]" : ""}>
        <div
          className={`w-full ${isMobile ? "px-0" : "px-3"}`}
        >
          {mobilePageBackRowEnabled && isMobile ? (
            <div className="flex w-full items-center gap-2 px-2 pt-2" aria-live="polite">
              <button
                type="button"
                onClick={() => void returnToTask()}
                // Same control as Settings "Back to app"; 44px phone target.
                className={cn(
                  MOBILE_TARGET,
                  "min-w-0 flex-1 justify-start gap-2 rounded-sm px-2 text-left text-content font-medium text-text-light-gray transition hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none",
                )}
              >
                <ArrowLeft strokeWidth={1.75} className="h-4 w-4 shrink-0" />
                <span className="truncate">Back to task</span>
              </button>
              <span className="shrink-0 pr-2 text-meta text-text-light-gray">{statusText}</span>
            </div>
          ) : (
            <div
              className="flex h-8 items-center justify-between px-0 pt-2 text-meta text-text-light-gray"
              aria-live="polite"
            >
              <button
                type="button"
                onClick={() => void returnToTask()}
                className="inline-flex items-center gap-1 border-0 bg-transparent p-0 transition-colors hover:text-white-black"
              >
                <ChevronLeft size={14} strokeWidth={1.75} />
                Back to task
              </button>
              <div className="flex items-center gap-3">
                <span>{statusText}</span>
                <span className="opacity-40">·</span>
                <span>Version {version}</span>
                <button
                  type="button"
                  onClick={() => void deletePage()}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-1 transition-colors hover:text-white-black focus:outline-none disabled:cursor-default disabled:opacity-50"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                  Delete
                </button>
              </div>
            </div>
          )}

          <div className="mb-8 rounded-none px-0 pb-16 pt-2">
            <input
              aria-label="Page title"
              value={title}
              onChange={handleTitleChange}
              placeholder="Untitled"
              style={{ border: 0, boxShadow: "none" }}
              className={`w-full bg-transparent ${mobilePageBackRowEnabled && isMobile ? "px-4 py-0" : "p-0"} font-semibold leading-tight text-white-black outline-none placeholder:text-text-light-gray focus:ring-0 ${
                isMobile ? "text-[24px]" : "text-[32px]"
              }`}
            />

            <div
              ref={contentRef}
              style={{ zoom, width: `${100 / zoom}%` }}
              className={`min-h-[420px] cursor-text touch-manipulation ${
                isMobile ? "mt-5" : "mt-8"
              } ${styles.hellow}`}
              onClick={handleContentClick}
            >
              <div
                className={`min-h-[420px] w-full break-normal text-white-black ${styles.editorContainer}`}
              >
                {editor ? (
                  <>
                    <TiptapBubbleMenu
                      currentProjectId={page.projectId}
                      toggleHighlight={toggleHighlight}
                      allowPerks={false}
                      editor={editor}
                      toggleHighlightHandler={setToggleHighlight}
                    />
                    <DragHandleTiptap editor={editor} />
                    <EditorContent
                      editor={editor}
                      className={`min-h-[420px] ${isMobile ? "pb-16" : "pb-32"}`}
                    />
                  </>
                ) : (
                  <div className="h-[21px]" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
          showIndicator ? "opacity-100" : "opacity-0"
        }`}
      >
        <span className="rounded-lg bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </main>
  );
};

export default PageEditor;
