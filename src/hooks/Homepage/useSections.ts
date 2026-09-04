/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useMemo, useState } from "react";

import axios from "axios";
import { activeItemAtom, currentProjectAtom } from "@/store";
import { useRecoilState, useSetRecoilState } from "@/lib/state";
import { useStore } from "jotai";

import { ITask } from "@/models/model";
import { useRouter } from "next/navigation";
import useAddDeleteTaskInBoards from "../MultiPages/useAddDeleteTaskInBoards";
import { MOBILE_AI_TASK_WRITER_FOCUS, TDefaultEditFocus, TSectionPayload } from "@/models/CreateTaskModalModels/model";
import useHypertasksRecoilStates from "../RecoilRoot/useHypertasksRecoilStates";
import globalConstants from "@/lib/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import useHypertasksNavigate from "../MultiPages/Route/useHypertasksNavigate";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useFlag } from "@/hooks/useFlag";

type SectionKeydownHandler = (event: KeyboardEvent) => void;

const sectionKeydownHandlers = new Map<string, SectionKeydownHandler>();
let activeSectionListenerKey: string | null = null;
let sectionListenerId = 0;

const handleDelegatedSectionKeydown = (event: KeyboardEvent) => {
  if (!activeSectionListenerKey) return;
  sectionKeydownHandlers.get(activeSectionListenerKey)?.(event);
};

// ============== created this hook to clean the code from the sections.jsx
// ============== remove useEffects from the main component codes as much as possible.
// ============== will contain all the classes and functions needed for a section component so don't have to pollute the main component



const useSections = ({
  items,
  active,
  index,
  title,
  sectionId,
  projectId,
}: {
  items: ITask[];
  projectId: number;
  active: boolean;
  index: number;
  title: string;
  sectionId: number;
}) => {
  const router = useRouter();
  const store = useStore();
  const { createItem } = useAddDeleteTaskInBoards();
  const { toggleCreateTaskGlobally }= useHypertasksRecoilStates()

  const [_currentProject, ____] = useRecoilState(currentProjectAtom);
  const bottomInputRef = useRef<any>(null);
  const topInputRef = useRef<any>(null);
  const sectionRef = useRef<any>(null);

  const lastGPress = useRef<number | null>(null);
  const lastgPress = useRef<number | null>(null);
  const tasksPlayList = useMemo(
    () =>
      items.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        uniqueIndex: task.uniqueIndex,
      })),
    [items]
  );
  // const [active, setActive] = useState(false);
  const setActiveItem = useSetRecoilState(activeItemAtom);
  const [position, setPosition] = useState<"top" | "bottom" | null>(); // top or bottom
  const [showAddItem, setShowAddItem] = useState(false);
  const [keyPressed, setKeypressed] = useState<any>({});
  const isApple = useDeviceContext()
  const isMbl = useContext(MobileViewContext);
  const aiFirstTaskWriterEnabled = useFlag("htpr-6141-ai-first-task-writer");
  const { navigate } = useHypertasksNavigate();
  const sectionListenerKeyRef = useRef<string | null>(null);
  if (!sectionListenerKeyRef.current) {
    sectionListenerId += 1;
    sectionListenerKeyRef.current = `section-keydown-${sectionListenerId}`;
  }

  const handleKeyUp = useCallback((e: any) => {
    setKeypressed((prev: any) => {
      prev[e.key] = false;
      return prev;
    });
  }, []);

  // ======================== create new task at given position
  const createTaskAt = (position: "top"|"bottom", sectionPayload?:TSectionPayload, defaultEditFocus?:TDefaultEditFocus) => {
    // if (position === "top") {
      // setShowAddItem(true);
      // setPosition("top");
      // topInputRef.current?.focus();
      toggleCreateTaskGlobally(
        sectionPayload,
        defaultEditFocus ??
          (isMbl && aiFirstTaskWriterEnabled
            ? MOBILE_AI_TASK_WRITER_FOCUS
            : undefined),
      )
    // }
    //  else {
    //   setShowAddItem(true);
    //   setPosition("bottom");
    //   bottomInputRef.current?.focus();
    // }
  };

  // ======================== user presses [Enter] / [CTRL] to CREATE a task
  const invokeCreateItem = async (taskTitle: any, createAnother: any) => {
    const itemToCreate = {
      title: taskTitle,
      description: "",
      id: -1,
    };
    if (!position) return;
    createItem({
      sectionId: sectionId,
      item: itemToCreate,
      position,
      createAnother,
      projectId,
      section: title,
    });

    if (createAnother) createTaskAt(position);
    else {
      setPosition(null);
      setShowAddItem(false);
      sectionRef.current?.focus();
    }
  };

  const latestRef = useRef({
    active,
    keyPressed,
    isApple,
    index,
    navigate,
    sectionId,
    title,
    _currentProject,
    createTaskAt,
  });
  latestRef.current = {
    active,
    keyPressed,
    isApple,
    index,
    navigate,
    sectionId,
    title,
    _currentProject,
    createTaskAt,
  };

  // ======================= HANDLE KEYDOWN FUNCTION =========================
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const {
      active,
      keyPressed,
      isApple,
      index,
      navigate,
      sectionId,
      title,
      _currentProject,
      createTaskAt,
    } = latestRef.current;

    if (!active) return;
    if (keyPressed[e.key]) return;
    if (returnIfModalOrInputActive()) return

    setKeypressed((prev: any) => {
      prev[e.key] = true;
      return prev;
    });
    if (e.keyCode === KeyCodes.TAB) {
      e.preventDefault();
    }

    // ---- G/G then C handling ----
    if (e.keyCode === KeyCodes.G) {
      const now = Date.now();

      // Track tap for G or Shift+G
      if (e.shiftKey) {
        if (lastGPress.current && now - lastGPress.current < 500) {
          // Double Shift+G
          lastGPress.current = null;

          const tasksList = document.getElementById(`tasks-list-${index}`)?.children;
          if (tasksList && tasksList.length > 1) {
            // Go to bottom/penultimate
            const targetIndex = tasksList.length - 2;
            const element = tasksList[targetIndex] as HTMLElement;
            element?.scrollIntoView({ behavior: "smooth", block: "center" });
            element?.focus();
          }
          e.preventDefault();
        } else {
          lastGPress.current = now;
        }
      } else {
        if (lastgPress.current && now - lastgPress.current < 500) {
          // Double g
          lastgPress.current = null;

          const tasksList = document.getElementById(`tasks-list-${index}`)?.children;
          if (tasksList && tasksList.length > 0) {
            // Go to top
            const element = tasksList[0] as HTMLElement;
            element?.scrollIntoView({ behavior: "smooth", block: "center" });
            element?.focus();
          }
          e.preventDefault();
        } else {
          lastgPress.current = now;
        }
      }
    }
    // G then C: Go to Calendar
    else if (
      e.keyCode === KeyCodes.C &&
      ((lastGPress.current && new Date().getTime() - lastGPress.current < 500)
        || (lastgPress.current && new Date().getTime() - lastgPress.current < 500))
    ) {
      // Reset both G tap trackers
      lastGPress.current = null;
      lastgPress.current = null;
      navigate("Calendar");
      e.preventDefault();
      return;
    }
    // G then D: Go to Drafts
    else if (
      e.keyCode === KeyCodes.D &&
      ((lastGPress.current && new Date().getTime() - lastGPress.current < 500)
        || (lastgPress.current && new Date().getTime() - lastgPress.current < 500))
    ) {
      lastGPress.current = null;
      lastgPress.current = null;
      navigate("Drafts");
      e.preventDefault();
      return;
    }
    // G then U: Go to Scheduled
    else if (
      e.keyCode === KeyCodes.U &&
      ((lastGPress.current && new Date().getTime() - lastGPress.current < 500)
        || (lastgPress.current && new Date().getTime() - lastgPress.current < 500))
    ) {
      lastGPress.current = null;
      lastgPress.current = null;
      navigate("Scheduled");
      e.preventDefault();
      return;
    }
    // [ctrl][shift][c] for creating task at top
    else if (
      e.keyCode === KeyCodes.C &&
      document?.activeElement?.tagName !== "INPUT" &&
      e.shiftKey && (e.ctrlKey || e.metaKey)
    ) {
      e.preventDefault();
      createTaskAt("top", {
        sectionId: sectionId,
        sectionTitle: title,
        priority: _currentProject?.sorting_mode === "Priority"
          ? globalConstants.PriorityConstants[1]
          : undefined,
        position: "top"
      });
      setKeypressed((prev: any) => {
        prev[e.key] = false;
        return prev;
      });
    }
    // [c] for creating task (only if not using G shortcut, matches expected Kanban behavior too)
    else if (
      e.keyCode === KeyCodes.C &&
      document?.activeElement?.tagName !== "INPUT" &&
      !(e.shiftKey || e.ctrlKey || e.metaKey) &&
      !lastgPress.current && !lastGPress.current
    ) {
      e.preventDefault();
      createTaskAt("top", {
        sectionId: sectionId,
        sectionTitle: title,
        position: "top"
      });
      setKeypressed((prev: any) => {
        prev[e.key] = false;
        return prev;
      });
    }

    // cmd/ctrl + [j]: same new task as [C], but opened straight into the AI Task
    // Writer. HTPR-4903: this branch existed but was commented out, so the key
    // did nothing on the board while the tutorial and the create-task modal both
    // teach Ctrl+J as the AI writer key. preventDefault also stops Chrome/Edge
    // from opening their Downloads panel on top of the modal.
    else if (
      e.keyCode === KeyCodes.J &&
      document?.activeElement?.tagName !== "INPUT" &&
      ((isApple && e.metaKey) || (!isApple && e.ctrlKey)) &&
      !e.shiftKey
    ) {
      e.preventDefault();
      createTaskAt(
        "top",
        {
          sectionId: sectionId,
          sectionTitle: title,
          position: "top",
        },
        {
          defaultEditMode: "Description-ai",
          defaultFocus: "Description",
        }
      );
      setKeypressed((prev: any) => {
        prev[e.key] = false;
        return prev;
      });
    }


    // [shift] + [c] for creating task at bottom
    else if (
      e.keyCode === KeyCodes.C &&
      e.shiftKey && !(e.ctrlKey || e.metaKey)&&
      document?.activeElement?.tagName !== "INPUT" && lastgPress.current === null
    ) {
      e.preventDefault();
      createTaskAt("bottom",  {
        sectionId:sectionId, 
        sectionTitle:title,
        position:"bottom"
      });
      setKeypressed((prev: any) => {
        prev[e.key] = false;
        return prev;
      });
    }

    if (document.activeElement?.tagName === "INPUT") return;

  }, []);






  // ==================== check for duplicate rankins and return true/false
  function hasDuplicateRankings(items: ITask[]) {
    const rankingMap = new Map();

    for (const task of items) {
      const ranking = task.ranking;
      if (rankingMap.has(ranking)) {
        return true; // Found a duplicate ranking
      }

      rankingMap.set(ranking, true);
    }

    return false; // No duplicate rankings found
  }


  // =================== user presses escape or blurs out
  const onCancelCreate = () => {
    setShowAddItem(false);
    setPosition(null);
    console.log(position);
    document
      .getElementById(
        `task-${items[position == "top" ? 0 : items?.length - 1]?.id}`
      )
      ?.focus();
    setActiveItem(items[items?.length - 1]?.id);
  };



  // ========================= thinking if we should move this away to another hook as well, but dont need it
  // ========================= possibly over-optimization, keeping it simple till the need to scale up comes.
  useLayoutEffect(() => {
    document.getElementById("task-" + store.get(activeItemAtom))?.scrollIntoView({
      behavior: "instant" as ScrollBehavior,
      block: "center",
      inline: "center",
    });
  // since we only run it on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, []); // Empty dependency array to ensure the effect runs only once after component mount

  useEffect(() => {
    setTimeout(() => {
      if (hasDuplicateRankings(items) && items.length > 0) {
        console.log("There are duplicate rankings in the tasks.");
        handleReset();
      } 
    }, 0);

  
  // since we only run it on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  
  useEffect(() => {
    if (showAddItem && position === "bottom") {
      bottomInputRef.current?.focus();
    }
    if (showAddItem && position === "top") {
      topInputRef.current?.focus();
    }
  }, [showAddItem, position]);

  const handleReset = async () => {
    const response = await axios.post("/api/section/resetRanks", {
      taskIds: items.map((item) => item.id),
    });
    if (response.status === 200) {
      router.refresh();
    }
  };

  useEffect(() => {
    const sectionListenerKey = sectionListenerKeyRef.current;
    if (!sectionListenerKey) return;

    sectionKeydownHandlers.set(sectionListenerKey, handleKeyDown);
    if (sectionKeydownHandlers.size === 1) {
      document.addEventListener("keydown", handleDelegatedSectionKeydown);
    }

    return () => {
      sectionKeydownHandlers.delete(sectionListenerKey);
      if (activeSectionListenerKey === sectionListenerKey) {
        activeSectionListenerKey = null;
      }
      if (sectionKeydownHandlers.size === 0) {
        document.removeEventListener("keydown", handleDelegatedSectionKeydown);
      }
    };
  }, [handleKeyDown]);

  useEffect(() => {
    const sectionListenerKey = sectionListenerKeyRef.current;
    if (!sectionListenerKey) return;

    if (active) {
      activeSectionListenerKey = sectionListenerKey;
    } else if (activeSectionListenerKey === sectionListenerKey) {
      activeSectionListenerKey = null;
    }

    return () => {
      if (activeSectionListenerKey === sectionListenerKey) {
        activeSectionListenerKey = null;
      }
    };
  }, [active]);

  useEffect(() => {
    const sectionElement = sectionRef.current;
    sectionElement?.addEventListener("keyup", handleKeyUp);

    return () => {
      sectionElement?.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyUp]);

  return {
    sectionRef,
    createTaskAt,
    handleKeyDown,
    tasksPlayList,
    showAddItem,
    onCancelCreate,
    invokeCreateItem,
    position,
    topInputRef,
    bottomInputRef,
  };
};

export default useSections;
