import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import { useRemoveParentTask } from "@/hooks/MultiPages/Tasks";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { ITask } from "@/models/model";
import React, { useCallback, useEffect, useState } from "react";
import { ModalBody } from "reactstrap";
const prefixId = "label-htc-option-";
interface IRemoveSubtaskModal {
  closeHandler: (refresh?: boolean, task?: ITask) => void;
  taskInfo: {
    subTasks: ITask[];
  };
  callbackHandler?: (task: ITask) => void;
}

const RemoveSubtaskModal: React.FC<IRemoveSubtaskModal> = ({
  closeHandler,
  taskInfo,
  callbackHandler,
}) => {
  const { subTasks } = taskInfo;
  const [keyword, setKeyword] = useState<string>("");
  const { removeParentTask } = useRemoveParentTask();
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });
  const [filteredOptions, setFilteredOptions] = useState<ITask[]>(subTasks);

  async function enterHandler(index: number) {
    removeParentTask(
      {taskId:filteredOptions[index].id},
      {
        loadingMessage: "Removing sub-task",
        successMessage: "Sub-task has been removed",
        errorMessage: "Error removing sub-task",
        onSuccess: () => {
          closeHandler(true, filteredOptions[index]);
          if (callbackHandler) callbackHandler(filteredOptions[index]);
        },
        onError:()=>closeHandler()
      }
    )
  }

  const handleChange = useCallback(
    (e: any) => {
      setKeyword(e.target.value);
      if (e.target.value.length === 0) {
        setFilteredOptions(subTasks);
      } else {
        const filtered = filteredOptions.filter((option) =>
          option.title.toLowerCase().includes(keyword.toLowerCase())
        );
        setFilteredOptions(filtered);
      }
      setSelectedIndex(0);
      document
        .getElementById(`${prefixId}${0}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [subTasks]
  );

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
      id="remove-subtask-modal"
      toggle={() => closeHandler()}
      shouldCloseOnClickOutside={true}
      className="font-bold"
    >
      <ModalHeaderComp header={"Remove a sub-task"} className="px-[20px]" />
      <ModalBody className="p-0">
        <ModalInput
          onChange={handleChange}
          value={keyword}
          placeholder="Search for a task"
          autofocus={true}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="remove-subtask-modal-list-container"
          className="max-h-[230px]"
        >
          {filteredOptions?.map((item: ITask, index: number) => (
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
          ))}
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
export default RemoveSubtaskModal;
