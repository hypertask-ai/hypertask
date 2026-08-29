import { searchConfig } from "@/lib/configs/search.config";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGetAllProjectsMinimal } from "../MultiPages/useGetAllProjectsMinimal";
import useHypertasksRecoilStates from "../RecoilRoot/useHypertasksRecoilStates";
import { useRecoilState } from "@/lib/state";
import { IProject, ITypedTask } from "@/models/model";
import {
  inViewObjectAtom,
  SearchTaskIndexAtom,
  showCommandsAtom,
  tasksPlayListAtom,
} from "@/store";
import { searchDocumentsRoute } from "@/lib/constants/APIRouteConstants";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import toast from "react-hot-toast";
import { useGetSearchCache } from "./useSearchCache";
import globalConstants from "@/lib/constants";
import {
  buildSearchUrl,
  defaultSearchArchiveStatus,
  SearchRequestGate,
} from "@/lib/searchArchive";

export function useSearch(
  _searchTerm: string,
  _initialTabIndex?: number,
  _includeArchived = false
) {
  const { data: searchCache } = useGetSearchCache();
  const { data: allProjects } = useGetAllProjectsMinimal([
    "projectsAllMinimal",
  ]);
  const [searchTaskIndex, setSearchTaskIndex] =
    useRecoilState(SearchTaskIndexAtom);
  const [_, setInViewObject] = useRecoilState(inViewObjectAtom);
  const [__, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const [showCommands, ___] = useRecoilState(showCommandsAtom);
  const [inputValue, setInputValue] = useState<string>(_searchTerm ?? "");
  const [typedTasks, setTypedTasks] = useState<ITypedTask[]>([]);
  const [tempInput, setTempInput] = useState<string>("");
  const [selectedHistory, setSelectedHistory] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    searchTaskIndex ?? null
  );
  const [projects, setProjects] = useState<IProject[] | []>([]);
  const [responseMessage, setResponseMessage] = useState<string>(
    searchConfig.responseMessages.default
  );
  const [activeSplit, setActiveSplit] = useState<number>(0);
  const [explicitTabIndex, setExplicitTabIndex] = useState<
    number | undefined
  >(_initialTabIndex);
  const [tabs, setTabs] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, any[]> | null>(null);
  const [filterModifiers, setFilterModifiers] = useState<any>(null);
  const [suggestedValue, setSuggestedValue] = useState<string>("");
  const [includeArchived, setIncludeArchived] =
    useState<boolean>(_includeArchived);

  // --------------- Refs
  const tasksInputRef = useRef<HTMLInputElement>(null);
  const ulRef = useRef<HTMLUListElement | null>(null);
  const liSelectedRef = useRef<HTMLLIElement | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const currentHoveredDiv = useRef<number | null>(null);
  const lastgClick = useRef<number | null>(null);
  const searchRequestGate = useRef(new SearchRequestGate()).current;
  const lastSearchKey = useRef<string | null>(null);
  const controller: { [key: number]: { pressed: boolean } } = {
    ...globalConstants.multipleKeys,
  };

  const { toggleShowCommands } = useHypertasksRecoilStates();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isApple = useDeviceContext();

  function handleProjectsFromCache() {
    setProjects(allProjects);
    const boardNames = allProjects.map((project: any) =>
      project.title.toLowerCase()
    );
    setFilterModifiers({
      "is:": ["archived", "open"],
      "board:": boardNames,
    });
  }

  function handleInputAutoComplete(currentText: string): string {
    const regex = /(.*)(is:|priority:|board:)(.*)$/;
    const match = currentText.match(regex);

    if (!match) return "";

    const textBeforePrefix = match[1];
    const potentialPrefix = match[2].toLowerCase();
    const partialValue = match[3].toLowerCase();
    if (!filterModifiers[potentialPrefix]) return "";

    const validValues = filterModifiers[potentialPrefix];
    const bestMatchValue = validValues.find((value: string) => {
      return value.toLowerCase().startsWith(partialValue);
    });

    if (bestMatchValue && bestMatchValue.toLowerCase() !== partialValue) {
      const completedTerm = potentialPrefix + bestMatchValue;
      return textBeforePrefix + completedTerm;
    }

    return "";
  }

  function currentSearchKey(searchTerm: string, showArchived: boolean) {
    return JSON.stringify([
      searchTerm,
      showArchived,
      projects.map((project) => project.id),
    ]);
  }

  function beginSearch(searchTerm: string, showArchived: boolean) {
    lastSearchKey.current = currentSearchKey(searchTerm, showArchived);
    return searchRequestGate.begin();
  }

  async function handleSearchOnMount(showArchived = includeArchived) {
    // If there's a search term from URL params, fetch results from server
    if (_searchTerm && _searchTerm.length >= 2) {
      const requestId = beginSearch(_searchTerm, showArchived);
      const { searchProjectIds, processedSearchTerm, archive } =
        searchBoards(_searchTerm, showArchived);

      try {
        const response = await axios.post(searchDocumentsRoute, {
          projectIds:
            searchProjectIds.length > 0
              ? searchProjectIds
              : projects.map((item) => item.id),
          searchQuery: processedSearchTerm,
          archive,
        });

        if (!searchRequestGate.isLatest(requestId)) return;

        if (response.status === 200) {
          const { processedData, tabs: splits } = response.data;
          if (processedData["All"].length > 0) {
            applySearchResults(processedData, splits);
            tasksInputRef.current?.blur();
          } else {
            handleStatesOnResponse(searchConfig.responseMessages.fail);
          }
        } else {
          handleStatesOnResponse(searchConfig.responseMessages.fail);
        }
      } catch (error) {
        if (!searchRequestGate.isLatest(requestId)) return;
        console.error("🤔 ~ handleSearchOnMount ~ error:", error);
        handleStatesOnResponse(searchConfig.responseMessages.error);
      }
    }
  }

  function handleChange(e: any) {
    setInputValue(e.target.value);
    setSuggestedValue(handleInputAutoComplete(e.target.value));
  }

  async function handleLinkClick(task: ITypedTask) {
    const tasksPlayList = typedTasks.map((item) => ({
      projectId: item.projectId,
      uniqueIndex: item.uniqueIndex,
    }));
    setTasksPlayList(tasksPlayList);
    router.push(searchConfig.urls.taskDetail(task.projectId, task.uniqueIndex));
  }

  function handleStatesOnResponse(message: string) {
    setResponseMessage(message);
    setTypedTasks([]);
    setSelectedIndex(null);
    setSelectedHistory(null);
    setTabs([]);
    setActiveSplit(0);
    setResults(null);
  }

  function updateSplitAndTasks(index: number) {
    if (!results) return;
    setExplicitTabIndex(index);
    setActiveSplit(index);
    setTypedTasks(results[tabs[index]]);
    setSelectedAndInView(results[tabs[index]][0], 0);
    router.replace(searchUrl(inputValue, index), { scroll: false });
  }

  function getInitialSplitIndex(splits: string[]) {
    if (
      explicitTabIndex !== undefined &&
      explicitTabIndex >= 0 &&
      explicitTabIndex < splits.length
    ) {
      return explicitTabIndex;
    }

    if (explicitTabIndex !== undefined) return 0;

    const openTabIndex = splits.indexOf("Open");
    return openTabIndex > -1 ? openTabIndex : 0;
  }

  function applySearchResults(
    processedData: Record<string, ITypedTask[]>,
    splits: string[],
    preferredIndex?: number
  ) {
    const splitIndex = preferredIndex ?? getInitialSplitIndex(splits);
    const splitName = splits[splitIndex] ?? "All";
    const splitTasks = processedData[splitName] ?? processedData["All"];

    setTabs(splits);
    setTypedTasks(splitTasks);
    setActiveSplit(splitIndex);
    setResults(processedData);
    setResponseMessage(searchConfig.responseMessages.default);

    if (splitTasks.length > 0) {
      setSelectedAndInView(splitTasks[0], 0);
    } else {
      setSelectedIndex(null);
    }
  }

  function searchUrl(
    searchTerm: string,
    tabIndex: number | null | undefined = explicitTabIndex,
    showArchived = includeArchived
  ) {
    return buildSearchUrl(searchTerm, tabIndex, showArchived);
  }

  /**
   * Searches for boards in the given array based on an input string
   * @param input - The search input that may contain board identifiers
   * @param boardsArray - Array of board names to search through
   * @returns Object containing matching board names and their indexes
   */
  function searchBoards(input: string, showArchived = includeArchived): {
    searchProjectIds: number[];
    archive: null | "Normal" | "Archive";
    processedSearchTerm: string;
  } {
    const searchProjectIds: number[] = [];
    let lowerInput = input.toLowerCase();
    let archive: null | "Normal" | "Archive" =
      defaultSearchArchiveStatus(showArchived);
    // Check if input contains the "board:" identifier
    if (!lowerInput.includes("board:") && !lowerInput.includes("is:")) {
      return {
        searchProjectIds: [],
        archive,
        processedSearchTerm: input,
      };
    }

    if (lowerInput.includes("board:")) {
      for (const project of projects) {
        if (lowerInput.includes(("board:" + project.title).toLowerCase()))
          searchProjectIds.push(project.id);
      }

      for (const project of projects) {
        if (lowerInput.includes(("board:" + project.title).toLowerCase()))
          lowerInput = lowerInput.replaceAll(
            ("board:" + project.title).toLowerCase(),
            ""
          );
      }
    }

    if (lowerInput.includes("is:archived")) {
      archive = "Archive";
      lowerInput = lowerInput.replaceAll("is:archived".toLowerCase(), "");
    } else if (lowerInput.includes("is:open")) {
      archive = "Normal";
      lowerInput = lowerInput.replaceAll("is:open".toLowerCase(), "");
    }

    return {
      searchProjectIds: searchProjectIds,
      archive,
      processedSearchTerm: lowerInput.trim(),
    };
  }

  function updateSearchHistory(searchTerm: string) {
    if (searchTerm.length < 2) {
      searchRequestGate.invalidate();
      router.replace(searchUrl(searchTerm, null, includeArchived));
      setTypedTasks([]);
      setSelectedIndex(null);
      setTabs([]);
      setResults(null);
      return;
    }

    const currentHistory: any[] = searchCache.history;
    const term = (searchTerm || "").trim();
    if (!term) return;
    const withoutDupes = currentHistory.filter((t: string) => t !== term);
    const updated = [term, ...withoutDupes];

    executeSearch(searchTerm, updated.slice(0, 10));
  }

  async function executeSearch(
    searchTerm: string,
    updatedHistory: string[],
    options?: { showArchived?: boolean; resetTab?: boolean }
  ) {
    const showArchived = options?.showArchived ?? includeArchived;
    const requestId = beginSearch(searchTerm, showArchived);
    try {
      router.replace(
        searchUrl(
          searchTerm,
          options?.resetTab ? null : explicitTabIndex,
          showArchived
        )
      );
      const { searchProjectIds, processedSearchTerm, archive } =
        searchBoards(searchTerm, showArchived);

      const response = await axios.post(searchDocumentsRoute, {
        projectIds:
          searchProjectIds.length > 0
            ? searchProjectIds
            : projects.map((item) => item.id),
        searchQuery: processedSearchTerm,
        archive,
      });

      if (!searchRequestGate.isLatest(requestId)) return;

      if (response.status === 204)
        return handleStatesOnResponse(searchConfig.responseMessages.fail);
      if (response.status === 200) {
        const { processedData, tabs: splits } = response.data;
        if (processedData["All"].length > 0) {
          // Only update search history in cache, not results
          const newData = {
            history: updatedHistory,
            results: [],
          };

          queryClient.setQueryData(["Search"], newData);
          localStorage.setItem("searchCache", JSON.stringify(newData));
          applySearchResults(
            processedData,
            splits,
            options?.resetTab ? 0 : undefined
          );
          document.getElementById(searchConfig.elementIds.input.id)?.blur();
        } else handleStatesOnResponse(searchConfig.responseMessages.fail);
      }
    } catch (error) {
      if (!searchRequestGate.isLatest(requestId)) return;
      console.error("🤔 ~ executeSearch ~ error:", error);
      toast.error(searchConfig.responseMessages.error);
      handleStatesOnResponse(searchConfig.responseMessages.error);
    }
  }

  function setIncludeArchivedResults(showArchived: boolean) {
    setIncludeArchived(showArchived);
    setExplicitTabIndex(undefined);
    const term = inputValue.trim();
    if (term.length < 2) {
      searchRequestGate.invalidate();
      handleStatesOnResponse(searchConfig.responseMessages.default);
      router.replace(searchUrl(inputValue, null, showArchived), {
        scroll: false,
      });
      return;
    }
    void executeSearch(term, searchCache.history ?? [], {
      showArchived,
      resetTab: true,
    });
  }

  function setSelectedAndInView(task: ITypedTask, index: number) {
    setSelectedIndex(index);
    setInViewObject({
      taskId: task.taskId,
      taskProjectId: task?.projectId ?? null,
      sectionId: null,
      taskTicketNumber: task?.ticketNumber ?? null,
      sectionTitle: null,
      taskTitle: task?.taskTitle ?? null,
    });
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (controller[event.keyCode]) {
      controller[event.keyCode].pressed = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    let cmdControl = (isApple && event.metaKey) || (!isApple && event.ctrlKey);
    if (controller[event.keyCode]) {
      controller[event.keyCode].pressed = true;
    }

    const isInputFocused = ["input", "textarea"].includes(
      (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
    );

    if (event.keyCode === KeyCodes.ESCAPE && !showCommands.show) {
      event.preventDefault();
      return router.back();
    }

    if (
      showCommands.show ||
      document?.activeElement?.role === "dialog" ||
      document?.activeElement?.id === "modalButtons" ||
      // document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.id === "htc" ||
      searchConfig.handleKeyDown.classNamesToReturnFrom.includes(
        document?.activeElement?.className
      ) ||
      document.activeElement?.id === "boardManager"
    )
      return;

    // press k
    if (event.keyCode === KeyCodes.K && cmdControl) {
      event.preventDefault();
      toggleShowCommands();
    }
    if (event.keyCode === KeyCodes.FORWARD_SLASH) {
      event.preventDefault();
      document.getElementById(searchConfig.elementIds.input.id)?.focus();
      setSelectedIndex(null);
    }

    if (event.keyCode === KeyCodes.ENTER) {
      if (isInputFocused) {
        updateSearchHistory(inputValue);
      } else {
        if (typedTasks.length > 0 && selectedIndex !== null)
          handleLinkClick(typedTasks[selectedIndex]);
        else if (inputValue.length >= 2) updateSearchHistory(inputValue);
      }
    }

    if (
      (event.keyCode === KeyCodes.J && !isInputFocused) ||
      event.keyCode === KeyCodes.ARROW_DOWN
    ) {
      const historyList = document.getElementById(
        searchConfig.elementIds.history.id
      );

      //Phase 1 (if nothing in search type, we are going to display past searches if any)
      if (!!historyList) {
        if (selectedHistory === null) {
          setSelectedHistory(0);
          setTempInput(inputValue);
          setInputValue(searchCache.history[0]);
          document.getElementById(searchConfig.elementIds.input.id)?.blur();
        } else {
          if (
            selectedHistory === -1 ||
            selectedHistory === searchCache.history.length - 1
          ) {
          } else {
            setSelectedHistory(selectedHistory + 1);
            setInputValue(searchCache.history[selectedHistory + 1]);
          }
        }
      }

      //Phase 3 (Since we are skipping suggestions right now)
      if (typedTasks.length > 0 && selectedIndex !== null) {
        if (selectedIndex === -1 || selectedIndex === typedTasks.length - 1) {
        } else {
          setSelectedAndInView(
            typedTasks[selectedIndex + 1],
            selectedIndex + 1
          );

          document
            .getElementById(`task_${typedTasks[selectedIndex + 1].taskId}`)
            ?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "nearest" });
        }
      }
    }

    if (
      (event.keyCode === KeyCodes.K && !isInputFocused) ||
      event.keyCode === KeyCodes.ARROW_UP
    ) {
      const historyList = document.getElementById(
        searchConfig.elementIds.history.id
      );

      if (!!historyList) {
        if (selectedHistory === null) {
        } else {
          if (selectedHistory <= 0) {
            setSelectedHistory(null);
            setInputValue(tempInput);
            setTempInput("");
            document.getElementById(searchConfig.elementIds.input.id)?.focus();
          } else {
            setSelectedHistory(selectedHistory - 1);
            setInputValue(searchCache.history[selectedHistory - 1]);
          }
        }
      }

      //Phase 3 (Since we are skipping suggestions right now)
      if (typedTasks.length > 0 && selectedIndex !== null) {
        if (selectedIndex <= 0) {
        } else {
          setSelectedAndInView(
            typedTasks[selectedIndex - 1],
            selectedIndex - 1
          );
          document
            .getElementById(`task_${typedTasks[selectedIndex - 1].taskId}`)
            ?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "nearest" });
        }
      }
    }

    if (event.keyCode === KeyCodes.TAB && tabs.length > 0 && !isInputFocused) {
      event.preventDefault();
      let newValue;
      if (event.shiftKey) {
        // Navigate to the previous tab
        newValue = activeSplit !== 0 ? activeSplit - 1 : tabs.length - 1;
      } else {
        // Navigate to the next tab
        newValue = activeSplit !== tabs.length - 1 ? activeSplit + 1 : 0;
      }

      updateSplitAndTasks(newValue);
    }

    // Only the search field swallows Tab, and only to accept a live
    // autocompletion. Anything else focusable on the page (the archived
    // toggle) keeps native Tab so it stays keyboard reachable.
    if (
      event.keyCode === KeyCodes.TAB &&
      document.activeElement === tasksInputRef.current &&
      suggestedValue
    ) {
      event.preventDefault();
      setInputValue(suggestedValue);
      setSuggestedValue("");
    }

    // ========== [g] main handler: initiate sequence only if no other g-then sequence is active
    if (event.keyCode === KeyCodes.G) {
      // If another g-sequence was not just triggered, start the timer for g-then combos.
      if (!lastgClick.current) {
        const now = new Date().getTime();
        lastgClick.current = now;
        setTimeout(() => {
          lastgClick.current = null;
        }, globalConstants.gThenKeyDelay);
        return;
      }
      // Don't let a plain [g] immediately fall through to any other logic
    }

    // ========== [g] then [g] - Jump to top/bottom row
    // Only handle this if (a) g was just pressed, timer active, (b) NOT mixed up with other G-combos
    if (
      lastgClick.current &&
      controller[KeyCodes.G]?.pressed &&
      typedTasks.length > 0 &&
      event.keyCode === KeyCodes.G
    ) {
      const now = new Date().getTime();
      if (now - lastgClick.current < globalConstants.gThenKeyDelay) {
        lastgClick.current = null; // consume the combo
        if (event.shiftKey) {
          // Go to bottom
          setSelectedAndInView(
            typedTasks[typedTasks.length - 1],
            typedTasks.length - 1
          );
          document
            .getElementById(`task_${typedTasks[typedTasks.length - 1].taskId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          // Go to top
          setSelectedAndInView(typedTasks[0], 0);
          document
            .getElementById(`task_${typedTasks[0].taskId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return; // prevent interfering with any other g-then-[key]
      }
    }

    if (
      lastgClick.current &&
      controller[KeyCodes.D]?.pressed &&
      event.keyCode === KeyCodes.D
    ) {
      const now = new Date().getTime();
      if (now - lastgClick.current < globalConstants.gThenKeyDelay) {
        lastgClick.current = null;
        router.push(globalConstants.draftsRoute);
        return;
      }
    }

    if (
      lastgClick.current &&
      controller[KeyCodes.U]?.pressed &&
      event.keyCode === KeyCodes.U
    ) {
      const now = new Date().getTime();
      if (now - lastgClick.current < globalConstants.gThenKeyDelay) {
        lastgClick.current = null;
        router.push("/scheduled");
        return;
      }
    }
  }

  function handleMouseLeave() {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    debounceTimeout.current = setTimeout(() => {
      if (currentHoveredDiv.current !== null && liSelectedRef.current) {
        (liSelectedRef.current as HTMLLIElement)?.blur();
        currentHoveredDiv.current = null;
      }
    }, 100);
  }

  function handleMouseEnter(index: number) {
    currentHoveredDiv.current = index;
  }

  function handleMouseMove() {
    if (!debounceTimeout.current) return;
    const currentIndex = currentHoveredDiv.current
      ? currentHoveredDiv.current
      : 0;
    if (
      typedTasks.length > 0 &&
      document.activeElement?.id !== searchConfig.elementIds.input.id
    )
      setSelectedAndInView(typedTasks[currentIndex], currentIndex);
    else if (searchCache.history.length > 0) setSelectedHistory(currentIndex);
    clearTimeout(debounceTimeout.current);
    debounceTimeout.current = null;
  }

  useLayoutEffect(() => {
    setSearchTaskIndex(0);
    if (typedTasks.length > 0) {
      document
        ?.getElementById(`task_${typedTasks[0]?.taskId}`)
        ?.scrollIntoView({
          behavior: "instant" as ScrollBehavior,
          block: "center",
        });
      tasksInputRef.current?.blur();
    } else tasksInputRef.current?.focus();
    queryClient.invalidateQueries({ queryKey: ["projectsAll"] });
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    typedTasks,
    showCommands.show,
    selectedIndex,
    inputValue,
    searchCache,
    selectedHistory,
    suggestedValue,
  ]);

  // -------------------- recieving data from React-Query
  useEffect(() => handleProjectsFromCache(), [allProjects]);

  useEffect(() => {
    setExplicitTabIndex(_initialTabIndex);
  }, [_initialTabIndex]);

  // Keep URL navigation authoritative while avoiding the duplicate request
  // caused by our own router.replace after an already-started search.
  useEffect(() => {
    setIncludeArchived(_includeArchived);
    setInputValue(_searchTerm);
    if (projects.length > 0 && _searchTerm.length >= 2) {
      const key = currentSearchKey(_searchTerm, _includeArchived);
      if (lastSearchKey.current !== key) {
        void handleSearchOnMount(_includeArchived);
      }
      return;
    }
    if (_searchTerm.length < 2) {
      searchRequestGate.invalidate();
      lastSearchKey.current = currentSearchKey("", _includeArchived);
      handleStatesOnResponse(searchConfig.responseMessages.default);
    }
  }, [projects, _includeArchived, _searchTerm]);

  return {
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
  };
}
