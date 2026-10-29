import { HTPR_7865_AGENT_CREATOR_FILTER_FLAG } from "@/lib/flags/definitions/htpr-7865-agent-creator-filter";
import { HTPR_8149_ARCHIVE_FOCUS_ORDER_FLAG } from "@/lib/flags/definitions/htpr-8149-archive-focus-order";
import { HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG } from "@/lib/flags/definitions/htpr-7807-empty-view-columns";

import { ISection, ITask } from '@/models/model'
import  { useContext, useEffect, useRef, useState } from 'react'
import { activeBuiltinViewsAtom, currentProjectAtom, currentUserAtom, showCommandsAtom, showSidebarAtom, activeItemAtom,activeSectionAtom, showBoardManagerAtom, appShellRailAtom } from '@/store'
import { useRecoilState, useRecoilValue, useSetRecoilState } from '@/lib/state'
import { useStore } from 'jotai'
import { useUndoContext } from '../General/useUndo'
import toast from 'react-hot-toast'
import { throttle, returnSortedItems, returnIfModalOrInputActive, isAIChatElementFocused } from '@/utils/helperFunctions/helperFunctions'
import globalConstants from '@/lib/constants'
import UpdateKanban from '../MultiPages/useUpdateTaskInBoards'
import {  useQueryClient } from "@tanstack/react-query";
import { useKanbanModalStatesContext } from '@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext'
import { useDeviceContext } from '@/lib/contexts/deviceContext'
import { isFavoriteBoardShortcut } from '@/lib/constants/shortcuts'
import { DropResult } from '@hello-pangea/dnd'
import generateRanking from '@/utils/generateRank'
import globalAPIHandlers from '@/utils/api/global'
import { getFilteredSections } from '../../utils/helperFunctions/Views/FilterHelperFunctions'
import useHypertasksRecoilStates from '../RecoilRoot/useHypertasksRecoilStates'
import { getAppliedSubtaskSections } from '@/utils/helperFunctions/Views/SubtaskHelperFunction'
import { getActiveSortingModeFromProject } from '@/utils/helperFunctions/Views/ViewsHelperFunctions'
import { getFilteredEmptySections } from '@/utils/helperFunctions/Views/EmptySectionsHelperFunction'
import { useUniversalMovement } from '../useUniversalMovement'
import { CommandMode } from '@/models/enums'
import { MobileViewContext } from '@/lib/contexts/mobileContext'
import { toggleTaskTimer } from '@/hooks/Task Detail/useTimeTracking'
import { buildBuiltinViewContext, isBuiltinViewId } from '@/lib/constants/builtinViews'
import { useToggleShowArchivedOnBoard } from './useShowArchivedOnBoard'
import useKanbanViews from '@/hooks/Homepage/Views/useKanbanViews'
import { useFlag } from '@/hooks/useFlag'
import { HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG } from '@/lib/flags/keys'
import { HTPR_7776_DEFAULT_VIEW_FILTERS_FLAG } from '@/lib/flags/keys'
import { shouldIgnoreTaskShortcutTarget } from '@/lib/keyboard/taskShortcuts'

interface IHandleKeyDownOperations {
    initialSections: ISection[];
    handleBoardChange?:(index:number,sectionsFromCallback:ISection[])=>void,
    filteredSections:ISection[]

}

const useHandleKeyDownOperations= (props:IHandleKeyDownOperations) => {
    const {initialSections , handleBoardChange, filteredSections} = props
    const archiveFocusOrder = useFlag(HTPR_8149_ARCHIVE_FOCUS_ORDER_FLAG)
    const agentCreatorFilterEnabled = useFlag(HTPR_7865_AGENT_CREATOR_FILTER_FLAG)
    const showEmptyViewColumns = useFlag(HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG)
    const assigneeFixEnabled = useFlag(HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG)
    const defaultFiltersFixEnabled = useFlag(HTPR_7776_DEFAULT_VIEW_FILTERS_FLAG)
    const queryClient = useQueryClient();   
    const store = useStore();
    const {showManageColumnsModal, showSaveModal, toggleViewsModal, toggleSaveViewsModal, toggleSearchTasks, showSearchTasks} = useKanbanModalStatesContext()
    const { resetShowCommands }= useHypertasksRecoilStates()

    const {updateActiveItemAndItemInView, mutationHandler, getProjectIdxAndAllData }=UpdateKanban();

    const spaceship = useUniversalMovement({type: "Kanban", initialSections, filteredSections})

    const {undoData, undoLatest} = useUndoContext();

    const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
    const setShowSidebar = useSetRecoilState(showSidebarAtom);
    const _currentProject = useRecoilValue(currentProjectAtom)
    const currentUser = useRecoilValue(currentUserAtom)
    const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom)
    const setActiveSection = useSetRecoilState(activeSectionAtom);
    const [showBoardManager,___] = useRecoilState(showBoardManagerAtom);
    const toggleShowArchivedOnBoard = useToggleShowArchivedOnBoard(_currentProject);
    const { toggleBoardLayout } = useKanbanViews(_currentProject);
    const isMbl = useContext(MobileViewContext);
    const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
    const [sections, setSections] = useState<ISection[]>(initialSections);
    const [sectionsToDisplay, setSectionsToDisplay] = useState<ISection[]>(filteredSections);
    const [firstTask, setFirstTask] = useState<ITask | undefined|null>(_currentProject?.firstTask);
    const lastgClick = useRef<number | null>(null);
    const timerToggling = useRef(false);
    const isApple = useDeviceContext()
    const sorting_mode_current = getActiveSortingModeFromProject(_currentProject)
    const getActiveItem = () => store.get(activeItemAtom);
    const getActiveSection = () => store.get(activeSectionAtom);

    const toggleSelectedTaskTimer = async (taskId: number) => {
      if (timerToggling.current) return;
      timerToggling.current = true;
      try {
        await toggleTaskTimer(taskId);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["time", "task", taskId] }),
          queryClient.invalidateQueries({ queryKey: ["time", "entries", taskId] }),
          queryClient.invalidateQueries({ queryKey: ["time", "running"] }),
          queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
          queryClient.invalidateQueries({ queryKey: ["time", "report"] }),
        ]);
      } catch (error: any) {
        toast.error(error?.message ?? "Unable to update timer");
      } finally {
        timerToggling.current = false;
      }
    };

    const registerQuickAdd = () => {
      const handleNQuickAdd = (e: KeyboardEvent) => {
        if (
          !((e.key.toLowerCase() === "n" && !e.shiftKey) ||
            (e.key.toLowerCase() === "c" && e.shiftKey)) ||
          e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing ||
          showCommands.show || returnIfModalOrInputActive() ||
          shouldIgnoreTaskShortcutTarget(e.target as HTMLElement | null) ||
          shouldIgnoreTaskShortcutTarget(document.activeElement as HTMLElement | null)
        ) return;
        const sectionEls = document.getElementById("sectionsContainer")?.children;
        if (!sectionEls) return;
        const focusedColumn = document.activeElement?.closest('.section-container');
        const focusedColumnIndex = Array.from(sectionEls).indexOf(focusedColumn!);
        const activeItem = store.get(activeItemAtom);
        const taskColumnIndex = filteredSections.findIndex(section =>
          section.items.some(task => task.id === activeItem)
        );
        const targetIndex = focusedColumnIndex >= 0
          ? focusedColumnIndex
          : Math.max(taskColumnIndex, 0);
        e.preventDefault();
        sectionEls[targetIndex]?.dispatchEvent(new CustomEvent('OPEN_QUICK_ENTRY'));
      };
      document.addEventListener("keydown", handleNQuickAdd);
      return () => document.removeEventListener("keydown", handleNQuickAdd);
    };
    useEffect(registerQuickAdd, [showCommands.show, filteredSections, store]);

    const handleKeyDown = (e: any) => {
    let cmdControl = isApple&&e.metaKey || !isApple&&e.ctrlKey;
    e.preventDefault();

    if (e.key==="Escape") {
      resetShowCommands()
      return
    }

    if (isFavoriteBoardShortcut(e, isApple)) {
      e.preventDefault();
      const index = parseInt(e.code.replace("Digit", ""));
      if (index >= 0 && handleBoardChange) handleBoardChange(index, sections);
      return;
    }

    if (returnIfModalOrInputActive()) return

    if (
      filteredSections.length === 0 &&
      (e.key === "c" || e.key === "C") &&
      !cmdControl &&
      !e.shiftKey
    ) {
      e.preventDefault();
      setShowCommands({ show: true, mode: CommandMode.AddColumn });
      return;
    }

    const sectionsContainer = document.getElementById("sectionsContainer");
    if (!sectionsContainer) return;
    const sectionEls = sectionsContainer.children;
    const activeElement = document.activeElement;
    const activeElementIndex = Array.from(sectionEls).indexOf(activeElement!);
    const activeItem = getActiveItem();
    if (
      e.key === "w" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      _currentProject?.timeTrackingEnabled &&
      activeItem &&
      !timerToggling.current
    ) {
      e.preventDefault();
      void toggleSelectedTaskTimer(activeItem);
      return;
    }
    if (e.key==="Tab"){
      e.preventDefault()
    }
    if (e.key === "Escape") {
      if (activeItem) spaceship.refocus(activeItem)
    }
    
    if (e.keyCode === 86 && e.shiftKey){
      if ( _currentProject?.project_view?.user_project_views[0]?.unsavedView )return toggleSaveViewsModal()
    }

    if (e.keyCode === 90&&undoData.length>0){
      void undoLatest();

  }
    if (e.shiftKey && e.keyCode===70) setShowCommands({show: true, mode: CommandMode.ShowFilterHTC})

    if (e.shiftKey && e.keyCode===83) setShowCommands({show: true, mode: CommandMode.SortKanbanBoard})
    

    if ((e.keyCode === 74 ||e.key==="ArrowDown") && !e.shiftKey && !cmdControl) {
      e.preventDefault();
      if (isAIChatElementFocused()) return
      spaceship.focus.down()
    }
    
    if ((e.keyCode === 75 ||e.key==="ArrowUp") && (!e.shiftKey && !cmdControl )) {
      e.preventDefault();
      if (isAIChatElementFocused()) return
      spaceship.focus.up()
    }

    if ((!appShellRailOn && e.key === "Tab" && e.shiftKey) || ((e.key==="ArrowLeft" ||e.keyCode===72 )&& !e.shiftKey)) {
      e.preventDefault();
      if (isAIChatElementFocused()) return
      spaceship.focus.left()
    }

    if (e.keyCode === 71) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, globalConstants.gThenKeyDelay);
    }
    
    if (e.keyCode === 86) {
      const now = new Date().getTime();
      if (lastgClick.current && now - lastgClick.current < globalConstants.gThenKeyDelay) {
        lastgClick.current = null;
        toggleViewsModal()

      }
    }

    if (e.keyCode === 88) {
      const now = new Date().getTime();
      if (lastgClick.current && now - lastgClick.current < globalConstants.gThenKeyDelay) {
        lastgClick.current = null;
        toggleShowArchivedOnBoard();
      }
    }

    if (e.keyCode === 84 && e.shiftKey) {
      e.preventDefault();
      toggleBoardLayout();
    }

    let activeKeysSet = new Set(['j', 'k', 'J', 'K',"h","H","l","L",  'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft']);
     if (((appShellRailOn ? e.key === "]" : e.key === "Tab" && !e.shiftKey)) || ((e.key==="ArrowRight" ||e.keyCode===76)&& !e.shiftKey)) {
      e.preventDefault();
      if (isAIChatElementFocused()) return
      spaceship.focus.right()
    }

   else if (
      !activeItem &&
      activeElementIndex === -1 &&
      (activeKeysSet.has(e.key) || activeKeysSet.has(e.code)) &&
      !isAIChatElementFocused()
    ) {
      moveFocusWhenNoActive();
    }
    

    if (!activeItem && activeElementIndex === -1 && (e.key === 'c') && !e.shiftKey) {
      const event = new CustomEvent('ADD_NEW_TASK_ON_NO_FOCUS');
      document.dispatchEvent(event);
    }
  };

  const moveFocusWhenNoActive = () => {

    if (!_currentProject) return
    for (var i = 0; i < filteredSections.length; i++) {
      if (filteredSections[i].items.length > 0) {
        const item = filteredSections[i].items[0]
        const sectionEls = document.getElementById("sectionsContainer")!.children;
        // @ts-expect-error Element does not declare focus on this DOM collection.
        sectionEls[i].focus()
        updateActiveItemAndItemInView(item.id, _currentProject.id, getActiveSection());
        break;
      }
    }
  }


  const CTRL_F_handler = (e:any)=>{
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (e.keyCode === 70 && cmdControl) {
      if (showCommands.show || document.querySelector(".modal")) return;
      e.preventDefault();
      if (!showSearchTasks) {
        toggleSearchTasks(true);
        setTimeout(() => {
          document.getElementById('search-tasks-filter-input')?.focus();
        }, 200);
      } else {
        document.getElementById('search-tasks-filter-input')?.focus();
      }
    }
  }

    useEffect(() => { 
        if (filteredSections) {
          setSections(initialSections);
          setSectionsToDisplay(filteredSections)
        }
        setFirstTask(_currentProject?.firstTask)
      }, [filteredSections, initialSections, _currentProject]);
  

        useEffect(() => {
            const debouncedKeyDown = throttle(handleKeyDown, 20);
            
            document.addEventListener("keydown", debouncedKeyDown);

                return () => {
            document.removeEventListener("keydown", debouncedKeyDown);
            };

        }, [sections, undoData, showCommands, firstTask, _currentProject, handleKeyDown]);

        useEffect(() => {
          const handleKeyDown = (e: any) => CTRL_F_handler(e)
          document.addEventListener("keydown", handleKeyDown);
          return () => {
            document.removeEventListener("keydown", handleKeyDown);
          };
        }, [isApple, showSearchTasks, toggleSearchTasks, showCommands.show]);
        
        useEffect(() => {
            if (showBoardManager || showCommands.show || showSaveModal || returnIfModalOrInputActive() || showSearchTasks )return
        
            
            if (archiveFocusOrder && document.activeElement?.classList.contains("section-container")) return

            const activeItem = getActiveItem();
            const elementToActivate = document.getElementById(`task-${activeItem}`)
            if (activeItem && elementToActivate && !showSearchTasks) {
              spaceship.refocus(activeItem)
              const parent = elementToActivate?.parentElement?.id.split("-")[2]
              parent&&setActiveSection(parseInt(parent))
              
            } 
            else if (firstTask && _currentProject && !showSearchTasks) {
        
              const elementToFocus = document.getElementById(`task-${firstTask.id}`);
              if (elementToFocus) elementToFocus.focus();
              const parent = elementToFocus?.parentElement?.id.split("-")[2]
              parent&&setActiveSection(parseInt(parent))
              updateActiveItemAndItemInView(firstTask.id, _currentProject.id, getActiveSection())
            }
          }, [showBoardManager,showCommands.show,showSaveModal,firstTask, showSearchTasks, archiveFocusOrder]);

          useEffect(() => {

            const activeItem = getActiveItem();
            if (activeItem && !showBoardManager && !showCommands.show && !showSaveModal && document.activeElement?.tagName!=="INPUT" && !showSearchTasks ) {
            spaceship.refocus(activeItem)
          }
      
          }, [ showBoardManager, showCommands.show, showManageColumnsModal, showSaveModal, showSearchTasks])

  const onDragEndHandler = (result: DropResult) => {
    console.time("onDragEndHandler");
    const {source, destination, draggableId } = result;
    console.log("🚀 ~ onDragEndHandler ~ result:", result)
    if (!destination?.droppableId || !_currentProject) return;
  
    const itemId = parseInt(draggableId.split("-")[1]);
    const sectionIndex = parseInt(source.droppableId);
    console.log("🚀 ~ original Sections ~ sections:", sections)
    const displaySource = sectionsToDisplay[sectionIndex];
    const destinationSectionIdx = parseInt(destination.droppableId);
    const displayDestination = sectionsToDisplay[destinationSectionIdx];
    if (!displaySource || !displayDestination) return;
    const sectionId = displaySource.sectionId;

    const filter = displaySource.items.filter(i => i.id === itemId);
    console.log("🚀 ~ item from original ~ filter:", filter)
    if (!filter || filter.length === 0) {
      console.warn("🚀 ~ onDragEndHandler ~ dragged card not in rendered source column, aborting move:", draggableId);
      return;
    }
    if(sorting_mode_current === "UpdatedAt" && sectionIndex === destinationSectionIdx) return toast("Cannot move tasks while kanban is in Last Updated mode")

    const itemIndex = destination.index;

    const item = filter[0];
    console.log("🚀 ~ item picked up: ~ item:", item)

    let ranking: string | undefined = '';
    let newSecId: number = displayDestination.sectionId!;

    let finalDestinationSectionIndex = destinationSectionIdx
    const updatedAt = new Date()

    let relativeFilteredDestinationItems = displayDestination.items;
    if (sectionId === newSecId) {
      relativeFilteredDestinationItems = relativeFilteredDestinationItems.filter(
        (task) => task.id !== itemId
      );
    }

    if (itemIndex >= relativeFilteredDestinationItems.length) {
      const val1 = relativeFilteredDestinationItems.length > 0
        ? relativeFilteredDestinationItems[relativeFilteredDestinationItems.length - 1].ranking
        : undefined;
      ranking = generateRanking(val1, undefined);
    } else if (itemIndex === 0) {
      const val2 = relativeFilteredDestinationItems.length > 0
        ? relativeFilteredDestinationItems[itemIndex].ranking
        : undefined;
      ranking = generateRanking(undefined, val2);
    } else {
      const val1 = relativeFilteredDestinationItems[itemIndex - 1].ranking;
      const val2 = itemIndex < relativeFilteredDestinationItems.length
        ? relativeFilteredDestinationItems[itemIndex].ranking
        : undefined;
      ranking = generateRanking(val1, val2);
    }

    const newItem = {
      ...item,
      sectionId: newSecId,
      ranking,
      updatedAt: updatedAt.toString(),
    };

    const destinationSection = initialSections.find(
      (sec) => sec.sectionId === newSecId
    );
    if (!destinationSection) return;
    const sourceSection = initialSections.find((sec) => sec.sectionId === sectionId);
    if (!sourceSection) return;

    const sourceSectionItems = sectionId === newSecId
      ? destinationSection.items.filter((task) => task.id !== itemId)
      : sourceSection.items.filter((task) => task.id !== itemId);

    const destinationBaseItems = sectionId === newSecId
      ? sourceSectionItems
      : destinationSection.items;
    const destinationItems = [...destinationBaseItems];
    if (itemIndex >= relativeFilteredDestinationItems.length) {
      destinationItems.push(newItem);
    } else if (itemIndex === 0) {
      relativeFilteredDestinationItems.length === 0
        ? destinationItems.push(newItem)
        : destinationItems.unshift(newItem);
    } else {
      destinationItems.splice(itemIndex, 0, newItem);
    }

    const sortedDestinationItems = returnSortedItems(destinationItems, _currentProject!)
    const sortedSourceItems =
      sectionId === newSecId
        ? sortedDestinationItems
        : returnSortedItems(sourceSectionItems, _currentProject!);

    const newSections = initialSections.map((sec, index) => {
      if (sec.sectionId === newSecId) {
        finalDestinationSectionIndex = index
        return { ...sec, items: sortedDestinationItems };
      }

      if (sec.sectionId === sectionId) {
        return { ...sec, items: sortedSourceItems };
      }

      return sec;
    });
    console.log("🚀 ~ onDragEndHandler ~ newSections:", newSections)
    console.timeEnd("onDragEndHandler");
    const activeBuiltinViewId = activeBuiltinViews[_currentProject.id]
    const runningTimers = queryClient.getQueryData<Array<{ taskId: number }>>([
      "time",
      "running-board",
      _currentProject.id,
    ])
    const filterRuntimeContext = {
      legacyAgentAssigneeMatch: !assigneeFixEnabled,
      agentCreatorFilterEnabled,
      legacyMissingPersonalViewFilters: !defaultFiltersFixEnabled,
      ...(Array.isArray(runningTimers)
        ? { runningTaskIds: new Set(runningTimers.map((timer) => timer.taskId)) }
        : {}),
    }
    const filteredAppliedSections = getFilteredSections(
      newSections,
      _currentProject,
      isBuiltinViewId(activeBuiltinViewId) ? activeBuiltinViewId : undefined,
      buildBuiltinViewContext(_currentProject, currentUser?.id, undefined, currentUser?.displayName),
      filterRuntimeContext,
    )
    const filteredEmptySections = getFilteredEmptySections(filteredAppliedSections, _currentProject, showEmptyViewColumns)
    const filteredSubtaskSections = getAppliedSubtaskSections(filteredEmptySections,_currentProject) 
    setSectionsToDisplay(filteredSubtaskSections)
    const updatedTasks = newSections.flatMap((x)=>x.items)
    updateCache(newSections, updatedTasks);
    updateActiveItemAndItemInView(itemId, _currentProject.id, newSecId);
  
    setActiveSection(destinationSectionIdx);
    globalAPIHandlers.moveTaskHandler(
      newSections[finalDestinationSectionIndex].section_title,
      newSecId,
      item.id,
      ranking ?? "",
      item.projectId,
    );
  
  };

   const updateCache = (newSections: ISection[], tasks?:ITask[]) => {
  
      const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(_currentProject?.id)
  
      if (!allData || !allData.updatedProjects || projectToUpdateIndex == -1 || projectToUpdateIndex === undefined) return;
      mutationHandler(projectToUpdateIndex, newSections, allData, tasks)
    }

    return {sections, firstTask, setSections, lastgClick,onDragEndHandler,sectionsToDisplay, setSectionsToDisplay, spaceship}

}



export default useHandleKeyDownOperations
