import { ISection, ITask } from "@/models/model";
import { activeItemAtom, activeSectionAtom, currentProjectAtom } from "@/store";
import { useStore } from "jotai";
import {
  isSameDay,
  returnSortedItems,
  scrollToCenterIfNear,
  scrollToCenterIfNearBottom,
  scrollToCenterIfNearTop,
} from "@/utils/helperFunctions/helperFunctions";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { useProjectQuery } from "./General/useProjectQuery";
import UpdateKanban from "./MultiPages/useUpdateTaskInBoards";
import { getActiveSortingModeFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { focusedCardIndexInColumn } from "@/utils/helperFunctions/Kanban/columnFocus";
import toast from "react-hot-toast";
import globalAPIHandlers from "@/utils/api/global";
import generateRanking from "@/utils/generateRank";
import {
  LEARN_TUTORIAL_TASK_MOVED_EVENT,
  type LearnTutorialTaskPersistedDetail,
} from "@/lib/tutorial/learnTutorialState";

const publishLearnTutorialTaskMove = (
  detail: LearnTutorialTaskPersistedDetail,
) =>
  window.dispatchEvent(
    new CustomEvent(LEARN_TUTORIAL_TASK_MOVED_EVENT, { detail }),
  );

interface IHomeView {
  type: "Kanban" | "List";
  initialSections: ISection[];
  filteredSections: ISection[];
}

interface ICalendarView {
  type: "Calendar";
  view: "Month" | "Week" | "Day";
}

type TProps = IHomeView | ICalendarView;

export function useUniversalMovement(props: TProps) {
  const store = useStore();
  const setActiveSection = useSetRecoilState(activeSectionAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const getActiveSection = () => store.get(activeSectionAtom);
  const getActiveItem = () => store.get(activeItemAtom);

  const { updateSectionsInProject } = UpdateKanban();

  const { updateActiveItemAndItemInView } = useProjectQuery();

  function refocus(itmId: number) {
    document.getElementById("task-" + itmId)?.focus();
  }

  async function moveTaskHorizontally(
    sectionId: number,
    itemId: number,
    direction: "Left" | "Right",
    forceNavigate: boolean = false,
  ) {
    if (props.type === "Calendar") return;

    const { initialSections: sections, filteredSections } = props;
    const updatedAt = new Date();
    const currSectionIdx = sections.findIndex(
      (sec) => sec.sectionId === sectionId,
    );
    const currSection = sections[currSectionIdx];
    const targetSectionIdx = currSectionIdx + (direction === "Left" ? -1 : 1);

    const filter = currSection.items.filter((i) => i.id === itemId);
    if (!filter || filter.length === 0) return;

    const itemToMoveIndex = currSection.items.indexOf(filter[0]);

    if (itemToMoveIndex === -1) return;
    const itemToMove = currSection.items[itemToMoveIndex];

    let ranking: string | undefined = "";

    let newSecId = sections[targetSectionIdx]?.sectionId;
    if (!newSecId) return;
    const targetSection = sections[targetSectionIdx];
    const targetSectionItems = targetSection.items;
    const lastItemInTargetSection =
      targetSectionItems[targetSectionItems.length - 1];

    if (forceNavigate && direction === "Left") {
      const prevRank =
        targetSectionItems.length > 0
          ? lastItemInTargetSection.ranking
          : undefined;
      ranking = generateRanking(prevRank, undefined);
    } else if (forceNavigate && direction === "Right") {
      console.log(
        "🚀 ~ moveTaskHorizontally ~ itemToMoveIndex jere:",
        itemToMoveIndex,
      );
      const nextRank =
        targetSectionItems.length > 0
          ? targetSectionItems[itemToMoveIndex]?.ranking
          : undefined;
      ranking = generateRanking(undefined, nextRank);
    } else if (itemToMoveIndex >= targetSectionItems.length) {
      const prevRank =
        targetSectionItems.length > 0
          ? lastItemInTargetSection.ranking
          : undefined;
      ranking = generateRanking(prevRank, undefined);
    } else if (itemToMoveIndex === 0) {
      const nextRank =
        targetSectionItems.length > 0
          ? targetSectionItems[itemToMoveIndex].ranking
          : undefined;
      ranking = generateRanking(undefined, nextRank);
    } else {
      const prevRank = targetSectionItems[itemToMoveIndex - 1].ranking;
      const nextRank =
        itemToMoveIndex < targetSectionItems.length
          ? targetSectionItems[itemToMoveIndex].ranking
          : undefined;
      ranking = generateRanking(prevRank, nextRank);
    }

    const newItem = {
      ...itemToMove,
      sectionId: newSecId,
      section: targetSection.section_title,
      ranking,
      updatedAt: updatedAt.toString(),
    };
    const targetItems = [...targetSectionItems];

    if (forceNavigate && direction === "Left") {
      targetItems.push(newItem);
    } else if (forceNavigate && direction === "Right") {
      targetSectionItems.length === 0
        ? targetItems.push(newItem)
        : targetItems.unshift(newItem);
    } else if (itemToMoveIndex >= targetSectionItems.length) {
      targetItems.push(newItem);
    } else if (itemToMoveIndex === 0) {
      targetSectionItems.length === 0
        ? targetItems.push(newItem)
        : targetItems.unshift(newItem);
    } else {
      targetItems.splice(itemToMoveIndex, 0, newItem);
    }

    const sortedTargetItems = returnSortedItems(targetItems, currentProject!);
    const sourceItems = currSection.items.filter((task) => task.id !== itemId);
    const newSections = sections.map((section, index) => {
      if (index === currSectionIdx) return { ...section, items: sourceItems };
      if (index === targetSectionIdx)
        return { ...section, items: sortedTargetItems };
      return section;
    });

    currentProject && updateActiveItemAndItemInView(newItem);
    setActiveSection(targetSectionIdx);

    console.timeEnd("Moving item horizontally: ");
    const updatedTasks = newSections.flatMap((x) => x.items);
    updateSectionsInProject(newSections, updatedTasks);

    const persisted = await globalAPIHandlers.moveTaskHandler(
      newSections[targetSectionIdx].section_title,
      newSecId,
      itemToMove.id,
      ranking ?? "",
      itemToMove.projectId,
    );
    if (persisted) {
      publishLearnTutorialTaskMove({
        taskId: itemId,
        direction: direction === "Left" ? "left" : "right",
        fromSectionId: sectionId,
        toSectionId: newSecId,
      });
    }
  }

  async function moveTaskVertically(
    sectionId: number,
    itemId: number,
    direction: "up" | "down",
  ) {
    if (props.type === "Calendar") return;

    const { initialSections: sections, filteredSections } = props;
    const sorting_mode_current =
      getActiveSortingModeFromProject(currentProject);

    if (sorting_mode_current === "UpdatedAt")
      return toast("Cannot move tasks while kanban is in Last Updated mode");

    // Convert sections and filteredSections arrays to Maps for faster lookups
    const sectionsMap: any = new Map(
      sections.map((section) => [section.sectionId, section]),
    );
    const filteredSectionsMap = new Map(
      filteredSections.map((section) => [section.sectionId, section]),
    );

    const section = sectionsMap.get(sectionId);
    const filteredSection = filteredSectionsMap.get(sectionId);

    if (!section || !filteredSection) return;

    const originalItem = section.items.find((i: ITask) => i.id === itemId);
    const filteredItem = filteredSection.items.find((i) => i.id === itemId);

    if (!originalItem || !filteredItem) return;

    const filteredItemIndex = filteredSection.items.indexOf(filteredItem);

    if (direction === "up" && filteredItemIndex === 0)
      return moveTaskHorizontally(sectionId, itemId, "Left", true);
    if (
      direction === "down" &&
      filteredItemIndex === filteredSection.items.length - 1
    )
      return moveTaskHorizontally(sectionId, itemId, "Right", true);

    const item = filteredSection.items[filteredItemIndex];
    const adjacentItemIndex =
      direction === "up" ? filteredItemIndex - 1 : filteredItemIndex + 1;
    const adjacentItem = filteredSection.items[adjacentItemIndex];

    // Validate sorting mode constraints
    if (
      sorting_mode_current === "Priority" &&
      adjacentItem.priority?.priority_index !== item.priority?.priority_index
    ) {
      return toast("Cannot move tasks while kanban is in Priority mode");
    } else if (
      sorting_mode_current === "DueDate" &&
      !isSameDay(adjacentItem.dueDate, item.dueDate)
    ) {
      return toast("Cannot move tasks while kanban is in Due Date mode");
    }

    // Swap items in sections
    const newSections = sections.map((sec) => {
      if (sec.sectionId === sectionId) {
        const updatedItems = [...sec.items];
        const itemIndex = sec.items.findIndex((i) => item.id === i.id);
        const adjacentItemIndexInSection = sec.items.findIndex(
          (i) => adjacentItem.id === i.id,
        );

        const updatedAdjacentItem = {
          ...adjacentItem,
          ranking: item.ranking,
        };
        const updatedItem = { ...item, ranking: adjacentItem.ranking };

        if (direction === "up") {
          updatedItems.splice(itemIndex, 1, updatedAdjacentItem);
          updatedItems.splice(adjacentItemIndexInSection, 1, updatedItem);
        } else {
          updatedItems.splice(adjacentItemIndexInSection, 1, updatedItem);
          updatedItems.splice(itemIndex, 1, updatedAdjacentItem);
        }

        return { ...sec, items: updatedItems };
      }
      return sec;
    });

    updateActiveItemAndItemInView(item);
    const updatedTasks = newSections.flatMap((x) => x.items);
    updateSectionsInProject(newSections, updatedTasks);

    // Scroll to the adjacent item
    const activeElement_ = document.getElementById(`task-${adjacentItem.id}`);
    if (activeElement_) {
      if (direction === "up") {
        scrollToCenterIfNearTop(activeElement_, 20);
      } else {
        scrollToCenterIfNearBottom(activeElement_, 20);
      }
    }

    // Update rankings via API
    const responses = await Promise.all([
      fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newTask: { id: item.id, ranking: adjacentItem.ranking },
        }),
      }),
      fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newTask: { id: adjacentItem.id, ranking: item.ranking },
        }),
      }),
    ]);
    if (responses.every((response) => response.ok)) {
      publishLearnTutorialTaskMove({
        taskId: itemId,
        direction,
        fromSectionId: sectionId,
        toSectionId: sectionId,
      });
    }
  }

  function moveFocusToSection(
    index: number,
    filteredSections: ISection[],
    itemIndex?: number,
    forceNavigate?: "Left" | "Right",
  ) {
    console.log("🚀 ~ moveFocusToSection ~ itemIndex:", itemIndex);
    if (!currentProject) return;
    const sectionEls = document.getElementById("sectionsContainer")!.children;
    let ItemId: number | null = null;
    // Columns the board search hides stay in the DOM so drag indices keep
    // matching the rendered order; step past them so navigation always lands
    // on a column the user can actually see.
    const step = index < (getActiveSection() ?? 0) ? -1 : 1;
    while (
      index >= 0 &&
      index < sectionEls.length &&
      (sectionEls[index] as HTMLElement).offsetParent === null
    ) {
      index += step;
    }
    if (index >= 0 && index < sectionEls.length) {
      // @ts-ignore
      // I dont think this section focus is working right now
      sectionEls[index].focus();
      setActiveSection(index);
      const sectionLength = filteredSections[index].items.length;
      if (sectionLength > 0) {
        if (sectionLength < itemIndex! + 1) {
          const item = filteredSections[index].items[sectionLength - 1];
          updateActiveItemAndItemInView(item);
          ItemId = item.id;
        } else if (itemIndex) {
          const item = filteredSections[index].items[itemIndex];
          updateActiveItemAndItemInView(item);
          ItemId = item.id;
        } else {
          let indexToUse = 0;
          if (forceNavigate === "Left") {
            indexToUse = filteredSections[index].items.length - 1;
          } else if (forceNavigate === "Right") {
            indexToUse = 0;
          }
          const item = filteredSections[index].items[indexToUse];
          updateActiveItemAndItemInView(item);
          ItemId = item.id;
        }
      } else {
        document
          .getElementById("header")
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
        updateActiveItemAndItemInView(null);
      }
    } else updateActiveItemAndItemInView(null);

    if (ItemId) {
      refocus(ItemId);
      const element = document.getElementById(`task-${ItemId}`);
      element && scrollToCenterIfNear(element, 10);
    } else {
      // index can land outside the list when every column is hidden by the
      // board search; scrollToCenterIfNear dereferences its argument.
      const element = sectionEls[index] as HTMLElement | undefined;
      element && scrollToCenterIfNear(element);
    }
  }

  const focus = {
    up: () => {
      /**
       * For Kanban
       * Works on tasks only.
       *
       * For List
       * Works on tasks only. (skip empty sections and jump focus to next task)
       *
       *
       */

      if (props.type === "Kanban" || props.type === "List") {
        const activeElement = document.activeElement;
        //We need to make sure this tasks-list-${activeSection} is saved in a config somewhere.
        const tasksList = document?.getElementById(
          `tasks-list-${getActiveSection()}`,
        )?.children;

        if (tasksList && tasksList.length > 0 && activeElement) {
          const index = Array.from(tasksList).indexOf(activeElement);
          if (index === -1) {
            if (props.type === "List") {
              focus.left(true);
            } else {
              document.getElementById(tasksList[0].id)?.focus();
            }
          } else if (index === 0) {
            // Here we need to check if the props.type is List. Because in List view we have sections stacked on top of each other.
            // And as such we need to jump focus to the next section above it with the bottom most task init.
            if (props.type === "List") focus.left(true);
          } else {
            const activeElement_ = document.getElementById(
              tasksList[index - 1].id,
            );
            activeElement_ && scrollToCenterIfNearTop(activeElement_, 30);
            activeElement_?.focus();
            if (index - 1 === 0)
              document
                .getElementById(tasksList[0].id)
                ?.scrollIntoView({ block: "center" });
          }
        }
      }
    },
    down: () => {
      /**
       * For Kanban
       * Works on tasks only.
       *
       * For List
       * Works on tasks only. (skip empty sections and jump focus to next task)
       */

      if (props.type === "Kanban" || props.type === "List") {
        const activeElement = document.activeElement;

        const tasksList = document?.getElementById(
          `tasks-list-${getActiveSection()}`,
        )?.children;
        if (tasksList && tasksList.length > 0 && activeElement) {
          const index = Array.from(tasksList).indexOf(activeElement);
          if (index === -1) {
            if (props.type === "List") {
              focus.right(true);
            } else {
              document.getElementById(tasksList[0].id)?.focus();
            }
          } else if (index === tasksList.length - 2) {
            // Here we need to check if the props.type is List. Because in List view we have sections stacked on top of each other.
            // And as such we need to jump focus to the next section below it with the top most task init.
            if (props.type === "List") focus.right(true);
          } else {
            const activeElement_ = document.getElementById(
              tasksList[index + 1].id,
            );
            activeElement_ && scrollToCenterIfNearBottom(activeElement_, 15);
            activeElement_?.focus();
          }
        }
      }
    },
    left: (forceNavigate: boolean = false) => {
      /**
       * For Kanban
       * Works on tasks and empty sections.
       *
       * For List
       * No need for list view
       */

      if (props.type === "Kanban" || (props.type === "List" && forceNavigate)) {
        const { filteredSections } = props;
        const sectionEls =
          document.getElementById("sectionsContainer")!.children;
        const activeElement = document.activeElement;
        const activeElementIndex = Array.from(sectionEls).indexOf(
          activeElement!,
        );

        const activeElementInSection = focusedCardIndexInColumn(activeElement);
        const activeItem = getActiveItem();

        if (activeElementIndex <= 0) {
          if (activeItem && activeElementIndex === -1) {
            const filter = filteredSections.filter((s) => {
              const _filter = s.items.filter((i) => i.id === activeItem);
              return _filter && _filter.length > 0;
            });
            if (filter && filter.length > 0) {
              const _index = filteredSections.indexOf(filter[0]);
              if (_index > 0)
                moveFocusToSection(
                  _index - 1,
                  filteredSections,
                  forceNavigate
                    ? filteredSections[_index - 1].items.length - 1
                    : activeElementInSection,
                );
            } else
              moveFocusToSection(
                sectionEls.length - 1,
                filteredSections,
                undefined,
                "Left",
              );
          }
        } else
          moveFocusToSection(
            activeElementIndex - 1,
            filteredSections,
            undefined,
            "Left",
          );
      }
    },
    right: (forceNavigate: boolean = false) => {
      /**
       * For Kanban
       * Works on tasks and empty sections.
       *
       * For List
       * No need for list view
       */

      if (props.type === "Kanban" || (props.type === "List" && forceNavigate)) {
        const { filteredSections } = props;
        const sectionEls =
          document.getElementById("sectionsContainer")!.children;
        const activeElement = document.activeElement;
        const activeElementIndex = Array.from(sectionEls).indexOf(
          activeElement!,
        );

        const activeElementInSection = focusedCardIndexInColumn(activeElement);
        const activeItem = getActiveItem();

        if (
          activeElementIndex === -1 ||
          activeElementIndex === sectionEls.length - 1
        ) {
          if (activeElement && activeElementIndex === -1) {
            const filter = filteredSections.filter((s) => {
              const _filter = s.items.filter((i) => i.id === activeItem);
              return _filter && _filter.length > 0;
            });
            if (filter && filter.length > 0) {
              const _index = filteredSections.indexOf(filter[0]);
              if (_index !== sectionEls.length - 1)
                moveFocusToSection(
                  _index + 1,
                  filteredSections,
                  forceNavigate ? 0 : activeElementInSection,
                );
            } else moveFocusToSection(0, filteredSections, undefined, "Right");
          } else if (activeElementIndex !== sectionEls.length - 1)
            moveFocusToSection(0, filteredSections, undefined, "Right");
        } else moveFocusToSection(activeElementIndex + 1, filteredSections, 0);
      }
    },
  };

  const shift = {
    up: async (sectionId: number, itemId: number) => {
      await moveTaskVertically(sectionId, itemId, "up");
    },
    down: async (sectionId: number, itemId: number) => {
      await moveTaskVertically(sectionId, itemId, "down");
    },
    left: async (sectionId: number, itemId: number) =>
      await moveTaskHorizontally(sectionId, itemId, "Left"),
    right: async (sectionId: number, itemId: number) =>
      await moveTaskHorizontally(sectionId, itemId, "Right"),
  };

  return { shift, focus, refocus };
}
