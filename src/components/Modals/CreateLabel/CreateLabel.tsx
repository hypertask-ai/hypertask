import { useGetAllProjectLabels } from "@/hooks/MultiPages/useGetAllProjectLabels";
import { ICurrentInViewObject, inViewObjectAtom } from "@/store";
import { ChangeEvent, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { ModalBody } from "reactstrap";
import { useRecoilState } from "@/lib/state";
import styles from "@/styles/linksModal.module.scss";
import { ILabel, IProject, ITaskLabel } from "@/models/model";
import { Check, Settings, Sparkles } from "lucide-react";
import axios from "axios";
import { deepCopy } from "@/utils/helperFunctions/helperFunctions";
import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import TaskLabelComponent from "./TaskLabelComponent";
import axiosClient from "@/utils/axiosClient";
import { KeyCodes } from "@/lib/constants/keyboard-handler";

type TMode = "Task" | "CreateTaskGlobally";

type Props = {
  closeHandler?: (
    taskLabels?: ITaskLabel[],
    refresh?: boolean,
    shouldCloseOnUpdate?: boolean
  ) => void;
  mode?: TMode;
  previouslyAddedFilters?: ILabel[];
  closeHandlerForCreateNewTask?: (param?: ILabel) => void;
  currentProject?: IProject;
  onManageTags?: () => void;
  taskIds?: number[];
  onBulkLabel?: (label: ILabel) => Promise<void>;
};

const sortLabels = (
  labelsFromTQ: any[],
  inViewObject: ICurrentInViewObject,
  previouslyAddedFilters?: ILabel[]
) => {
  // =========== meaning its a create task from modal
  if (previouslyAddedFilters) {
    const flatmapped = previouslyAddedFilters.flatMap((x) => x.id) || [];

    const updatedLabels = labelsFromTQ
      ?.map((item: ILabel) => {
        const hasMatchingTask = flatmapped.includes(item.id);
        item.check = hasMatchingTask;
        return item;
      })
      .sort((a, b) => {
        // Move checked items to the top
        return (b.check ? 1 : 0) - (a.check ? 1 : 0);
      });

    return updatedLabels;
  } else {
    const updatedLabels = labelsFromTQ?.map((item) => {
      const hasMatchingTask = item.task.some(
        (task: { taskId: any }) => task.taskId === inViewObject.taskId
      );
      if (hasMatchingTask) {
        item.check = true;
      }
      return item;
    });

    updatedLabels.sort(
      (
        a: {
          task: { id: number; taskId: number }[];
          check?: boolean;
          _count: { task: number };
        },
        b: {
          task: { id: number; taskId: number }[];
          check?: boolean;
          _count: { task: number };
        }
      ) => {
        // 1. Checked items first
        if (a.check && !b.check) return -1;
        if (!a.check && b.check) return 1;

        // 2. Then by most recent usage (highest TaskLabel ID)
        const aLastUsedId = a.task[0]?.id || 0;
        const bLastUsedId = b.task[0]?.id || 0;
        if (bLastUsedId !== aLastUsedId) {
          return bLastUsedId - aLastUsedId; // Most recent first
        }

        // 3. Finally by frequency (most used first)
        const aCount = a._count.task;
        const bCount = b._count.task;
        return bCount - aCount; // Higher count first
      }
    );

    return updatedLabels;
  }
};

const CreateLabel: React.FC<Props> = ({
  closeHandler,
  mode = "Task",
  previouslyAddedFilters,
  closeHandlerForCreateNewTask,
  currentProject,
  onManageTags,
  taskIds,
  onBulkLabel,
}) => {
  const [label, setLabel] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);
  const [inViewObject, __] = useRecoilState(inViewObjectAtom);
  const {
    data: labelsFromTQ,
    isRefetching,
    refetch,
  } = useGetAllProjectLabels(
    mode === "CreateTaskGlobally"
      ? currentProject?.id
      : inViewObject.taskProjectId
  );

  // Add loading state and optimistic updates state
  const [isLoading, setIsLoading] = useState(false);
  const [optimisticLabels, setOptimisticLabels] = useState<ILabel[]>([]);

  // Memoize sorted labels to prevent infinite re-renders
  const sortedLabels: ILabel[] = useMemo(() => {
    if (!labelsFromTQ) return [];
    return sortLabels(
      deepCopy(labelsFromTQ),
      inViewObject,
      previouslyAddedFilters
    );
  }, [labelsFromTQ, inViewObject, previouslyAddedFilters]);

  // Use optimistic labels if available, otherwise use sorted labels
  const currentLabels =
    optimisticLabels.length > 0 ? optimisticLabels : sortedLabels;

  const [modal, ___] = useState<boolean>(true);
  const [keyboardControls, enableKeyboardControls] = useState<boolean>(false);
  const [filteredLabels, setFilteredLabels] = useState<ILabel[]>([]);
  const [selectedLabelIndex, setSelectedLabelIndex] = useState<number>(0);

  const shouldShowCreateOption =
    label.length > 0 &&
    !filteredLabels.some((l) => l.value.toLowerCase() === label.toLowerCase());
  const totalItems = filteredLabels.length + (shouldShowCreateOption ? 1 : 0);
  const isCreateOptionSelected =
    shouldShowCreateOption && selectedLabelIndex === filteredLabels.length;

  const handleToggle = useCallback(
    (payload?: any, forceClose = false) => {
      if (isLoading && !forceClose) return; // Prevent closing while loading
      refetch();
      if (mode === "Task" && closeHandler) {
        payload ? closeHandler(payload, true) : closeHandler();
      } else if (
        mode === "CreateTaskGlobally" &&
        closeHandlerForCreateNewTask
      ) {
        payload
          ? closeHandlerForCreateNewTask(payload)
          : closeHandlerForCreateNewTask();
      }
    },
    [closeHandler, closeHandlerForCreateNewTask, mode, isLoading]
  );

  // -------------------- ON MODAL LOAD, for focus
  const onOpenHandler = async () => {
    enableKeyboardControls(true); // force focus on input field
  };

  // =================== setting input
  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLabel(e.target.value);
  };

  // =================== Optimistically update labels state
  const updateLabelOptimistically = useCallback(
    (labelToToggle: ILabel, newCheckState: boolean) => {
      const updatedLabels = currentLabels.map((labelItem) =>
        labelItem.id === labelToToggle.id
          ? { ...labelItem, check: newCheckState }
          : labelItem
      );

      // Keep the same sort order to prevent jumping
      setOptimisticLabels(updatedLabels);
    },
    [currentLabels]
  );

  // =================== Revert optimistic update
  const revertOptimisticUpdate = useCallback(() => {
    setOptimisticLabels([]); // Clear optimistic state, fall back to server data
  }, []);

  // =================== toggle label assignment with optimistic updates
  const toggleLabelAssignment = useCallback(
    async (labelToToggle: ILabel) => {
      if (isLoading) return; // Prevent multiple submissions

      setIsLoading(true);

      try {
        if (mode === "CreateTaskGlobally") {
          handleToggle(labelToToggle);
          return;
        }

        if (taskIds?.length && onBulkLabel) {
          await onBulkLabel(labelToToggle);
          handleToggle(undefined, true);
          setLabel("");
          return;
        }

        // Optimistically update the UI immediately
        const newCheckState = !labelToToggle.check;
        updateLabelOptimistically(labelToToggle, newCheckState);

        // Make the API call
        const response = await axiosClient.post("/labels/assignLabel", {
          taskId: inViewObject.taskId,
          labelId: labelToToggle.id,
        });

        closeHandler?.(response.data, true, false);
        setLabel("");

        // On success, clear optimistic state and refetch in background
        // This will sync with server data but won't affect UI since it's already correct
        // setOptimisticLabels([]);
        // refetch(); // Background sync, won't affect current UI
      } catch (error) {
        console.error("Error toggling label assignment:", error);
        // On error, revert the optimistic update
        revertOptimisticUpdate();
      } finally {
        setIsLoading(false);
      }
    },
    [
      mode,
      handleToggle,
      inViewObject.taskId,
      updateLabelOptimistically,
      revertOptimisticUpdate,
      refetch,
      isLoading,
      onBulkLabel,
      taskIds,
    ]
  );

  // =================== create new label
  const createNewLabel = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);

    try {
      const isBulk = Boolean(taskIds?.length && onBulkLabel);
      const response = await axios.post("/api/labels/createLabel", {
        taskId: isBulk ? undefined : inViewObject.taskId,
        projectId:
          mode === "CreateTaskGlobally" || isBulk
            ? currentProject?.id ?? inViewObject.taskProjectId
            : inViewObject.taskProjectId,
        value: label,
        CreateLabelAndReturn: mode === "CreateTaskGlobally" || isBulk,
      });

      if (response?.status === 200 || response?.status === 204) {
        if (isBulk && onBulkLabel) {
          await onBulkLabel(response.data as ILabel);
          handleToggle(undefined, true);
        } else {
          handleToggle(response.data);
        }
      }
    } catch (error) {
      console.error("Error creating label:", error);
    } finally {
      setIsLoading(false);
    }
  }, [
    isLoading,
    inViewObject.taskId,
    inViewObject.taskProjectId,
    label,
    mode,
    currentProject,
    handleToggle,
    onBulkLabel,
    taskIds,
  ]);

  // =================== handle selection action
  const handleSelectionAction = useCallback(async () => {
    if (isLoading) return;

    if (isCreateOptionSelected) {
      // Create new label
      await createNewLabel();
    } else if (selectedLabelIndex < filteredLabels.length) {
      // Toggle existing label
      await toggleLabelAssignment(filteredLabels[selectedLabelIndex]);
    }
  }, [
    isLoading,
    isCreateOptionSelected,
    selectedLabelIndex,
    filteredLabels,
    createNewLabel,
    toggleLabelAssignment,
  ]);

  // Filter labels based on search term - memoized to prevent infinite re-renders
  const computedFilteredLabels = useMemo(() => {
    if (label.length === 0) return currentLabels;

    return currentLabels
      .map((label_: ILabel) => ({
        ...label_,
        priority: label_.check ? 1 : 0,
      }))
      .sort((a, b) => b.priority - a.priority)
      .filter((label_: ILabel) =>
        label_.value.toLowerCase().includes(label.toLowerCase())
      );
  }, [label, currentLabels]);

  // Update filtered labels
  useEffect(() => {
    setFilteredLabels(computedFilteredLabels);
    
    // Only reset selection index if the current selection is out of bounds
    // This preserves selection when labels are updated optimistically
    if (selectedLabelIndex >= computedFilteredLabels.length) {
      setSelectedLabelIndex(Math.max(0, computedFilteredLabels.length - 1));
    }
  }, [computedFilteredLabels, selectedLabelIndex]);

  // Reset selection when search term changes (user is typing)
  useEffect(() => {
    setSelectedLabelIndex(0);
  }, [label]);

  // Initialize optimistic state when server data loads
  useEffect(() => {
    if (sortedLabels.length > 0 && optimisticLabels.length === 0) {
      // Don't set optimistic labels here, let it stay empty so currentLabels uses sortedLabels
    }
  }, [sortedLabels, optimisticLabels.length]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.keyCode === KeyCodes.ARROW_DOWN) {
        e.preventDefault();
        setSelectedLabelIndex((prevIndex) => {
          const newIndex =
            prevIndex < totalItems - 1 ? prevIndex + 1 : totalItems - 1;
          // Scroll into view on next tick
          setTimeout(() => {
            document.getElementById(`label_${newIndex}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 0);
          return newIndex;
        });
      }

      if (e.keyCode === KeyCodes.ARROW_UP) {
        e.preventDefault();
        setSelectedLabelIndex((prevIndex) => {
          const newIndex = prevIndex > 0 ? prevIndex - 1 : 0;
          // Scroll into view on next tick
          setTimeout(() => {
            document.getElementById(`label_${newIndex}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 0);
          return newIndex;
        });
      }
      if (isLoading) return; // Prevent keyboard actions while loading
      if (e.keyCode === KeyCodes.ENTER) {
        e.preventDefault();
        handleSelectionAction();
      }

      if (e.keyCode === KeyCodes.ESCAPE) {
        e.preventDefault();
        handleToggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    totalItems,
    handleSelectionAction,
    handleToggle,
    isLoading,
    setSelectedLabelIndex,
  ]);

  // =========================================================== FRONTEND COMPONENT ==================================
  return (
    <ModalContainerCustom
      id="create-label-modal"
      fade={false}
      show={true}
      isOpen={true}
      onOpened={onOpenHandler}
      toggle={() => handleToggle()}
      className={`paletteModalSizing ${styles.links_modal}`}
    >
      <ModalHeaderComp
        header={mode === "Task" ? "Create Tag" : "Add tags to this task"}
      >
        {onManageTags && (
          <div
            onClick={onManageTags}
            className="text-content whitespace-nowrap flex cursor-pointer items-center gap-2"
          >
            <span>Manage Tags</span>
            <Settings strokeWidth={1.75} size={14} />
          </div>
        )}
      </ModalHeaderComp>

      <ModalBody className=" p-0 rounded-b-[4px]  ">
        <div className=" p-0 rounded-[4px] ">
          <ModalInput
            ref={labelInputRef}
            onChange={onKeyChange}
            value={label}
            placeholder="Enter tag name"
            // disabled={isLoading}
          />
        </div>
        <ModalListContainer id="labels-list">
          {filteredLabels.map((labelItem, index: number) => (
            <ModalRowElementContainer
              id={`label_${index}`}
              key={labelItem.id}
              onMouseEnter={() => !isLoading && setSelectedLabelIndex(index)}
              onClick={() => !isLoading && toggleLabelAssignment(labelItem)}
              isSelected={selectedLabelIndex === index}
            >
              <div className="flex-grow flex gap-2 items-center">
                <TaskLabelComponent labelValue={labelItem.value} />
                {labelItem.ai_prompt ? (
                  <Sparkles
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-hypertasks-ai-purple"
                    aria-label="Smart label"
                  />
                ) : null}
              </div>
              {labelItem.check ? <Check size={16} strokeWidth={1.75} /> : null}
            </ModalRowElementContainer>
          ))}

          {shouldShowCreateOption && (
            <ModalRowElementContainer
              id={`label_${filteredLabels.length}`}
              onMouseEnter={() =>
                !isLoading && setSelectedLabelIndex(filteredLabels.length)
              }
              onClick={() => !isLoading && createNewLabel()}
              isSelected={isCreateOptionSelected}
            >
              <span>Create tag &quot;{label}&quot;</span>
            </ModalRowElementContainer>
          )}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default CreateLabel;
