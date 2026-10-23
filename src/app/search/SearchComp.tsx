"use client";
import { ITypedTask, IUser } from "@/models/model";
import styles from "@/styles/search.module.scss";
import formatDateDifference from "@/utils/generateTime";
import { Check } from "lucide-react";
import { searchConfig } from "@/lib/configs/search.config";
import { useSearch } from "@/hooks/Search/useSearch";
import { cn } from "@/utils/undoActions/helperFuncs";
import { Fragment, RefObject, Suspense, startTransition, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFlag, useFlagLoaded } from "@/hooks/useFlag";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useRouter, useSearchParams } from "next/navigation";
import { buildFullScreenChatPath } from "@/lib/aiChatDisplayMode";
import { HTPR_6936_ASK_AI_FULLSCREEN_FLAG } from "@/lib/flags/keys";
import { highlightedSearchSnippet, highlightedTitle } from "@/lib/search/autocomplete";
import LabelWrapper from "@/components/Labels/LabelWrapper";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { aiChatPendingPromptAtom, appShellRailAtom, showCommandsAtom } from "@/store";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import SearchChipsInput from "./SearchChipsInput";
import "./search-autocomplete.css";
import type { CommandFocusProxy } from "@/components/commandTypes";
import type { ServerStartedSearch } from "@/lib/search/serverStartedSearch";
import { HTPR_7547_SEARCH_LAZY_CLOSED_FLAG, HTPR_7618_SEARCH_ROWS_FIT_PANE_FLAG } from "@/lib/flags/keys";

interface IProps {
  _searchTerm: string;
  _initialTabIndex?: number;
  _includeArchived: boolean;
  _fromProject?: number | null;
  currentUser: IUser;
  askAiFullscreenEnabled?: boolean;
  serverStartedSearch?: Promise<ServerStartedSearch | null>;
  searchOnce?: boolean;
}

const SearchComp = ({
  _searchTerm,
  _initialTabIndex,
  _includeArchived,
  _fromProject = null,
  currentUser,
  askAiFullscreenEnabled = false,
  serverStartedSearch,
  searchOnce = false,
}: IProps) => {
  const router = useRouter();
  const lazyClosedCommands = useFlag(HTPR_7547_SEARCH_LAZY_CLOSED_FLAG);
  const lazyClosedCommandsLoaded = useFlagLoaded(HTPR_7547_SEARCH_LAZY_CLOSED_FLAG);
  const [HypertasksCommands, setCommands] = useState<typeof import("@/components/commands").default>();
  const commandFocusProxy = useRef<CommandFocusProxy>({ current: null, compose: true }).current;
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const isApple = useDeviceContext();
  const askAiFullscreenFlagEnabled = useFlag(HTPR_6936_ASK_AI_FULLSCREEN_FLAG);
  const searchParams = useSearchParams();
  const searchTerm = askAiFullscreenEnabled && askAiFullscreenFlagEnabled
    ? searchParams?.get("searchTerm") ?? _searchTerm
    : _searchTerm;
  const rowsFitPane = useFlag(HTPR_7618_SEARCH_ROWS_FIT_PANE_FLAG);
  const setAiChatPendingPrompt = useSetRecoilState(aiChatPendingPromptAtom);
  const { openAIChatInterface } = useGlobalUIState();
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const {
    availableSearchBoards,
    setSelectedIndex,
    selectedIndex,
    tasksInputRef,
    inputValue,
    responseMessage,
    typedTasks,
    isSearchDraft,
    ulRef,
    handleLinkClick,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseMove,
    searchCache,
    updateSearchHistory,
    showCommands,
    setInputValue,
    liSelectedRef,
    tabs,
    activeSplit,
    updateSplitAndTasks,
    results,
    includeArchived,
    setIncludeArchivedResults,
  } = useSearch(searchTerm, _initialTabIndex, _includeArchived, _fromProject, serverStartedSearch, searchOnce);
  const loadCommands = () => {
    if (HypertasksCommands || (!showCommands.show && !lazyClosedCommandsLoaded)) return;
    let cancelled = false;
    void import("@/components/commands").then(({ default: Commands }) => {
      if (!cancelled) startTransition(() => setCommands(() => Commands));
    }).catch(() => {
      if (!cancelled && lazyClosedCommands) setShowCommands((prev) => prev.show ? { ...prev, show: false } : prev);
    });
    return () => { cancelled = true; };
  };
  useEffect(lazyClosedCommands && !showCommands.show ? () => {} : loadCommands,
    [HypertasksCommands, showCommands.show, lazyClosedCommands, lazyClosedCommandsLoaded]);
  useLayoutEffect(() => {
    if (showCommands.show && !HypertasksCommands) {
      commandFocusProxy.current?.focus({ preventScroll: true });
    } else if (!showCommands.show) {
      delete commandFocusProxy.pendingEnter;
      if (commandFocusProxy.current) {
        if (document.activeElement === commandFocusProxy.current) commandFocusProxy.current.blur();
        commandFocusProxy.current.value = "";
      }
    }
  }, [showCommands.show, HypertasksCommands]);
  const matchSnippets = typedTasks.map((task) => highlightedSearchSnippet((task.commentId ? task.commentText : task.descriptionText) ?? '', inputValue, true));

  function openAskAi(readableQuery?: string) {
    const query = readableQuery !== undefined ? readableQuery : inputValue.trim();
    if (!query) return;
    if (askAiFullscreenEnabled && askAiFullscreenFlagEnabled) {
      const searchUrl = new URL(window.location.href);
      searchUrl.searchParams.set("searchTerm", inputValue);
      const returnPath = `${searchUrl.pathname}${searchUrl.search}${searchUrl.hash}`;
      window.history.replaceState(window.history.state, "", returnPath);
      setAiChatPendingPrompt({ query, fullScreen: true });
      router.push(buildFullScreenChatPath(returnPath));
      return;
    }
    setAiChatPendingPrompt(query);
    openAIChatInterface();
  }

  function handleCommand(payload: unknown, mode: string) {
    if (mode === "ToggleArchivedSearchResults" && typeof payload === "boolean") {
      setIncludeArchivedResults(payload);
    }
  }

  const content = (
    <>
      <div
        suppressHydrationWarning
        onClick={(e) => setSelectedIndex(null)}
        autoFocus={false}
        className={cn(`py-9 min-h-screen bg-containerBackground flex-col rounded-[4px] my-0 global-view-width flex items-center  search-input  ${styles.links_modal}`, 'search-autocomplete')}
      >
        <div className={cn('w-full px-0', appShellRailOn && 'pl-[64px] @xl:pl-0')}>
          <SearchChipsInput
            value={inputValue}
            onChange={setInputValue}
            onRun={updateSearchHistory}
            boardId={_fromProject}
            inputRef={tasksInputRef}
            recentSearches={searchCache.history}
            layoutEnabled={true}
            availableBoards={availableSearchBoards}
            onAskAi={openAskAi}
            showSuggestions={isSearchDraft || !inputValue.trim()}
          />

          <>
              {responseMessage !== "None" &&
              typedTasks.length === 0 ? (
                <div className="px-4 @md:px-9 my-4">
                  <span className="text-text-light-gray">{responseMessage}</span>
                </div>
              ) : (
                <div>
                  {results && tabs.length > 2 && (
                    <div className={cn("hidden @md:block w-full overflow-x-auto scrollbar-none no-scrollbar @md:px-9 mt-4", "block px-4")}>
                      <div className="flex grow gap-3 [flex-wrap:nowrap] md:[flex-wrap:wrap] min-h-[44px] md:min-h-0 [&>div]:shrink-0 md:[&>div]:shrink">
                        {tabs.map((item, index) => (
                          <SplitTitle
                            key={`split-alltasks-${index}`}
                            isSelected={activeSplit === index}
                            onClick={() => updateSplitAndTasks(index)}
                            tab={{
                              idx: index,
                              project: item,
                              length: results[item].length,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {typedTasks.length > 0 && (
                    <ul
                      id={searchConfig.elementIds.results.id}
                      ref={ulRef}
                      onMouseMove={handleMouseMove}
                      className="rounded-b-[4px] mt-3 px-4 @md:px-9 text-dense text-white-black overflow-y-auto scrollbar-none"
                    >
                      {typedTasks.length > 0 &&
                        typedTasks.map((item, index) => {
                          const showThisBoard =
                            item.searchGroup === "current-board" &&
                            typedTasks[index - 1]?.searchGroup !==
                              "current-board" &&
                            typedTasks.some(
                              (task) => task.searchGroup === "other"
                            );
                          const showOtherBoards =
                            item.searchGroup === "other" &&
                            typedTasks[index - 1]?.searchGroup !== "other" &&
                            typedTasks
                              .slice(0, index)
                              .some(
                                (task) => task.searchGroup === "current-board"
                              );
                          return (
                            <Fragment
                              key={`${searchConfig.elementIds.results.childKeys}-${index}`}
                            >
                              {showThisBoard && (
                                <SearchGroupLabel label="This board" />
                              )}
                              {showOtherBoards && (
                                <SearchGroupLabel label="Other boards" />
                              )}
                              <TaskListRow
                                task={item}
                                highlight={item.highlight}
                                titleParts={highlightedTitle(item.taskTitle ?? '', inputValue, true)}
                                index={index}
                                handleLinkClick={handleLinkClick}
                                handleMouseEnter={handleMouseEnter}
                                handleMouseLeave={handleMouseLeave}
                                isActive={selectedIndex === index}
                                liRef={liSelectedRef}
                                snippetParts={matchSnippets[index]}
                                fitPane={rowsFitPane}
                              />
                            </Fragment>
                          );
                        })}
                    </ul>
                  )}
                </div>
              )}
            </>
        </div>
      </div>
      {showCommands.show && (
        <>
          <textarea
            ref={(input) => { commandFocusProxy.current = input; }}
            id="search-command-focus-proxy"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            tabIndex={-1}
            aria-label="Command search"
            className="fixed left-0 top-0 h-px w-px opacity-0 pointer-events-none text-[16px]"
            onInput={() => { delete commandFocusProxy.pendingEnter; }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) commandFocusProxy.pendingEnter = event.currentTarget.value;
              }
              if (event.key === "Escape" || (event.key.toLowerCase() === "k" &&
                ((isApple && event.metaKey) || (!isApple && event.ctrlKey)))) {
                event.preventDefault();
                setShowCommands((prev) => ({ ...prev, show: false }));
              }
            }}
          />
          {HypertasksCommands && (
            <Suspense fallback={null}>
              <HypertasksCommands
                callbackHandler={handleCommand}
                focusProxy={commandFocusProxy}
                contextOptions={{
                  context: "Others",
                  searchOptions: { includeArchived },
                }}
              />
            </Suspense>
          )}
        </>
      )}
    </>
  );

  return appShellRailOn ? (
    <>
      <AppShellRail variant="global" currentUser={currentUser} />
      <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div>
    </>
  ) : content;
};

const SearchGroupLabel = ({ label }: { label: string }) => (
  <li
    aria-hidden="true"
    className="py-2 text-micro font-medium text-text-light-gray list-none"
  >
    {label}
  </li>
);

interface ITaskRow {
  task: ITypedTask;
  handleMouseEnter: (index: number) => void;
  handleMouseLeave: () => void;
  handleLinkClick: (task: ITypedTask, idx: number) => Promise<void>;
  index: number;
  isActive: boolean;
  highlight: any;
  titleParts?: ReturnType<typeof highlightedTitle>;
  snippetParts?: ReturnType<typeof highlightedSearchSnippet>;
  fitPane?: boolean;
  liRef: RefObject<HTMLLIElement | null>;
}

const TaskListRow = (props: ITaskRow) => {
  const {
    task,
    handleLinkClick,
    handleMouseEnter,
    handleMouseLeave,
    index,
    isActive,
    highlight,
    titleParts,
    snippetParts,
    fitPane,
    liRef,
  } = props;

  return (
    <li
      suppressHydrationWarning
      id={`task_${task.taskId}`}
      onMouseEnter={() => handleMouseEnter(index)}
      onMouseLeave={handleMouseLeave}
      className="group/selection_row flex min-w-0 items-center gap-2 cursor-pointer"
      data-search-layout-row=""
      data-selected={isActive}
      onClick={() => handleLinkClick(task, index)}
      ref={liRef}
    >
      <div
        className={`font-medium min-w-0 [&>div]:min-w-0 text-white-black flex flex-col @md:flex py-2 @md:items-center gap-1 @md:!gap-3 ${fitPane ? styles.list_container_pane : styles.list_container}`}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center justify-center">
            <span className="font-medium @md:font-normal mb-1 @md:!mb-0">
              {task.projectTitle ?? `project-${task.projectId}`}
            </span>
          </div>
          <span className="text-[#8E9093] whitespace-nowrap @md:justify-self-end @md:hidden">
            {task.updatedAt && formatDateDifference(task.updatedAt)}
          </span>
        </div>
        <div className="flex gap-1 mb-1 @md:!mb-0">
          {highlight.ticketNumber ? (
            <span
              className="font-bold text-icon-dark-gray text-nowrap"
              dangerouslySetInnerHTML={{
                __html: highlight.ticketNumber.snippet,
              }}
            />
          ) : (
            <span className="font-bold text-icon-dark-gray text-nowrap">
              {task.ticketNumber}
            </span>
          )}
          {titleParts ? (
            <span className="font-bold truncate line-clamp-1">
              {titleParts.map((part, index) => part.matched
                ? <mark key={index} className="rounded-[2px] bg-search-highlight text-inherit">{part.text}</mark>
                : part.text)}
            </span>
          ) : highlight.title ? (
            <span
              className="font-bold truncate line-clamp-1"
              dangerouslySetInnerHTML={{ __html: highlight.title.snippet }}
            />
          ) : (
            <span className="font-bold truncate line-clamp-1">
              {task.taskTitle}
            </span>
          )}
        </div>

        {snippetParts ? (
          <div className="flex min-w-0 items-center gap-1 overflow-hidden mb-1 @md:!mb-0" data-search-match-highlights>
            {task.searchMatch?.people?.map((name) => (
              <span key={name} title={name} className="bg-mention-highlight text-mention-highlight rounded-[4px] px-1 py-0.5 truncate max-w-[120px] shrink-0">@{name}</span>
            ))}
            {[...(task.searchMatch?.labels ?? []), ...(task.searchMatch?.board ? [task.searchMatch.board] : [])].map((name, index) => (
              <LabelWrapper key={`${name}-${index}`} title={name} className="min-w-0 max-w-[120px] shrink-0"><span className="truncate">{name}</span></LabelWrapper>
            ))}
            {task.commentId && task.searchMatch?.commentAuthor && (
              <span title={task.searchMatch.commentAuthor} className="bg-mention-highlight text-mention-highlight rounded-[4px] px-1 py-0.5 truncate max-w-[120px] shrink-0">@{task.searchMatch.commentAuthor}</span>
            )}
            <span className="min-w-0 truncate text-text-light-gray">
              {snippetParts.map((part, index) => part.matched
                ? <mark key={index} className="rounded-[2px] bg-search-highlight text-inherit">{part.text}</mark>
                : part.text)}
            </span>
          </div>
        ) : task.commentId ? (
          highlight.commentText ? (
            <span
              suppressHydrationWarning
              className={`${styles.links_list} text-[#8E9093] font-bold mb-1 @md:!mb-0`}
              dangerouslySetInnerHTML={{
                __html: highlight.commentText.snippet,
              }}
            />
          ) : (
            <span
              suppressHydrationWarning
              className={`${styles.links_list} text-[#8E9093] font-bold mb-1 @md:!mb-0`}
            >
              {task.commentText ?? ""}
            </span>
          )
        ) : highlight.descriptionText ? (
          <span
            suppressHydrationWarning
            className={`${styles.links_list} text-[#8E9093] font-bold mb-1 @md:!mb-0`}
            dangerouslySetInnerHTML={{
              __html: highlight.descriptionText.snippet,
            }}
          />
        ) : (
          <span
            suppressHydrationWarning
            className={`${styles.links_list} text-[#8E9093] font-bold mb-1 @md:!mb-0`}
          >
            {task.descriptionText ?? ""}
          </span>
        )}

        <span
          suppressHydrationWarning
          className="hidden @md:flex @md:justify-self-end pr-4 mb-1 @md:!mb-0"
        >
          {task.status === "Normal" && (
            <Check size={16} className="text-white-black" strokeWidth={1.75} />
          )}
          {task.status === "Archive" && (
            <Check size={16} color="green" strokeWidth={1.75} />
          )}
        </span>

        <span className="text-[#8E9093] whitespace-nowrap @md:justify-self-end @md:block hidden">
          {task.updatedAt && formatDateDifference(task.updatedAt)}
        </span>

        <div className="border-b border-[hsla(216,8%,23%,0.2)] w-[90%] mx-auto my-2 block @md:hidden" />
      </div>
    </li>
  );
};

const SplitTitle = ({
  tab,
  isSelected,
  onClick,
}: {
  tab: {
    idx: number;
    project: string;
    length: number;
  };
  isSelected: boolean;
  onClick: any;
}) => {
  return (
    <div
      suppressHydrationWarning
      key={tab.project?.toString()}
      className={`cursor-pointer relative group @md:h-8 justify-start whitespace-nowrap items-center text-content  flex  gap-1 `}
      onClick={onClick}
    >
      <div
        className={`flex items-baseline gap-1 font-normal ${
          isSelected ? "text-white-black" : "text-text-light-gray"
        }`}
      >
        <span className="footer_tags">{tab.project}</span>

        {tab.length > 0 && (
          <p className="font-normal footer_tags text-micro ">{tab.length}</p>
        )}
      </div>
    </div>
  );
};

export default SearchComp;
