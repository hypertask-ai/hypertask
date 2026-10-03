"use client";
import { ITypedTask, IUser } from "@/models/model";
import styles from "@/styles/search.module.scss";
import HypertasksCommands from "@/components/commands";
import formatDateDifference from "@/utils/generateTime";
import { Check } from "lucide-react";
import { searchConfig } from "@/lib/configs/search.config";
import { useSearch } from "@/hooks/Search/useSearch";
import { cn } from "@/utils/undoActions/helperFuncs";
import { Fragment, KeyboardEvent, RefObject, useContext } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6372_SEARCH_RANKING_FLAG, HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG, HTPR_6865_SEARCH_LAYOUT_FLAG, HTPR_6878_SEARCH_LABEL_SCOPE_FLAG, HTPR_6879_SEARCH_ESC_BACK_FLAG, HTPR_6880_SEARCH_COMMENTER_FLAG } from "@/lib/flags/keys";
import { highlightedSearchSnippet, highlightedTitle } from "@/lib/search/autocomplete";
import { HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG, HTPR_6909_SEARCH_ONE_BOARD_TABS_FLAG, HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG } from "@/lib/flags/keys";
import LabelWrapper from "@/components/Labels/LabelWrapper";
import { HTPR_6370_SEARCH_CHIPS_FLAG, HTPR_6369_SEARCH_OPERATORS_FLAG } from "@/lib/flags/keys";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { aiChatPendingPromptAtom, appShellRailAtom } from "@/store";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import SearchChipsInput from "./SearchChipsInput";
import "./search-autocomplete.css";

interface IProps {
  _searchTerm: string;
  _initialTabIndex?: number;
  _includeArchived: boolean;
  _fromProject?: number | null;
  currentUser: IUser;
}

const SearchComp = ({
  _searchTerm,
  _initialTabIndex,
  _includeArchived,
  _fromProject = null,
  currentUser,
}: IProps) => {
  const rankingEnabled = useFlag(HTPR_6372_SEARCH_RANKING_FLAG);
  const chipsFlagEnabled = useFlag(HTPR_6370_SEARCH_CHIPS_FLAG);
  const operatorsFlagEnabled = useFlag(HTPR_6369_SEARCH_OPERATORS_FLAG);
  const autocompleteFlagEnabled = useFlag(HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG);
  const autocompleteEnabled = autocompleteFlagEnabled && chipsFlagEnabled && operatorsFlagEnabled;
  const layoutFlagEnabled = useFlag(HTPR_6865_SEARCH_LAYOUT_FLAG);
  const layoutEnabled = layoutFlagEnabled && autocompleteEnabled;
  const matchHighlightsFlagEnabled = useFlag(HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG);
  const rowHighlightFlagEnabled = useFlag(HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG);
  // Hides the tab row when the tabs are only "All" plus one board.
  const oneBoardTabsFlagEnabled = useFlag(HTPR_6909_SEARCH_ONE_BOARD_TABS_FLAG);
  const commenterFlagEnabled = useFlag(HTPR_6880_SEARCH_COMMENTER_FLAG);
  const labelScopeFlagEnabled = useFlag(HTPR_6878_SEARCH_LABEL_SCOPE_FLAG);
  const searchEscBackFlagEnabled = useFlag(HTPR_6879_SEARCH_ESC_BACK_FLAG);
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
    handleChange,
    responseMessage,
    typedTasks,
    isSearchDraft,
    ulRef,
    handleLinkClick,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseMove,
    searchCache,
    selectedHistory,
    updateSearchHistory,
    showCommands,
    setInputValue,
    searchChipsEnabled,
    liSelectedRef,
    tabs,
    activeSplit,
    updateSplitAndTasks,
    results,
    suggestedValue,
    includeArchived,
    setIncludeArchivedResults,
  } = useSearch(_searchTerm, _initialTabIndex, _includeArchived, _fromProject);
  const matchSnippets = matchHighlightsFlagEnabled && layoutEnabled
    ? typedTasks.map((task) => highlightedSearchSnippet((task.commentId ? task.commentText : task.descriptionText) ?? '', inputValue, commenterFlagEnabled && layoutEnabled))
    : undefined;
  const showAskAiRow =
    !layoutEnabled && inputValue.trim().length >= 2 && typedTasks.length === 0;
  const searchTextClassName =
    "w-full px-4 @md:!px-9 text-subheading font-medium leading-normal rounded-b-[4px] bg-inherit outline-none";

  // Ask AI hands the query to the single general AI chat (auto-sent there via
  // aiChatPendingPromptAtom) instead of a separate in-search panel.
  function openAskAi(readableQuery?: string) {
    const query = labelScopeFlagEnabled && layoutEnabled && readableQuery !== undefined ? readableQuery : inputValue.trim();
    if (!query || (!layoutEnabled && query.length < 2)) return;
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
        className={cn(`py-9 min-h-screen bg-containerBackground flex-col rounded-[4px] my-0 global-view-width flex items-center  search-input  ${styles.links_modal}`, autocompleteEnabled && 'search-autocomplete')}
      >
        {/* Below @xl the container is full-width, so clear the fixed back button (ends at x≈96) */}
        <div className={cn('w-full px-0', appShellRailOn && 'pl-[64px] @xl:pl-0')}>
          {chipsFlagEnabled && operatorsFlagEnabled && searchChipsEnabled ? (
            autocompleteFlagEnabled ? (
              <SearchChipsInput
                value={inputValue}
                onChange={setInputValue}
                onRun={updateSearchHistory}
                boardId={_fromProject}
                inputRef={tasksInputRef}
                recentSearches={searchCache.history}
                layoutEnabled={layoutEnabled}
                availableBoards={labelScopeFlagEnabled && layoutEnabled ? availableSearchBoards : undefined}
                onAskAi={openAskAi}
                showSuggestions={isSearchDraft || (searchEscBackFlagEnabled && layoutEnabled && !inputValue.trim())}
                autocompleteEnabled
              />
            ) : (
              <SearchChipsInput
                value={inputValue}
                onChange={setInputValue}
                onRun={updateSearchHistory}
                boardId={_fromProject}
                inputRef={tasksInputRef}
              />
            )
          ) : (
          <div className="relative w-full">
              <span
                className={`${searchTextClassName} text-icon-hover-gray`}
                aria-hidden="true"
              >
                {suggestedValue}
              </span>

              <input
                id={searchConfig.elementIds.input.id}
                placeholder={searchConfig.elementIds.input.placeholder}
                tabIndex={0}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                ref={tasksInputRef}
                className={`${searchTextClassName} absolute left-0 top-0 z-10 text-white-black [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none`}
                value={inputValue}
                onChange={handleChange}
                onKeyDown={(e) => {
                  // ArrowDown moves focus from writing mode into the Ask AI row
                  if (e.key === "ArrowDown" && showAskAiRow) {
                    e.preventDefault();
                    e.stopPropagation();
                    document
                      .getElementById(searchConfig.elementIds.askAiRow.id)
                      ?.focus();
                  }
                }}
              />
            </div>
          )}

          <>
              {responseMessage !== "None" &&
              typedTasks.length === 0 &&
              !showAskAiRow ? (
                <div className={layoutFlagEnabled && autocompleteEnabled ? "px-4 @md:px-9 my-4" : "px-0 @md:!px-16 my-4"}>
                  <span className={layoutEnabled ? "text-text-light-gray" : "text-[#8e9093]"}>{responseMessage}</span>
                </div>
              ) : (
                <div>
                  {results && !(oneBoardTabsFlagEnabled && tabs.length <= 2) && (
                    <div className={cn("hidden @md:block w-full overflow-x-auto scrollbar-none no-scrollbar @md:px-9 mt-4", layoutEnabled && "px-4")}>
                      <div className="flex flex-wrap grow gap-3">
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
                  {(showAskAiRow || typedTasks.length > 0) && (
                    <ul
                      id={searchConfig.elementIds.results.id}
                      ref={ulRef}
                      onMouseMove={handleMouseMove}
                      className={layoutEnabled ? "rounded-b-[4px] mt-3 px-4 @md:px-9 text-dense text-white-black overflow-y-auto scrollbar-none" : "rounded-b-[4px] mt-3 px-0 text-dense text-gray-200 overflow-y-auto scrollbar-none"}
                    >
                      {showAskAiRow && (
                        <AskAiRow query={inputValue} onSelect={openAskAi} />
                      )}
                      {typedTasks.length > 0 &&
                        typedTasks.map((item, index) => {
                          const showThisBoard =
                            rankingEnabled &&
                            item.searchGroup === "current-board" &&
                            typedTasks[index - 1]?.searchGroup !==
                              "current-board" &&
                            typedTasks.some(
                              (task) => task.searchGroup === "other"
                            );
                          const showOtherBoards =
                            rankingEnabled &&
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
                                <SearchGroupLabel label="This board" aligned={layoutEnabled} />
                              )}
                              {showOtherBoards && (
                                <SearchGroupLabel label="Other boards" aligned={layoutEnabled} />
                              )}
                              <TaskListRow
                                task={item}
                                highlight={item.highlight}
                                titleParts={autocompleteEnabled ? highlightedTitle(item.taskTitle ?? '', inputValue, commenterFlagEnabled && layoutEnabled) : undefined}
                                index={index}
                                handleLinkClick={handleLinkClick}
                                handleMouseEnter={handleMouseEnter}
                                handleMouseLeave={handleMouseLeave}
                                isActive={selectedIndex === index}
                                liRef={liSelectedRef}
                                aligned={layoutEnabled}
                                inboxHighlight={layoutEnabled && rowHighlightFlagEnabled}
                                snippetParts={matchSnippets?.[index]}
                              />
                            </Fragment>
                          );
                        })}
                    </ul>
                  )}
                  {responseMessage !== "None" &&
                    typedTasks.length === 0 &&
                    showAskAiRow && (
                      <div className="px-0 @md:!px-16 my-4">
                        <span className="text-[#8e9093]">
                          {responseMessage}
                        </span>
                      </div>
                    )}
                  {results && !(oneBoardTabsFlagEnabled && tabs.length <= 2) && (
                    <div className="flex inbox_footer @md:hidden no-scrollbar scrollbar-none gap-3 w-100 bg-hoverCardBackground  h-20 @md:h-8 inbox_title px-4">
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
                  )}
                </div>
              )}

              {!layoutEnabled && typedTasks.length === 0 &&
                !showAskAiRow &&
                searchCache.history &&
                searchCache.history.length > 0 && (
                  <ul
                    id={searchConfig.elementIds.history.id}
                    ref={ulRef}
                    onMouseMove={handleMouseMove}
                    className="rounded-b-[4px] mt-3 px-0 text-dense text-gray-200 overflow-y-auto scrollbar-none"
                  >
                    {searchCache.history.map((term: string, index: number) => (
                      <SearchHistoryRow
                        term={term}
                        index={index}
                        handleMouseEnter={handleMouseEnter}
                        handleMouseLeave={handleMouseLeave}
                        isActive={selectedHistory === index}
                        liRef={liSelectedRef}
                        handleLinkClick={() => {
                          document
                            .getElementById(searchConfig.elementIds.input.id)
                            ?.blur();
                          setInputValue(String(term));
                          updateSearchHistory(String(term));
                        }}
                        key={`${searchConfig.elementIds.history.childKeys}-${index}`}
                      />
                    ))}
                  </ul>
                )}
            </>
        </div>
      </div>
      {showCommands.show && (
        <HypertasksCommands
          callbackHandler={handleCommand}
          contextOptions={{
            context: "Others",
            searchOptions: { includeArchived },
          }}
        />
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

const SearchGroupLabel = ({ label, aligned }: { label: string; aligned?: boolean }) => (
  <li
    aria-hidden="true"
    className={aligned ? "py-2 text-micro font-medium text-text-light-gray list-none" : "px-4 py-2 text-micro font-medium text-text-light-gray list-none"}
  >
    {label}
  </li>
);

interface IAskAiRow {
  query: string;
  onSelect: () => void;
}

const AskAiRow = ({ query, onSelect }: IAskAiRow) => {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // ArrowUp returns to the search input (writing mode)
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      document.getElementById(searchConfig.elementIds.input.id)?.focus();
      return;
    }
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  }

  return (
    <li className="@md:border-l-4 @md:border-l-transparent group/selection_row flex items-center gap-2 cursor-pointer text-white-black hover:bg-active-elementBg focus-within:bg-active-elementBg focus-within:border-l-selected-item-border">
      <button
        id={searchConfig.elementIds.askAiRow.id}
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-4 py-2 text-left outline-none"
        onClick={onSelect}
        onKeyDown={handleKeyDown}
      >
        <span className="shrink-0 font-semibold text-hypertasks-ai-purple">
          Ask AI
        </span>
        <span className="truncate font-medium text-white-black">{query}</span>
      </button>
    </li>
  );
};

interface ITaskRow {
  task: ITypedTask;
  handleMouseEnter: (index: number) => void;
  handleMouseLeave: () => void;
  handleLinkClick: (task: ITypedTask, idx: number) => Promise<void>;
  index: number;
  isActive: boolean;
  highlight: any;
  titleParts?: ReturnType<typeof highlightedTitle>;
  aligned?: boolean;
  inboxHighlight?: boolean;
  snippetParts?: ReturnType<typeof highlightedSearchSnippet>;
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
    aligned,
    inboxHighlight,
    snippetParts,
    liRef,
  } = props;

  return (
    <li
      suppressHydrationWarning
      id={`task_${task.taskId}`}
      onMouseEnter={() => handleMouseEnter(index)}
      onMouseLeave={handleMouseLeave}
      className={cn(
        aligned ? "group/selection_row flex min-w-0 items-center gap-2 cursor-pointer" : "@md:border-l-4  sm:px-2 group/selection_row flex items-center gap-2 cursor-pointer",
        !inboxHighlight && {
          ["@md:bg-active-elementBg border-l-selected-item-border"]: isActive,
          ["@md:border-l-transparent bg-transparent"]: !isActive,
        }
      )}
      data-search-layout-row={inboxHighlight ? "" : undefined}
      data-selected={inboxHighlight ? isActive : undefined}
      onClick={() => handleLinkClick(task, index)}
      ref={liRef}
    >
      <div
        className={`font-medium ${aligned ? "min-w-0 [&>div]:min-w-0" : "px-4"} text-white-black flex flex-col @md:flex py-2 @md:items-center gap-1 @md:!gap-3 ${styles.list_container}`}
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

interface ISearchRow {
  term: string;
  handleMouseEnter: (index: number) => void;
  handleMouseLeave: () => void;
  handleLinkClick: () => void;
  index: number;
  isActive: boolean;
  liRef: RefObject<HTMLLIElement | null>;
}

const SearchHistoryRow = (props: ISearchRow) => {
  const {
    liRef,
    index,
    isActive,
    handleLinkClick,
    handleMouseEnter,
    handleMouseLeave,
    term,
  } = props;
  return (
    <li
      ref={liRef}
      className={cn(
        "@md:border-l-4  sm:p-inbox-horizontal group/selection_row flex items-center gap-2 cursor-pointer text-white-black",
        {
          ["@md:bg-active-elementBg border-l-selected-item-border"]: isActive,
          ["@md:border-l-transparent bg-transparent"]: !isActive,
        }
      )}
      onMouseEnter={() => handleMouseEnter(index)}
      onMouseLeave={handleMouseLeave}
      onClick={handleLinkClick}
    >
      <span className="px-4 py-2">{String(term)}</span>
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
