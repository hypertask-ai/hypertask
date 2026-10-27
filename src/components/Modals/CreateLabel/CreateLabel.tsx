import { assignTaskLabel } from "@/lib/api/typedClient";
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
  if (previouslyAddedFilters) {
    const flatmapped = previouslyAddedFilters.flatMap((x) => x.id) || [];

    const updatedLabels = labelsFromTQ
      ?.map((item: ILabel) => {
        const hasMatchingTask = flatmapped.includes(item.id);
        item.check = hasMatchingTask;
        return item;
      })
      .sort((a, b) => {
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
        if (a.check && !b.check) return -1;
        if (!a.check && b.check) return 1;

        const aLastUsedId = a.task[0]?.id || 0;
        const bLastUsedId = b.task[0]?.id || 0;
        if (bLastUsedId !== aLastUsedId) {
          return bLastUsedId - aLastUsedId;
        }

        const aCount = a._count.task;
        const bCount = b._count.task;
        return bCount - aCount;
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
    taskIds?.length || mode === "CreateTaskGlobally"
      ? currentProject?.id
      : inViewObject.taskProjectId
  );

  const [isLoading, setIsLoading] = useState(false);
  const [optimisticLabels, setOptimisticLabels] = useState<ILabel[]>([]);

  const sortedLabels: ILabel[] = useMemo(() => {
    if (!labelsFromTQ) return [];
    return sortLabels(
      deepCopy(labelsFromTQ),
      inViewObject,
      previouslyAddedFilters
    );
  }, [labelsFromTQ, inViewObject, previouslyAddedFilters]);

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
      if (isLoading && !forceClose) return;
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

  const onOpenHandler = async () => {
    enableKeyboardControls(true);
  };

  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLabel(e.target.value);
  };

  const updateLabelOptimistically = useCallback(
    (labelToToggle: ILabel, newCheckState: boolean) => {
      const updatedLabels = currentLabels.map((labelItem) =>
        labelItem.id === labelToToggle.id
          ? { ...labelItem, check: newCheckState }
          : labelItem
      );

      setOptimisticLabels(updatedLabels);
    },
    [currentLabels]
  );

  const revertOptimisticUpdate = useCallback(() => {
    setOptimisticLabels([]);
  }, []);

  const toggleLabelAssignment = useCallback(
    async (labelToToggle: ILabel) => {
      if (isLoading) return;

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

        const newCheckState = !labelToToggle.check;
        updateLabelOptimistically(labelToToggle, newCheckState);

        const response = await assignTaskLabel({ taskId: inViewObject.taskId!, labelId: labelToToggle.id });

        closeHandler?.(response.data, true, false);
        setLabel("");
      } catch (error) {
        console.error("Error toggling label assignment:", error);
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

  const handleSelectionAction = useCallback(async () => {
    if (isLoading) return;

    if (isCreateOptionSelected) {
      await createNewLabel();
    } else if (selectedLabelIndex < filteredLabels.length) {
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

  useEffect(() => {
    setFilteredLabels(computedFilteredLabels);
    
    if (selectedLabelIndex >= computedFilteredLabels.length) {
      setSelectedLabelIndex(Math.max(0, computedFilteredLabels.length - 1));
    }
  }, [computedFilteredLabels, selectedLabelIndex]);

  useEffect(() => {
    setSelectedLabelIndex(0);
  }, [label]);

  useEffect(() => {
    if (sortedLabels.length > 0 && optimisticLabels.length === 0) {
    }
  }, [sortedLabels, optimisticLabels.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.keyCode === KeyCodes.ARROW_DOWN) {
        e.preventDefault();
        setSelectedLabelIndex((prevIndex) => {
          const newIndex =
            prevIndex < totalItems - 1 ? prevIndex + 1 : totalItems - 1;
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
          setTimeout(() => {
            document.getElementById(`label_${newIndex}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 0);
          return newIndex;
        });
      }
      if (isLoading) return;
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
