"use client";

import { EditorContent } from "@tiptap/react";
import { ChevronLeft, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ChangeEvent,
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
import { pageRoute } from "@/lib/constants/APIRouteConstants";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import {
  bindPageReturnEntry,
  returnFromPage,
  shouldReturnFromPageOnEscape,
  type NavigationHistoryLike,
} from "@/lib/navigation/pageReturn";
import { useRecoilValue } from "@/lib/state";
import type { IUser } from "@/models/model";
import { appShellRailAtom, showCommandsAtom } from "@/store";
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

const PageEditor = ({ _page, _user }: PageEditorProps) => {
  const page = JSON.parse(_page) as SerializedPage;
  const currentUser = JSON.parse(_user) as IUser;
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [version, setVersion] = useState(page.version);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [toggleHighlight, setToggleHighlight] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const railOn = useRecoilValue(appShellRailAtom);
  const showCommands = useRecoilValue(showCommandsAtom);
  const isMobile = useContext(MobileViewContext);
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
      if (shouldReturnFromPageOnEscape(event, showCommands.show)) {
        void returnToTask();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [returnToTask, showCommands.show]);

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

  const deletePage = async () => {
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
  };

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
      {showCommands.show && <HypertasksCommands />}
      {showRail && <AppShellRail variant="global" currentUser={currentUser} />}

      <div className={showRail ? "pl-[var(--app-shell-rail-w,48px)]" : ""}>
        <div
          className={`w-full ${isMobile ? "px-0" : "px-3"}`}
        >
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

          <div className="mb-8 rounded-none px-0 pb-16 pt-2">
            <input
              aria-label="Page title"
              value={title}
              onChange={handleTitleChange}
              placeholder="Untitled"
              style={{ border: 0, boxShadow: "none" }}
              className={`w-full bg-transparent p-0 font-semibold leading-tight text-white-black outline-none placeholder:text-text-light-gray focus:ring-0 ${
                isMobile ? "text-[24px]" : "text-[32px]"
              }`}
            />

            <div
              ref={contentRef}
              style={{ zoom, width: `${100 / zoom}%` }}
              className={`min-h-[420px] cursor-text touch-pan-y ${
                isMobile ? "mt-5" : "mt-8"
              } ${styles.hellow}`}
              onClick={() => editor?.commands.focus()}
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
