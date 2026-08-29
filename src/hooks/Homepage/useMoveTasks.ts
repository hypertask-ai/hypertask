import { ISection, ITask } from '@/models/model';
import { deepCopy, isSameDay, returnSortedItems, scrollToCenterIfNearBottom, scrollToCenterIfNearTop } from '@/utils/helperFunctions/helperFunctions';
import globalAPIHandlers from '@/utils/api/global';
import { useRecoilState, useSetRecoilState } from '@/lib/state'
import { currentProjectAtom, activeSectionAtom } from '@/store'
import { useStore } from 'jotai';
import generateRanking from '@/utils/generateRank'
import UpdateKanban from '../MultiPages/useUpdateTaskInBoards';
import { useMemo } from 'react';
import { getActiveSortingModeFromProject } from '@/utils/helperFunctions/Views/ViewsHelperFunctions';
import toast from 'react-hot-toast';

interface IUseMoveTasks {
  initialSections: ISection[];
  filteredSections: ISection[]

}

const useMoveTasks = (props: IUseMoveTasks) => {
  const { initialSections: sections, filteredSections } = props
  const store = useStore();

  const { updateActiveItemAndItemInView, mutationHandler, getProjectIdxAndAllData, updateTaskInCache } = UpdateKanban();

  const deepCopiedSections = useMemo(()=>deepCopy(sections),[sections])

  const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)
  const setActiveSection = useSetRecoilState(activeSectionAtom);
  const getActiveSection = () => store.get(activeSectionAtom);
  const sorting_mode_current = getActiveSortingModeFromProject(_currentProject)

  // shift + h => left movement
  const moveItemLeft = async (
    sectionId: number,
    itemId: number
  ) => await moveItemHorizontal(sectionId, itemId, "Left")


  const moveItemHorizontal = async (
    sectionId: number,
    itemId: number,
    direction: "Left" | "Right"

  ) => {
    console.time("Moving item horizontally: ")
    const updatedAt = new Date()
    const currSectionIdx = sections.findIndex((sec) => sec.sectionId === sectionId);
    console.log("🚀 ~ useMoveTasks ~ sections:", sections)
    const currSection = sections[currSectionIdx]
    const currFilteredSection = filteredSections[currSectionIdx]
    
    const targetSectionIdx = currSectionIdx + (direction === "Left" ? -1 : 1)

    const filter = currSection.items.filter(i => i.id === itemId);
    if ( !filter || filter.length === 0) return;

    const itemToMoveIndex = currSection.items.indexOf(filter[0]);
    const filteredItemToMoveIndex = currFilteredSection?.items.indexOf(filter[0]);

    if (itemToMoveIndex === -1) return;
    const itemToMove = currSection.items[itemToMoveIndex];
    const filteredItemToMove = currFilteredSection?.items[filteredItemToMoveIndex]

    let ranking: string | undefined = '';

    // Create a copy of the sections array to avoid modifying the original array
    var newSections = deepCopiedSections;

    let newSecId = newSections[targetSectionIdx]?.sectionId;
    if (!newSecId) return
    // Modify the section that matches the condition
    newSections.forEach((targetSection, index) => {
      const targetSectionItems = targetSection.items;
      const filteredTargetSectionItems = filteredSections[index]?.items
      const lastItemInTargetSection = targetSectionItems[targetSectionItems.length - 1]

      if (targetSection.sectionId === sectionId) {
        newSections[index].items.splice(itemToMoveIndex, 1);
      }

      // we're in the target sectionid 
      if (targetSection.sectionId === sections[targetSectionIdx].sectionId) {
        let newItem;
        // ======== current index was 10, but target section only had 0-9 index
        if (itemToMoveIndex >= targetSectionItems.length) {
          const prevRank = targetSectionItems.length > 0 ? lastItemInTargetSection.ranking : undefined
          const nextRank = undefined
          ranking = generateRanking(prevRank,  nextRank);
          newItem = { ...itemToMove, sectionId: newSecId, ranking: ranking, updatedAt: updatedAt.toString() }

          newSections[index].items.push(newItem);
        }

        // ======== current index is 0
        else if (itemToMoveIndex === 0) {
          const prevRank = undefined
          const nextRank = targetSectionItems.length > 0 ? targetSectionItems[itemToMoveIndex].ranking : undefined
          ranking = generateRanking(prevRank,  nextRank);

          newItem = { ...itemToMove, sectionId: newSecId, ranking: ranking, updatedAt: updatedAt.toString() }

          //check if section is empty. if yes, use push, else use unshift
          targetSectionItems.length === 0 ?
            newSections[index].items.push(newItem) :
            newSections[index].items.unshift(newItem)

          // newSections[index].items.push(newItem);
        }

        // ========= current index is somewhere between 1, and within target section's length
        else {
          const prevRank = targetSectionItems[itemToMoveIndex - 1].ranking
          const nextRank = (itemToMoveIndex) < targetSectionItems.length ? targetSectionItems[itemToMoveIndex].ranking : undefined
          ranking = generateRanking(prevRank,  nextRank);

          let newItem = { ...itemToMove, sectionId: newSecId, ranking: ranking, updatedAt: updatedAt.toString()  }
          newSections[index].items.splice(itemToMoveIndex, 0, newItem);
        }
        let itemsToSort = returnSortedItems(newSections[index].items,_currentProject! )
        
        // console.log("🚀 ~ newSections.forEach ~ itemsToSort:", itemsToSort)
        newSections[index].items = itemsToSort
      }

    });
    

    _currentProject && updateActiveItemAndItemInView(itemId, _currentProject.id, getActiveSection());
    setActiveSection(targetSectionIdx)
    
    console.timeEnd("Moving item horizontally: ")
    const updatedTasks = newSections.flatMap((x)=>x.items)
    console.log("🚀 ~ useMoveTasks ~ updatedTasks:", updatedTasks)
    updateCache(newSections,updatedTasks)


    await globalAPIHandlers.moveTaskHandler(
      newSections[targetSectionIdx].section_title,
      newSecId,
      itemToMove.id,
      ranking,
      itemToMove.projectId,
    )
  }

  // [shift + l] => right movement
  const moveItemRight = async (
    sectionId: number,
    itemId: number
  ) => {

    await moveItemHorizontal(sectionId, itemId, "Right")

  };



  const moveItemUp = async (
    sectionId: number,
    itemId: number
  ) => {

    // if (_currentProject?.sorting_mode==="Priority")         
    if(sorting_mode_current === "UpdatedAt") return toast("Cannot move tasks while kanban is in Last Updated mode")
// Convert sections and filteredSections arrays to Maps for faster lookups
    const sectionsMap:any = new Map(sections.map(section => [section.sectionId, section]));
    const filteredSectionsMap = new Map(filteredSections.map(section => [section.sectionId, section]));
    
    // Use Maps for faster lookup
    const section = sectionsMap.get(sectionId);
    const filteredSection = filteredSectionsMap.get(sectionId);
    
    if (!section ||!filteredSection) return;
    
    // Since we're using Maps, we can directly access the items array without needing to find the index
    const originalItem = section.items.find((i:ITask) => i.id === itemId);
    const filteredItem = filteredSection.items.find(i => i.id === itemId);
    
    if (!originalItem ||!filteredItem) return;
    
    // Directly access the items array without needing to find the index
    const filteredItemIndex = filteredSection.items.indexOf(filteredItem);
    
    if (filteredItemIndex === 0) return;
    
    const item = filteredSection.items[filteredItemIndex];
    const aboveItem = filteredSection.items[filteredItemIndex - 1];

    if (
      sorting_mode_current === "Priority" &&
      aboveItem.priority?.priority_index !== item.priority?.priority_index) return toast("Cannot move tasks while kanban is in Priority mode")
    else if (
      sorting_mode_current === "DueDate" &&
      !isSameDay(aboveItem.dueDate, item.dueDate)
    ) {
      return toast("Cannot move tasks while kanban is in Due Date mode");
    }
    
    const newSections = deepCopiedSections.map((sec) => {
      if (sec.sectionId === sectionId) {
        // Create a copy of the items array before modifying it
        const updatedItems = [...sec.items];
        const aboveItemIndex = sec.items.findIndex(i => aboveItem.id === i.id)

        const BelowItemIndex = sec.items.findIndex(i => item.id === i.id)
        const updatedAboveItem = { ...aboveItem, ranking: item.ranking }
        const updatedItem = { ...item, ranking: aboveItem.ranking }
        updatedItems.splice(BelowItemIndex, 1, updatedAboveItem);
        updatedItems.splice(aboveItemIndex, 1, updatedItem);
        // Update the items array with the modified copy
        sec.items = updatedItems;
      }
      return sec;
    });
    _currentProject && updateActiveItemAndItemInView(itemId, _currentProject.id, getActiveSection())
    const updatedTasks = newSections.flatMap((x)=>x.items)
    updateCache(newSections, updatedTasks)
    const activeElement_=document.getElementById(`task-${aboveItem.id}`)
    activeElement_ && scrollToCenterIfNearTop(activeElement_,20)
    await Promise.all([
      fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTask: { id: item.id, ranking: aboveItem.ranking } })
      }),
      fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTask: { id: aboveItem.id, ranking: item.ranking } })
      })
    ])

  };

  // Assuming the existence of a deepCopy function for deep cloning objects
  // and other necessary variables and functions like _currentProject, toast, updateActiveItemAndItemInView, updateCache

  const moveItemDown = async (
    sectionId: number,
    itemId: number
  ) => {
    console.time("Moving item vertically downwards: ")
    if(sorting_mode_current === "UpdatedAt") return toast("Cannot move tasks while kanban is in Last Updated mode")

    const sectionsMap:any = new Map(sections.map(section => [section.sectionId, section]));
    const filteredSectionsMap = new Map(filteredSections.map(section => [section.sectionId, section]));
    
    const section = sectionsMap.get(sectionId);
    const filteredSection = filteredSectionsMap.get(sectionId);
    
    if (!section ||!filteredSection) return;
    
    const originalItem = section.items.find((i:ITask) => i.id === itemId);
    const filteredItem = filteredSection.items.find(i => i.id === itemId);

    if (!originalItem || !filteredItem) return;

    const filteredItemIndex = filteredSection.items.indexOf(filteredItem);
    
    if (filteredItemIndex === filteredSection.items.length - 1) return;
    
    const item = filteredSection.items[filteredItemIndex];
    const belowItem = filteredSection.items[filteredItemIndex + 1];

    if (
      sorting_mode_current === "Priority" &&
      belowItem.priority?.priority_index !== item.priority?.priority_index
    ) {
      return toast("Cannot move tasks while kanban is in Priority mode");
    }
    else if (
      sorting_mode_current === "DueDate" &&
      !isSameDay(belowItem.dueDate, item.dueDate)
    ) {
      return toast("Cannot move tasks while kanban is in Due Date mode");
    }


    const newSections = deepCopiedSections.map((sec) => {
      if (sec.sectionId === sectionId) {
        const updatedItems = [...sec.items];
        const aboveItemIndex = sec.items.findIndex(i => item.id === i.id)
        const BelowItemIndex = sec.items.findIndex(i => belowItem.id === i.id)
        const updatedBelowItem = { ...belowItem, ranking: item.ranking }
        const updatedItem = { ...item, ranking: belowItem.ranking }
        // Move the item to the new position, replacing the item at the destination index
        updatedItems.splice(BelowItemIndex, 1, updatedItem);
        // Shift the item originally at the destination index to the next position
        updatedItems.splice(aboveItemIndex, 1, updatedBelowItem);
        sec.items = updatedItems;
    
      }
      return sec;
    });

    _currentProject && updateActiveItemAndItemInView(itemId, _currentProject.id, getActiveSection());
    console.timeEnd("Moving item vertically downwards: ")
    const updatedTasks = newSections.flatMap((x)=>x.items)
    updateCache(newSections, updatedTasks)
    const activeElement_=document.getElementById(`task-${belowItem.id}`)
    activeElement_ && scrollToCenterIfNearBottom(activeElement_,20)

    await Promise.all([
      fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTask: { id: item.id, ranking: belowItem.ranking } }),
      }),
      fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTask: { id: belowItem.id, ranking: item.ranking } }),
      }),
    ]);

  };


  const updateCache = (newSections: ISection[], tasks?:ITask[]) => {

    const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(_currentProject?.id)

    // if (!allData || !projectToUpdateIndex) return;
    if (!allData || !allData.updatedProjects || projectToUpdateIndex == -1 || projectToUpdateIndex === undefined) return;
    mutationHandler(projectToUpdateIndex, newSections, allData, tasks)
  }

  return { moveItemLeft, moveItemRight, moveItemDown, moveItemUp }

}

export default useMoveTasks
