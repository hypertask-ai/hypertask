"use client";
import { ITypedTask, IUser } from "@/models/model";
import styles from "@/styles/search.module.scss";
import HypertasksCommands from "@/components/commands";
import formatDateDifference from "@/utils/generateTime";
import { Check } from "lucide-react";
import { searchConfig } from "@/lib/configs/search.config";
import { useSearch } from "@/hooks/Search/useSearch";
import { cn } from "@/utils/undoActions/helperFuncs";
import { KeyboardEvent, RefObject, useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { aiChatPendingPromptAtom, appShellRailAtom } from "@/store";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";

interface IProps {
  _searchTerm: string;
  _initialTabIndex?: number;
  _includeArchived: boolean;
  currentUser: IUser;
}

const SearchComp = ({
  _searchTerm,
  _initialTabIndex,
  _includeArchived,
  currentUser,
}: IProps) => {
  const setAiChatPendingPrompt = useSetRecoilState(aiChatPendingPromptAtom);
  const { openAIChatInterface } = useGlobalUIState();
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const {
    setSelectedIndex,
    selectedIndex,
    tasksInputRef,
    inputValue,
    handleChange,
    responseMessage,
    typedTasks,
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
    liSelectedRef,
    tabs,
    activeSplit,
    updateSplitAndTasks,
    results,
    suggestedValue,
    includeArchived,
    setIncludeArchivedResults,
  } = useSearch(_searchTerm, _initialTabIndex, _includeArchived);
  const showAskAiRow =
    inputValue.trim().length >= 2 && typedTasks.length === 0;
  const searchTextClassName =
    "w-full px-4 @md:!px-9 text-subheading font-medium leading-normal rounded-b-[4px] bg-inherit outline-none";

  // Ask AI hands the query to the single general AI chat (auto-sent there via
  // aiChatPendingPromptAtom) instead of a separate in-search panel.
  function openAskAi() {
    const query = inputValue.trim();
    if (query.length < 2) return;
    setAiChatPendingPrompt(query);
    openAIChatInterface();
  }

  const content = (
    <>
      <div
        suppressHydrationWarning
        onClick={(e) => setSelectedIndex(null)}
        autoFocus={false}
        className={`py-9 min-h-screen bg-containerBackground flex-col rounded-[4px] my-0 global-view-width flex items-center  search-input  ${styles.links_modal}`}
      >
        {/* Below @xl the container is full-width, so clear the fixed back button (ends at x≈96) */}
        <div className={cn('w-full px-0', appShellRailOn && 'pl-[64px] @xl:pl-0')}>
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

            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 px-4 text-[13px] text-text-light-gray @md:px-9">
              <input
                type="checkbox"
                className="h-4 w-4 accent-hypertasks-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white-black"
                checked={includeArchived}
                onChange={(event) =>
                  setIncludeArchivedResults(event.target.checked)
                }
              />
              Include archived
            </label>

          <>
              {responseMessage !== "None" &&
              typedTasks.length === 0 &&
              !showAskAiRow ? (
                <div className="px-0 @md:!px-16 my-4">
                  <span className="text-[#8e9093]">{responseMessage}</span>
                </div>
              ) : (
                <div>
                  {results && (
                    <div className="hidden @md:block w-full overflow-x-auto scrollbar-none no-scrollbar @md:px-9 mt-4">
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
                      className="rounded-b-[4px] mt-3 px-0 text-dense text-gray-200 overflow-y-auto scrollbar-none"
                    >
                      {showAskAiRow && (
                        <AskAiRow query={inputValue} onSelect={openAskAi} />
                      )}
                      {typedTasks.length > 0 &&
                        typedTasks.map((item, index) => {
                          return (
                            <TaskListRow
                              task={item}
                              highlight={item.highlight}
                              index={index}
                              handleLinkClick={handleLinkClick}
                              handleMouseEnter={handleMouseEnter}
                              handleMouseLeave={handleMouseLeave}
                              isActive={selectedIndex === index}
                              liRef={liSelectedRef}
                              key={`${searchConfig.elementIds.results.childKeys}-${index}`}
                            />
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
                  {results && (
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

              {typedTasks.length === 0 &&
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
      {showCommands.show && <HypertasksCommands />}
    </>
  );

  return appShellRailOn ? (
    <>
      <AppShellRail variant="global" currentUser={currentUser} />
      <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div>
    </>
  ) : content;
};

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
    liRef,
  } = props;

  return (
    <li
      suppressHydrationWarning
      id={`task_${task.taskId}`}
      onMouseEnter={() => handleMouseEnter(index)}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "@md:border-l-4  sm:px-2 group/selection_row flex items-center gap-2 cursor-pointer",
        {
          ["@md:bg-active-elementBg border-l-selected-item-border"]: isActive,
          ["@md:border-l-transparent bg-transparent"]: !isActive,
        }
      )}
      onClick={() => handleLinkClick(task, index)}
      ref={liRef}
    >
      <div
        className={`font-medium px-4 text-white-black flex flex-col @md:flex py-2 @md:items-center gap-1 @md:!gap-3 ${styles.list_container}`}
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
          {highlight.title ? (
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

        {task.commentId ? (
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
              dangerouslySetInnerHTML={{
                __html: task.commentText ?? "",
              }}
            />
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
            dangerouslySetInnerHTML={{
              __html: task.descriptionText ?? "",
            }}
          />
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
        <h2 className={`footer_tags`}>{tab.project}</h2>

        {tab.length > 0 && (
          <p className="font-normal footer_tags text-micro ">{tab.length}</p>
        )}
      </div>
    </div>
  );
};

export default SearchComp;
