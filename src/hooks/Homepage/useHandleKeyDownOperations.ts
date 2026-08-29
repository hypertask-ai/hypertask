/* eslint-disable react-hooks/exhaustive-deps */
// /* eslint-disable react-hooks/exhaustive-deps */
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

interface IHandleKeyDownOperations {
    initialSections: ISection[];
    handleBoardChange?:(index:number,sectionsFromCallback:ISection[])=>void,
    filteredSections:ISection[]

}

const useHandleKeyDownOperations= (props:IHandleKeyDownOperations) => {
    const {initialSections , handleBoardChange, filteredSections} = props
    const queryClient = useQueryClient();   
    const store = useStore();
    const {showManageColumnsModal, showSaveModal, toggleViewsModal, toggleSaveViewsModal, toggleSearchTasks, showSearchTasks} = useKanbanModalStatesContext()
    const { resetShowCommands }= useHypertasksRecoilStates()

    // =========== CALL hooks here
    const {updateActiveItemAndItemInView, mutationHandler, getProjectIdxAndAllData }=UpdateKanban();

    //This hook is for handling focus right now.
    const spaceship = useUniversalMovement({type: "Kanban", initialSections, filteredSections})

    const {undoData, undoAction} = useUndoContext();

  //Updarte to useRead only recoil values or setOnly
    // =========== RECOIL STATES
    const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
    const setShowSidebar = useSetRecoilState(showSidebarAtom);
    const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)
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

    const handleKeyDown = (e: any) => {
    let cmdControl = isApple&&e.metaKey || !isApple&&e.ctrlKey;
    e.preventDefault();

    if (e.key==="Escape") {
      resetShowCommands()
      return
    }

    // Favorite-board jump. Checked before the modal/input and #sectionsContainer guards
    // below so it stays global on a board: it has to work while typing in a filter, with
    // a modal open, or before the columns have rendered.
    if (isFavoriteBoardShortcut(e, isApple)) {
      e.preventDefault();
      const index = parseInt(e.code.replace("Digit", ""));
      if (index >= 0 && handleBoardChange) handleBoardChange(index, sections);
      return;
    }

    if (returnIfModalOrInputActive()) return

    // When board has no columns, [C] opens Add Column modal
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

    // console.log("🚀 ~ file: Homepage.tsx:178 ~ handleKeyDown ~ document.activeElement?.id:", document.activeElement?.id)
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
      // setShowShortcuts(false);
      // setShowBoardManager(false)
      if (activeItem) spaceship.refocus(activeItem)
    }
    
    // [shift] +[v]
    if (e.keyCode === 86 && e.shiftKey){
      if ( _currentProject?.project_view?.user_project_views[0]?.unsavedView )return toggleSaveViewsModal()
    }

    // [Z] FOR UNDO
    if (e.keyCode === 90&&undoData.length>0){
      // console.log("🚀 ~ handleKeyDown ~ e.keyCode:", e.keyCode)
      const firstUndoData = undoData[undoData.length - 1];
      // console.log("🚀 ~ handleKeyDown ~ firstUndoData:", firstUndoData)
      undoHandler(firstUndoData, firstUndoData.id);

  }
    // [shift] + [f] for filters
    if (e.shiftKey && e.keyCode===70) setShowCommands({show: true, mode: CommandMode.ShowFilterHTC})

    // [shift] + [s] for board sorting
    if (e.shiftKey && e.keyCode===83) setShowCommands({show: true, mode: CommandMode.SortKanbanBoard})
    

    // j for downmovement and k for up movement
    // HTPR-4903: the [k] twin below always excluded cmd/ctrl; [j] did not, so
    // Ctrl+J moved the focus down as a side effect of opening the AI Task Writer.
    if ((e.keyCode === 74 ||e.key==="ArrowDown") && !e.shiftKey && !cmdControl) {
      e.preventDefault();
      if (isAIChatElementFocused()) return
      spaceship.focus.down()
    }
    
    // k for up movement
    if ((e.keyCode === 75 ||e.key==="ArrowUp") && (!e.shiftKey && !cmdControl )) {
      e.preventDefault();
      if (isAIChatElementFocused()) return
      spaceship.focus.up()
    }
    
    // if (osName === "MacOS" && e.metaKey && e.key === "0" && projectIndex !==0) {
    //   e.preventDefault();
      // handleBoardChange(0,sections)
    // } 
  


    // shift and shift+tab for navigating between sections in sectionsContainer
    // l
    // "[" was a redundant focus-left twin of ArrowLeft/H on the rail shell;
    // it now toggles the sidebar instead (HTPR-4890, RAIL_TOGGLE_KEY).
    if ((!appShellRailOn && e.key === "Tab" && e.shiftKey) || ((e.key==="ArrowLeft" ||e.keyCode===72 )&& !e.shiftKey)) {
      //  from right to left
      e.preventDefault();
      if (isAIChatElementFocused()) return
      spaceship.focus.left()
    }

    // [g] press
    if (e.keyCode === 71) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, globalConstants.gThenKeyDelay); // 1000 milliseconds = 1 second
    }
    
    // [v] for views 
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

    // Shift+[t]: table/board layout toggle. Plain [t] stays "set tags" on the
    // focused task; the table view handles the reverse in TableView.
    if (e.keyCode === 84 && e.shiftKey) {
      e.preventDefault();
      toggleBoardLayout();
    }

    let activeKeysSet = new Set(['j', 'k', 'J', 'K',"h","H","l","L",  'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft']);
    // if (e.key==="Tab" && _activeItem===null){
    //   e.preventDefault()
    // }
     if (((appShellRailOn ? e.key === "]" : e.key === "Tab" && !e.shiftKey)) || ((e.key==="ArrowRight" ||e.keyCode===76)&& !e.shiftKey)) {
      // from left to right
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
    

    if (!activeItem && activeElementIndex === -1 && (e.key === 'c')) {
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
        // @ts-ignore
        sectionEls[i].focus()
        updateActiveItemAndItemInView(item.id, _currentProject.id, getActiveSection());
        break;
      }
    }
  }


  // ============== task archive/ delete undo handler
  const undoHandler = async (data: any, toastId: string) => {
    //  first you need to bring the item back in its place.
    // then you need to run the api call so there is no render blocking. 
    await undoAction("UNDO_REMOVE", data)
    // router.refresh()
    toast.dismiss(toastId);  // Dismiss the toast here
    queryClient.refetchQueries({queryKey:["projectsAll"]})
    toast("Undo remove")
    
  }

  const CTRL_F_handler = (e:any)=>{
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (e.keyCode === 70 && cmdControl) { // [Cmd+F] or [Ctrl+F]
      // Never steal focus from the command palette or an open modal.
      if (showCommands.show || document.querySelector(".modal")) return;
      e.preventDefault();
      if (!showSearchTasks) {
        // Open the search filter
        toggleSearchTasks(true);
        setTimeout(() => {
          document.getElementById('search-tasks-filter-input')?.focus();
        }, 200);
      } else {
        // Refocus the input if it's already open
        document.getElementById('search-tasks-filter-input')?.focus();
      }
    }
  }

    // =========== useEffect for either on fresh reload or when there is new data from TanStack
    useEffect(() => { 
        // console.log("🚀 ~ useEffect ~ initialSections:", initialSections)
        // addLastActivityAt(_currentProject?.teamId!, undefined)

        if (filteredSections) {
          // getSections()
          // Assuming _currentProject.sections is an array of sections
          setSections(initialSections);
          setSectionsToDisplay(filteredSections)
        }
        // console.log("🚀 ~ useEffect ~ _currentProject:", _currentProject)
        setFirstTask(_currentProject?.firstTask)
        // console.log(_sections)
        setCurrentProject(_currentProject)
      }, [filteredSections, initialSections, _currentProject]);
  

        // -------------------------- keyboard handler 
        useEffect(() => {
            const debouncedKeyDown = throttle(handleKeyDown, 20); // Adjust the debounce delay as needed (e.g., 300 milliseconds)
            // const debounceKeyUp  = throttle(handleKeyUp,20)
            
            document.addEventListener("keydown", debouncedKeyDown);
            // document.addEventListener('keyup', debounceKeyUp);

                return () => {
            document.removeEventListener("keydown", debouncedKeyDown);
            // document.removeEventListener('keyup', debounceKeyUp);

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
            // if (_activeItem===firstTask?.id)return
            // console.log("🚀 ~ useEffect ~ elementToFocus:")
        
            
            const activeItem = getActiveItem();
            const elementToActivate = document.getElementById(`task-${activeItem}`)
            // if (!parent)return
            if (activeItem && elementToActivate && !showSearchTasks) {
              spaceship.refocus(activeItem)
              const parent = elementToActivate?.parentElement?.id.split("-")[2]
              parent&&setActiveSection(parseInt(parent))
              
            } 
            // console.log('focus goes to ==>', firstTask.uniqueIndex)
            else if (firstTask && _currentProject && !showSearchTasks) {
        
              const elementToFocus = document.getElementById(`task-${firstTask.id}`);
              if (elementToFocus) elementToFocus.focus();
              const parent = elementToFocus?.parentElement?.id.split("-")[2]
              parent&&setActiveSection(parseInt(parent))
              updateActiveItemAndItemInView(firstTask.id, _currentProject.id, getActiveSection())
            }
          }, [showBoardManager,showCommands.show,showSaveModal,firstTask, showSearchTasks]);
        
  


          //  this one is responsible to bring focus back to the active element when you open a modal
          //  HTPR-5201: the save-view modal was missing here, so saving a view dropped DOM
          //  focus to <body> and the next h/l landed on whatever card the fallback picked
          //  (usually the last one in the column) instead of the card you were on.
          useEffect(() => {

            const activeItem = getActiveItem();
            if (activeItem && !showBoardManager && !showCommands.show && !showSaveModal && document.activeElement?.tagName!=="INPUT" && !showSearchTasks ) {
            spaceship.refocus(activeItem)
            // document.getElementById('task-' + _activeItem)?.scrollIntoView({  block: 'center' ,inline: "center", behavior:"smooth" as ScrollBehavior});
          }
      
          }, [ showBoardManager, showCommands.show, showManageColumnsModal, showSaveModal, showSearchTasks])

  // ===================== dragend handler
  const onDragEndHandler = (result: DropResult) => {
    console.time("onDragEndHandler"); // Start the timer
    const {source, destination, draggableId } = result;
    console.log("🚀 ~ onDragEndHandler ~ result:", result)
    if (!destination?.droppableId || !_currentProject) return;
  
    const itemId = parseInt(draggableId.split("-")[1]);
    const sectionIndex = parseInt(source.droppableId); // section index where the item was dragged from
    console.log("🚀 ~ original Sections ~ sections:", sections)
    // return;
    // DropResult indices refer to the RENDERED lists: sectionsToDisplay is what
    // maps to the Droppables/Draggables (Homepage.tsx). The filteredSections
    // prop can lag behind that state (cache-update lag after a previous drag),
    // and positional lookups against it then resolve a DIFFERENT card/column
    // and move the WRONG task server-side (HTPR-4543). Resolve everything
    // against sectionsToDisplay, and the dragged card by id, never by index.
    const displaySource = sectionsToDisplay[sectionIndex];
    const destinationSectionIdx = parseInt(destination.droppableId); // section index where the item was dropped at
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
    console.timeEnd("onDragEndHandler"); // Stop the timer and log the elapsed time
    const activeBuiltinViewId = activeBuiltinViews[_currentProject.id]
    const runningTimers = queryClient.getQueryData<Array<{ taskId: number }>>([
      "time",
      "running-board",
      _currentProject.id,
    ])
    const filterRuntimeContext = Array.isArray(runningTimers)
      ? { runningTaskIds: new Set(runningTimers.map((timer) => timer.taskId)) }
      : undefined
    const filteredAppliedSections = getFilteredSections(
      newSections,
      _currentProject,
      isBuiltinViewId(activeBuiltinViewId) ? activeBuiltinViewId : undefined,
      buildBuiltinViewContext(_currentProject, currentUser?.id),
      filterRuntimeContext,
    )
    const filteredEmptySections = getFilteredEmptySections(filteredAppliedSections, _currentProject)
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
  
      // if (!allData || !projectToUpdateIndex) return;
      if (!allData || !allData.updatedProjects || projectToUpdateIndex == -1 || projectToUpdateIndex === undefined) return;
      mutationHandler(projectToUpdateIndex, newSections, allData, tasks)
    }

    return {sections, firstTask, setSections, lastgClick,onDragEndHandler,sectionsToDisplay, setSectionsToDisplay, spaceship}

}



export default useHandleKeyDownOperations
