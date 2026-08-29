import { ITask } from "@/models/model";
import { ModalBody, ModalHeader } from "reactstrap";
import { Calendar, Plus } from "lucide-react";
import {
  ModalContainerCustom,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import { formatDate } from "date-fns";
import Tooltip from "@/components/Common/Tooltip";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { useEffect } from "react";

const prefixId = "label-calendar-manage-task-";

interface IProps {
  tasks: ITask[];
  date: Date;
  toggle: (
    date: Date,
    close?: boolean,
    mode?: "Add" | "Update" | "Visit",
    task?: ITask
  ) => void;
}

const CalendarManageTasksModal = ({ tasks, date, toggle }: IProps) => {
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  async function enterHandler(index: number) {
    toggle(date, undefined, "Visit", tasks[index]);
  }

  useEffect(() => {
    const keydown = (e: any) =>
      handleKeydown(e, tasks?.length ? tasks?.length : 0, prefixId, () =>
        toggle(date, true)
      );
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [tasks?.length, handleKeydown]);

  return (
    <ModalContainerCustom
      fade={false}
      toggle={() => toggle(date, true)}
      show={true}
      isOpen={true}
      id="manage-tasks-on-calendar-modal"
      className="text-white-black rounded-sm p-0 absolute sm:top-0 md:top-[20%] right-0 left-0 max-h-[400px] md:min-w-[640px] sm:min-w-full"
    >
      <ModalHeader className="rounded-none border-b-0 h-[60px] pt-[20px] pl-[24px] text-subheading font-bold [&>*:first-child]:w-full">
        <div className="flex gap-3 justify-between items-center">
          <span>Tasks due on {formatDate(date, "MMM d, yyyy")}</span>
          <div className="flex gap-3 items-center">
            <div className="relative group">
              <Plus size={16} strokeWidth={1.75}
                onClick={() => toggle(date, undefined, "Add")}
                className="text-white-black cursor-pointer"
              />
              <Tooltip
                bottom={-10}
                left={-100}
                text="Add task"
                keyCombination={[]}
              />
            </div>
          </div>
        </div>
      </ModalHeader>
      <ModalBody className="max-h-[340px] overflow-y-scroll p-0">
        <ModalListContainer
          id="manage-tasks-on-calendar-modal-list-container"
          className="max-h-[230px]"
        >
          {tasks.length > 0 &&
            tasks?.map((item: ITask, index: number) => (
              <ModalRowElementContainer
                key={`el-${index}`}
                onMouseEnter={() => handleMouseEnter(index)}
                handleMouseLeave={handleMouseLeave}
                onClick={() => enterHandler(index)}
                id={`${prefixId}${index}`}
                index={index}
                isSelected={selectedIndex === index}
                className="cursor-default"
              >
                <div className="w-full flex justify-between items-center gap-2">
                  <span className="font-normal text-text-light-gray truncate block w-full">
                    {item.ticketNumber}&nbsp;
                    <span className="text-white-black font-medium">
                      {item.title}
                    </span>
                  </span>
                  <div className="relative group">
                    <Calendar size={16} strokeWidth={1.75}
                      className="text-white-black cursor-pointer"
                      onClick={() => toggle(date, undefined, "Update", item)}
                    />
                    <Tooltip
                      bottom={-10}
                      left={-80}
                      text="Update"
                      keyCombination={[]}
                    />
                  </div>
                </div>
              </ModalRowElementContainer>
            ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default CalendarManageTasksModal;
