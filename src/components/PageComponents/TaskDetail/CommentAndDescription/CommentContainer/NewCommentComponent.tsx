import {
  useContext,
  useState,
  useMemo,
  useRef,
  useEffect,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { IAttachment, IComment, RedirectAPIParams, StackedType } from "@/models/model";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom, mobileCommentComposerOpenAtom } from "@/store";

// import Tiptap from "@/components/RTE/TipTap";
import dynamic from "next/dynamic"
const Tiptap = dynamic(()=>import("@/components/RTE/TipTapTaskDetail"))
import useSaveContent from "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { Check } from "lucide-react";
import MobileCreateTaskButton from "@/components/Global/MobileCreateTaskButton";
import { ArchiveNotificationIcon } from "@/lib/IconsLocal";
import useArchiveAndNavigate from "@/hooks/Task Detail/useArchiveAndNavigate";
import RemindMeTaskDetail from "../../TaskOptions/RemindMeTaskDetail";
import {
  getTiptapEditorForMode,
  OPEN_COMMENT_SNIPPET_EVENT,
  openSnippetPicker,
} from "@/lib/snippets";
import {
  getMobileCommentViewportGeometry,
  MOBILE_COMMENT_MIN_EDITOR_HEIGHT,
} from "@/lib/mobileCommentViewport";
import { shouldShowMobileDock } from "@/components/Global/mobileShellVisibility";
import { usePathname } from "next/navigation";
import { getTaskDraftContent } from "@/components/RTE/draftSync";

const MOBILE_DOCK_FALLBACK_HEIGHT = 64;

// import BackButton from "@/components/Buttons/BackButton";

const NewCommentComponent = (

    ) => {
  
      const {parsedTask:parsed_task, currentTask, setCurrentId, currentId, allowPerks,  forceOpenEdit,setLoading , editMode, draftsFromTQ} = useTaskContext();
      // console.log("🚀 ~ editMode:", editMode)
      const _parsedTask = useMemo(()=>JSON.parse(parsed_task),[parsed_task])
      const { replyQuote} = useDescriptionAndCommentsContext()
      const tiptapContainerRef = useRef<HTMLDivElement | null>(null)
      const openingSnippetRef = useRef(false);
      const [showTaskOptions, setShowTaskOptions] = useState(true);
      const [manualEditorHeight, setManualEditorHeight] = useState<number | null>(null);
      const [composerHeight, setComposerHeight] = useState(0);
      const [viewportMetrics, setViewportMetrics] = useState<{
        layoutViewportHeight: number;
        visualViewportHeight: number;
        visualViewportOffsetTop: number;
        dockInset: number;
        composerChromeHeight: number;
      } | null>(null);
      const resizeDragRef = useRef<{
        pointerId: number;
        startY: number;
        startEditorHeight: number;
      } | null>(null);
      const hasManualEditorHeight = manualEditorHeight !== null;
      const viewportGeometry = viewportMetrics
        ? getMobileCommentViewportGeometry({
            ...viewportMetrics,
            requestedEditorHeight: manualEditorHeight,
          })
        : null;
      const {redirectAPI} = useSaveContent()
      const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
      const _mbl = useContext(MobileViewContext);
      const pathname = usePathname();
      // The dock is hidden on the detail page, so it reserves no space and the
      // composer rests flush on the bottom edge (bottomInset falls to 0).
      const dockVisible = shouldShowMobileDock(pathname);
      // True while the mobile composer is actually focused (keyboard up). We
      // key the tab-bar hide on real focus rather than editMode/currentId,
      // which are write-once on mobile and would leave the nav stuck hidden
      // after a send or tap-away. When it holds we hide the bottom tab bar and
      // stop reserving dock space so the sheet sits on the keyboard.
      const [composerOpen, setMobileCommentComposerOpen] = useRecoilState(
        mobileCommentComposerOpenAtom
      );
      const defaultCommentContent = getTaskDraftContent(
        draftsFromTQ,
        _parsedTask?.id,
        "Comment",
      );
      // auto-saved drafts are often "<p></p>": strip tags so visually-empty drafts don't mount the editor (media tags count as content)
      const hasDraftContent =
        /<(img|video|iframe)/i.test(defaultCommentContent) ||
        defaultCommentContent.replace(/<[^>]*>/g, "").trim().length > 0;
      const shouldMountCommentEditor =
        // not currentId === "comment": defaultCommentFocus sets that on task open (keyboard-nav selection, not typing intent)
        currentId === "comment-input" ||
        editMode === "comment" ||
        editMode === "new-comment-ai" ||
        hasDraftContent ||
        Boolean(replyQuote);
      const [hasMountedCommentEditor, setHasMountedCommentEditor] = useState(shouldMountCommentEditor);
      // Desktop: always render the editor (unfocused) so the composer shows its
      // active toolbar at rest instead of a blank placeholder. The focus effect
      // only fires on currentId === "comment-input", so mounting stays cursor-free
      // and keyboard nav is unaffected. Mobile keeps the lazy collapsed state.
      const shouldRenderCommentEditor = shouldMountCommentEditor || hasMountedCommentEditor || !_mbl;

      const handleTaskOptions = (val:boolean) => setShowTaskOptions(val)
      const resetManualResizeIfEmpty = () => {
        if (!hasManualEditorHeight) return;
        window.requestAnimationFrame(() => {
          const editor = getTiptapEditorForMode("create-comment");
          if (editor?.isEmpty) setManualEditorHeight(null);
        });
      };
      const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;

        const composer = tiptapContainerRef.current as HTMLElement | null;
        const editorContainer = composer?.querySelector<HTMLElement>(
          "#comment-input-input"
        );
        if (!composer || !editorContainer) return;

        const editorHeight = editorContainer.getBoundingClientRect().height;
        resizeDragRef.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startEditorHeight: editorHeight,
        };
        setManualEditorHeight(editorHeight);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      };
      const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = resizeDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;

        const nextHeight = drag.startEditorHeight + drag.startY - event.clientY;
        setManualEditorHeight(
          Math.min(
            viewportGeometry?.manualEditorMaxHeight ?? nextHeight,
            Math.max(MOBILE_COMMENT_MIN_EDITOR_HEIGHT, nextHeight)
          )
        );
        event.preventDefault();
      };
      const handleResizePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (resizeDragRef.current?.pointerId !== event.pointerId) return;
        resizeDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        event.stopPropagation();
      };
      const handleOpenCommentEditor = () => {
        setHasMountedCommentEditor(true);
        forceOpenEdit("comment");
        setCurrentId("comment-input");
        // If the editor is already mounted (re-opening, or a draft pre-mounted
        // it), focus synchronously inside the tap gesture so iOS opens the
        // keyboard reliably. First mount is handled by the focus effect below.
        // Skip when the editor is already focused: the click landed inside the
        // text and the browser already placed the caret there — forcing "end"
        // would yank the caret to the bottom on every mid-text click.
        const editor = getTiptapEditorForMode("create-comment");
        if (editor && !editor.isDestroyed && !editor.isFocused)
          editor.commands.focus("end");
      }
      const redirectMiddleware = (obj: RedirectAPIParams) =>{
        redirectAPI(obj);
        setTimeout(()=>{
          setShowTaskOptions(true)
        },200)
      }

      useEffect(() => {
        if (shouldMountCommentEditor) setHasMountedCommentEditor(true);
      }, [shouldMountCommentEditor]);

      // Track composer focus and publish it to the global tab bar. focusin/
      // focusout bubble, so we catch the editor and every toolbar control
      // inside the composer. On blur we re-check next frame, because focus may
      // just be moving to another control inside the composer (e.g. the send
      // button) — only truly leaving it (send, tap-away, keyboard dismiss)
      // shows the nav again. Reset on unmount so the bar can never stick hidden.
      useEffect(() => {
        if (!_mbl) return;
        const container = tiptapContainerRef.current;
        if (!container) return;

        let frame: number | undefined;
        const sync = () => {
          const active = document.activeElement;
          const open =
            !!active && active !== document.body && container.contains(active);
          setMobileCommentComposerOpen(open);
        };
        const onFocusIn = () => {
          if (frame !== undefined) window.cancelAnimationFrame(frame);
          sync();
        };
        const onFocusOut = () => {
          if (frame !== undefined) window.cancelAnimationFrame(frame);
          frame = window.requestAnimationFrame(sync);
        };

        container.addEventListener("focusin", onFocusIn);
        container.addEventListener("focusout", onFocusOut);
        sync();
        return () => {
          if (frame !== undefined) window.cancelAnimationFrame(frame);
          container.removeEventListener("focusin", onFocusIn);
          container.removeEventListener("focusout", onFocusOut);
          setMobileCommentComposerOpen(false);
        };
      }, [_mbl, shouldRenderCommentEditor, setMobileCommentComposerOpen]);

      useEffect(() => {
        if (!_mbl) return;

        const visualViewport = window.visualViewport;
        let animationFrameId: number | undefined;

        const measureViewportAndComposer = () => {
          if (animationFrameId !== undefined) {
            window.cancelAnimationFrame(animationFrameId);
          }
          animationFrameId = window.requestAnimationFrame(() => {
            const composer = tiptapContainerRef.current;
            const editorContainer = composer?.querySelector<HTMLElement>(
              "#comment-input-input"
            );
            const measuredComposerHeight =
              composer?.getBoundingClientRect().height ?? 0;
            const editorHeight =
              editorContainer?.getBoundingClientRect().height ?? 0;
            const publishedDockHeight = Number.parseFloat(
              window
                .getComputedStyle(document.documentElement)
                .getPropertyValue("--mobile-dock-h")
            );

            setComposerHeight(Math.ceil(measuredComposerHeight));
            setViewportMetrics({
              layoutViewportHeight: Math.max(
                window.innerHeight,
                document.documentElement.clientHeight
              ),
              visualViewportHeight:
                visualViewport?.height ?? window.innerHeight,
              visualViewportOffsetTop: visualViewport?.offsetTop ?? 0,
              // While the composer is focused the tab bar is hidden, so it
              // reserves no space.
              dockInset:
                dockVisible && !composerOpen
                  ? Number.isFinite(publishedDockHeight)
                    ? publishedDockHeight
                    : MOBILE_DOCK_FALLBACK_HEIGHT
                  : 0,
              composerChromeHeight: Math.max(
                0,
                measuredComposerHeight - editorHeight
              ),
            });
          });
        };

        const resizeObserver = new ResizeObserver(measureViewportAndComposer);
        const dockHeightObserver = new MutationObserver(
          measureViewportAndComposer
        );
        if (tiptapContainerRef.current) {
          resizeObserver.observe(tiptapContainerRef.current);
        }
        dockHeightObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["style"],
        });
        window.addEventListener("resize", measureViewportAndComposer);
        visualViewport?.addEventListener("resize", measureViewportAndComposer);
        visualViewport?.addEventListener("scroll", measureViewportAndComposer);
        measureViewportAndComposer();

        return () => {
          if (animationFrameId !== undefined) {
            window.cancelAnimationFrame(animationFrameId);
          }
          resizeObserver.disconnect();
          dockHeightObserver.disconnect();
          window.removeEventListener("resize", measureViewportAndComposer);
          visualViewport?.removeEventListener("resize", measureViewportAndComposer);
          visualViewport?.removeEventListener("scroll", measureViewportAndComposer);
        };
      }, [_mbl, dockVisible, shouldRenderCommentEditor, composerOpen]);

      useEffect(() => {
        let timeoutId: number | undefined;

        const handleOpenSnippet = () => {
          if (openingSnippetRef.current) return;
          openingSnippetRef.current = true;
          setHasMountedCommentEditor(true);
          forceOpenEdit("comment");
          setCurrentId("comment-input");

          let attempts = 0;
          const focusAndOpen = () => {
            const editor = getTiptapEditorForMode("create-comment");
            if (editor && !editor.isDestroyed) {
              openSnippetPicker(editor);
              window.setTimeout(() => {
                openingSnippetRef.current = false;
              }, 100);
              return;
            }
            attempts += 1;
            if (attempts >= 40) {
              openingSnippetRef.current = false;
              return;
            }
            timeoutId = window.setTimeout(focusAndOpen, 25);
          };

          focusAndOpen();
        };

        window.addEventListener(OPEN_COMMENT_SNIPPET_EVENT, handleOpenSnippet);
        return () => {
          window.removeEventListener(OPEN_COMMENT_SNIPPET_EVENT, handleOpenSnippet);
          if (timeoutId) window.clearTimeout(timeoutId);
        };
      }, [forceOpenEdit, setCurrentId]);

      // Dictation shortcuts from the task page (desktop): the editor's onKeyDown
      // only fires while focused, so at rest Chrome swallows CTRL+SHIFT+D
      // (bookmark-all-tabs). A document listener reclaims them: D = speech to text,
      // F = dictate and improve. Skips when another input/editor has focus (those
      // own the shortcut), and lets the editor's own handler run when focused there.
      useEffect(() => {
        if (_mbl) return;
        const onKeyDown = (e: KeyboardEvent) => {
          const cmdControl = e.metaKey || e.ctrlKey;
          if (!cmdControl || !e.shiftKey) return;
          if (e.keyCode !== 68 && e.keyCode !== 70) return;
          const anchorId =
            "create-comment-audio-button" + (e.keyCode === 70 ? "-improve" : "");
          const anchor = document.getElementById(anchorId);
          if (!anchor) return;
          const active = document.activeElement as HTMLElement | null;
          const inComment = Boolean(active?.closest?.("#comment"));
          if (inComment) return; // the editor's own onKeyDown handles it
          const inOtherField =
            Boolean(active) &&
            (active!.tagName === "INPUT" ||
              active!.tagName === "TEXTAREA" ||
              active!.isContentEditable);
          if (inOtherField) return; // another composer owns the shortcut
          e.preventDefault();
          anchor.click();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
      }, [_mbl]);

      useEffect(() => {
        if (!shouldRenderCommentEditor || currentId !== "comment-input") return;

        let animationFrameId: number | undefined;
        let observer: MutationObserver | undefined;

        const focusEditor = () => {
          const container = tiptapContainerRef.current as HTMLElement | null;
          const editorElement = container?.querySelector<HTMLElement>(
            '#comment-input [contenteditable="true"]'
          );

          if (!editorElement) return false;

          editorElement.focus();
          if (_mbl) handleTaskOptions(false);
          return true;
        };

        const disconnectObserver = () => {
          observer?.disconnect();
          observer = undefined;
        };

        animationFrameId = window.requestAnimationFrame(() => {
          if (focusEditor()) return;

          const container = tiptapContainerRef.current as HTMLElement | null;
          if (container) {
            observer = new MutationObserver(() => {
              if (focusEditor()) disconnectObserver();
            });
            observer.observe(container, { childList: true, subtree: true });
          }
        });

        return () => {
          if (animationFrameId !== undefined) window.cancelAnimationFrame(animationFrameId);
          disconnectObserver();
        };
      }, [shouldRenderCommentEditor, currentId, _mbl]);

      return (
          <>
              <div id="bottom" className="h-0"></div>
  
              {_mbl && (
                  <div
                      aria-hidden="true"
                      className="w-full shrink-0 bg-transparent"
                      style={{
                        height:
                          composerHeight + (viewportGeometry?.bottomInset ?? 0),
                      }}
                  />
              )}

              {_mbl && composerHeight > 0 && (
                <MobileCreateTaskButton
                  bottomOffset={
                    composerHeight + (viewportGeometry?.bottomInset ?? 0)
                  }
                />
              )}
  
              {/* ------------------------- New Comment ------------------------- */}
              {/* ====================== DESKTOP ===================== */}
              {!_mbl ? (
                  <div
                      tabIndex={0}
                      onClick={handleOpenCommentEditor}
                      ref={tiptapContainerRef}
                      id="comment"
                      className={`flex flex-col relative z-10 justify-between items-center my-[8px] outline-none w-full bg-comment-description shadow-md rounded-md
                      border-l-4

                          ${(currentId === `comment`) || (currentId === `comment-input`) ? ` ${currentId === `comment-input` ? `border-[#C2CFA5]` : `border-selected-item-border`} bg-comment-description` : `border-transparent`}
                      `}
                  >
                      <div className="pt-[20px] pb-1 px-[16px] w-full">
                        {shouldRenderCommentEditor ? (
                          <Tiptap
                              key={`comment-input-${_parsedTask.id}`}
                              allowPerks={allowPerks}
                              handleSave={redirectAPI}
                              mode={"create-comment"}
                              reply={replyQuote}
                              allowEdit={true}
                              isMbl={_mbl}
                              shouldTriggerAiTaskWriter={editMode==="new-comment-ai"}
                              creatorname={currentUser?.displayName}
                              // createdAt={comment.createdAt}
                              // user={users.find(user => user.id === comment.creatorId)}
                              isSelected={[`comment-input`].includes(currentId!)}
                              id={`comment-input`}
                              customPlaceholder={"Comment"}
                              setLoading={setLoading}
                              defaultContent={defaultCommentContent}
                              className1="mobile_comment_editor"
                              currentTask={_parsedTask}
                              createNewComment={editMode==="comment" || editMode === "new-comment-ai"}
                          />
                        ) : (
                          <NewCommentPlaceholder isMbl={_mbl}/>
                        )}
                      </div>
                  </div>
              )
              // {/* ------------------------- New Comment ------------------------- */}
              // {/* ====================== MOBILE ===================== */}
              : (
                  // HTPR-5919's owner-approved prototype intentionally replaces the prior sheet and recessed well.
                  <div
                    tabIndex={-1}
                    onClick={handleOpenCommentEditor}
                    onInput={resetManualResizeIfEmpty}
                    onBlur={resetManualResizeIfEmpty}
                    data-manual-resize={manualEditorHeight !== null ? "true" : undefined}
                    style={{
                      zIndex: "101",
                      bottom: viewportGeometry
                        ? `${viewportGeometry.bottomInset}px`
                        : 0,
                      "--mobile-comment-auto-editor-max-height": viewportGeometry
                        ? `${viewportGeometry.autoEditorMaxHeight}px`
                        : "55vh",
                      "--mobile-comment-editor-height":
                        viewportGeometry?.renderedEditorHeight !== null &&
                        viewportGeometry?.renderedEditorHeight !== undefined
                          ? `${viewportGeometry.renderedEditorHeight}px`
                          : undefined,
                    } as CSSProperties}
                    ref={tiptapContainerRef}
                    id="comment"
                    className="fixed left-0 flex w-full flex-col bg-transparent outline-none pb-[env(safe-area-inset-bottom)]"
                  >
                    <div
                      aria-label="Resize comment field"
                      aria-orientation="horizontal"
                      role="separator"
                      className="flex h-4 w-full shrink-0 touch-none cursor-ns-resize items-center justify-center"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={handleResizePointerDown}
                      onPointerMove={handleResizePointerMove}
                      onPointerUp={handleResizePointerEnd}
                      onPointerCancel={handleResizePointerEnd}
                    >
                      <span className="h-1 w-9 rounded-full bg-[#4F5766]" />
                    </div>
                    <div className="relative w-full px-[12px] pb-[6px]">
                      <TaskOptions show={showTaskOptions}/>
                      <div className="rounded-[8px] border border-comment-description-border bg-cardBackground px-[12px] py-[4px]">
                      {shouldRenderCommentEditor ? (
                      <Tiptap
                        key={`comment-input-${_parsedTask.id}`}
                        allowPerks={allowPerks}
                        handleSave={redirectMiddleware}
                        mode={"create-comment"}
                        allowEdit={true}
                        isMbl={_mbl}
                        shouldTriggerAiTaskWriter={editMode==="new-comment-ai"}
                        creatorname={currentUser?.displayName}
                        isSelected={[`comment`, `comment-input`].includes(
                          currentId!
                        )}
                        id={`comment-input`}
                        customPlaceholder={"Add a comment…"}
                        defaultContent={defaultCommentContent}
                        className1="mobile_comment_editor"
                        handleTaskOptions={handleTaskOptions}
                        reply={replyQuote}
                        createNewComment={editMode==="comment" || editMode === "new-comment-ai"}
                      />
                      ) : (
                        <NewCommentPlaceholder isMbl={_mbl}/>
                      )}
                      </div>

                    </div>
                  </div>
              )
          
          }
          </>
      );
  };

  const NewCommentPlaceholder = ({isMbl}:{isMbl:boolean}) => (
    <div
      id="comment-input"
      tabIndex={isMbl ? -1 : 0}
      className={`w-full outline-none ${
        isMbl
          ? "flex bg-transparent"
          : "flex flex-col bg-comment-description"
      }`}
    >
      <div
        id="comment-input-input"
        className={`w-full break-normal ${
          isMbl
            ? "min-h-[39px] max-h-[80px] py-[8px]"
            : "min-h-[80px] max-w-[85cqw] @sm:max-w-[560px] @md:max-w-full"
        }`}
      >
        <p
          data-placeholder={isMbl ? "Add a comment…" : "Comment"}
          className="m-0 text-content font-normal leading-[150%] text-[#adb5bd] pointer-events-none"
        >
          {isMbl ? "Add a comment…" : "Tip: Hit CTRL+M to comment"}
        </p>
      </div>
      {!isMbl && <div aria-hidden="true" className="h-[37px] w-full" />}
    </div>
  )
  
  const TaskOptions = ({show}:{show:boolean}) => {

    // Read the reactive currentTask (not the frozen server parse) so the inbox
    // actions appear/disappear live as the notification is removed or undone —
    // same rationale as the desktop TaskOptions.
    const {currentId, currentTask} = useTaskContext()
    const inInbox = !!(
      currentTask?._count?.notifications && currentTask._count.notifications > 0
    )

    if (!inInbox || !show) return null;

    return (
      
      <div 
      className={`mb-[8px] flex items-center justify-evenly gap-[8px] text-text-light-gray ${currentId}`}>
        {/* <DoneButton/> */}
        { 
        inInbox ?
          <>
            <SnoozeButton/>
            <ArchiveFromInboxButton/>
          </>
          :
          <></>
        }
      </div>
     
    )
  }

  
  const ArchiveFromInboxButton = ()=>{
    const {navigateToNextTask} = useArchiveAndNavigate()

    return (
      <div onClick={()=>{navigateToNextTask(true,true)}} className="flex items-center gap-2 whitespace-nowrap">
        {/* Blue when the task is in the inbox, matching desktop's ArchiveTaskNotification (hypertasks-header-blue). This button only renders in-inbox, so it's always blue. */}
        <ArchiveNotificationIcon height={18} width={18} show={true} color="rgb(35, 131, 226)"/>

        <span>Remove notification</span>
      </div>
    )
  }
  const DoneButton = ()=>{
    const {markAsDone} = useArchiveAndNavigate()
    const {currentId, parsedTask:parsed_task} = useTaskContext()
    const _parsedTask = useMemo(()=>JSON.parse(parsed_task),[parsed_task])
    const inInbox =  _parsedTask?._count?.notifications&&
    _parsedTask?._count?.notifications>0
    return (
      <div onClick={()=>markAsDone()}  className="flex items-center gap-2">
        <Check
                  className={`transition-colors duration-75 font-bold  text-text-light-gray stroke-[4px]`}
                  size={24}
                 strokeWidth={1.75}/>
        <span>
        {
         inInbox?
         "Done"
         :
         "Mark task as done"
         
         }
        </span>
      </div>
    )
  }

  const SnoozeButton = ()=>{
    const {navigateToNextTask} = useArchiveAndNavigate()

    return (
      <>
      <RemindMeTaskDetail  color="#95999E" hoverText="#95999E" navigateToNextTask={navigateToNextTask}>
          <span>Snooze</span>
      </RemindMeTaskDetail>
      </>
    )
  }

  export default NewCommentComponent
