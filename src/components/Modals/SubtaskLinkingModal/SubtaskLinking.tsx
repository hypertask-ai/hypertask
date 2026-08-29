import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import useDebounce from "@/hooks/General/useDebounce";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import globalConstants from "@/lib/constants";
import { ITask } from "@/models/model";
import React, { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ModalBody } from "reactstrap";
const prefixId = "label-htc-option-";
interface ISubtaskLinking {
  closeHandler: (refresh?: boolean, task?: ITask) => void;
  taskInfo: {
    id: number;
    projectId: number;
    section: string;
    sectionId: number;
    title: string;
    ticketNumber: string | undefined;
  };
  callbackHandler?: (task: ITask) => void;
}

const SubtaskLinkingModal: React.FC<ISubtaskLinking> = ({
  closeHandler,
  taskInfo,
  callbackHandler,
}) => {
  const { id, section, sectionId, title, ticketNumber, projectId } = taskInfo;
  const [keyword, setKeyword] = useState<string>("");
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });
  const [filteredOptions, setFilteredOptions] = useState<ITask[]>([]);
  const [defaultTasks, setDefaultTasks] = useState<ITask[]>([]);

  async function enterHandler(index: number) {
    if (filteredOptions.length === 0) return toggleCreateSubTask();
    else {
      toast.promise(
        fetch(globalConstants.addParentTaskRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orphanId: filteredOptions[index].id,
            parentId: id,
            searchQuery: keyword.length > 0 ? keyword : undefined,
          }),
        }),
        {
          loading: "Adding sub-task",
          success: () => {
            closeHandler(true, filteredOptions[index]);
            if (callbackHandler) callbackHandler(filteredOptions[index]);
            return `Sub-task has been added`;
          },
          error: (error) => {
            console.log("🚀 ~ toast.promise ~ error:", error);
            closeHandler();
            return "Error adding sub-task";
          },
        }
      );
    }
  }

  const debounceSearch = useDebounce(() => {
    fetchTasksHandler();
  }, 150);

  const handleChange = useCallback(
    (e: any) => {
      setKeyword(e.target.value);
      if (e.target.value.length === 0) {
        setFilteredOptions(defaultTasks);
      }
      debounceSearch();
      setSelectedIndex(0);
      document
        .getElementById(`${prefixId}${0}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [defaultTasks]
  );

  const fetchTasksHandler = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        projectId: projectId.toString(),
        currentTaskId: id.toString(),
        ...(keyword.length > 0 && { searchQuery: keyword }),
      });

      const response = await fetch(
        `${globalConstants.getOrphanTasksRoute}?${params.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (response.ok) {
        const result: any = await response.json();
        console.log("🚀 ~ onOpenHandler ~ result:", result.json);
        setFilteredOptions(result.json);
        if (defaultTasks.length === 0) setDefaultTasks(result.json);
      }
    } catch (error) {
      console.log("🚀 ~ onOpenHandler ~ error:", error);
    }
  }, [id, projectId, keyword]);

  const toggleCreateSubTask = () => {
    if (!sectionId || !section) return;
    closeHandler();
    toggleCreateTaskGlobally({
      sectionId: sectionId,
      sectionTitle: section,
      position: "top",
      parentTask: {
        title: title,
        id: id,
        ticketNumber: ticketNumber,
      },
      prefilledTitle: keyword.length > 0 ? keyword : undefined,
    });
  };

  useEffect(() => {
    const keydown = (e: any) =>
      handleKeydown(
        e,
        filteredOptions?.length ? filteredOptions?.length : 0,
        prefixId,
        closeHandler
      );
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [filteredOptions?.length, handleKeydown]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      onOpened={fetchTasksHandler}
      id="subtask-linking-modal"
      toggle={() => closeHandler()}
      shouldCloseOnClickOutside={true}
      className="font-bold"
    >
      <ModalHeaderComp
        header={"Link existing or create a new subtask"}
        className="px-[20px]"
      />
      <ModalBody className="p-0">
        <ModalInput
          onChange={handleChange}
          value={keyword}
          placeholder="Search for a task"
          autofocus={true}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="subtask-linking-modal-list-container"
          className="max-h-[230px]"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions?.map((item: ITask, index: number) => (
              <ModalRowElementContainer
                key={`el-${index}`}
                onMouseEnter={() => handleMouseEnter(index)}
                handleMouseLeave={handleMouseLeave}
                onClick={() => enterHandler(index)}
                id={`${prefixId}${index}`}
                index={index}
                commandRef={elRef}
                isSelected={selectedIndex === index}
              >
                <TaskRow task={item} />
              </ModalRowElementContainer>
            ))
          ) : (
            <ModalRowElementContainer
              key={`el-${0}`}
              onMouseEnter={() => handleMouseEnter(0)}
              handleMouseLeave={handleMouseLeave}
              onClick={() => enterHandler(0)}
              id={`${prefixId}${0}`}
              index={0}
              commandRef={elRef}
              isSelected={selectedIndex === 0}
            >
              <span>Create sub-task &quot;{keyword}&quot;</span>
            </ModalRowElementContainer>
          )}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

const TaskRow = ({ task }: { task: ITask }) => {
  return (
    <div className="space-x-1 w-full inline-block items-start justify-normal">
      <span className="font-normal text-text-light-gray w-full line-clamp-2">
        {task.ticketNumber}&nbsp;
        <span className="text-white-black font-medium">{task.title}</span>
      </span>
    </div>
  );
};
export default SubtaskLinkingModal;
