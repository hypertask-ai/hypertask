import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useDebounce from "@/hooks/General/useDebounce";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { ITask } from "@/models/model";
import React, { useCallback, useEffect, useState } from "react";
import { ModalBody } from "reactstrap";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import DueDateModal from "../DueDate";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useRecoilValue } from "@/lib/state";
import { inViewObjectAtom } from "@/store";
import { isBefore, isToday } from "date-fns";
import useGetTimeOptions from "@/hooks/General/useGetTimeOptions";

interface IProps {
  callbackHandler: (
    mode?: "Create" | "Update",
    payload?: {
      task?: ITask;
      date: Date | undefined;
    }
  ) => void;
  mode: "Create" | "Update";
  currentDay: Date;
  selectedTask?: ITask;
}

//The entire flow is heavily dependent on the mode
const CalendarDueDateModal: React.FC<IProps> = ({
  callbackHandler,
  mode,
  currentDay,
  selectedTask: selectedTaskProp,
}) => {
  const [keyword, setKeyword] = useState<string>("");
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });
  const [filteredOptions, setFilteredOptions] = useState<ITask[]>([]);
  const [defaultTasks, setDefaultTasks] = useState<ITask[]>([]);
  const [currentMode, setCurrentMode] = useState<"Create" | "Update">(mode);
  const [selectedTask, setSelectedTask] = useState<ITask | undefined>(
    selectedTaskProp ?? undefined
  );
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const { updateActiveItemAndItemInView } = useProjectQuery();
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { getDefaultOptions } = useGetTimeOptions();

  async function enterHandler(index: number) {
    if (mode === "Update") return;
    if (filteredOptions.length === 0) return toggleCreateTaskHandler();
    else {
      setSelectedTask(filteredOptions[index]);
      updateActiveItemAndItemInView(filteredOptions[index]);
      setCurrentMode("Update");
    }
  }

  const toggleCreateTaskHandler = () => {
    if (!inViewObject.sectionId || !inViewObject.sectionTitle) return;
    //Man I'm stuck at the Radiance boss fight in Hollow Knight.
    let finalDueDate: Date | undefined = undefined;
    if (isToday(currentDay) || isBefore(currentDay, new Date())) {
      const nextBestOption = getDefaultOptions()[0];
      finalDueDate = new Date(nextBestOption.date);
    } else {
      finalDueDate = new Date(currentDay);
      finalDueDate.setHours(21, 0, 0, 0);
    }

    toggleCreateTaskGlobally({
      sectionId: inViewObject.sectionId!,
      sectionTitle: inViewObject.sectionTitle!,
      position: "top",
      projectId: inViewObject.taskProjectId!,
      prefilledTitle: keyword.length > 0 ? keyword : undefined,
      prefilledDueDate: finalDueDate,
    });
    callbackHandler(undefined, undefined);
  };

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
        .getElementById(
          calendarConfig.element_ids.calendar_modal.label_prefix + 0
        )
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [defaultTasks]
  );

  const fetchTasksHandler = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        ...(keyword.length > 0 && { searchQuery: keyword }),
      });

      const response = await fetch(
        `${
          calendarConfig.api_endpoints.getUnscheduledTasks
        }?${params.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (response.ok) {
        const result: any = await response.json();
        setFilteredOptions(result);
        if (defaultTasks.length === 0) setDefaultTasks(result);
      }
    } catch (error) {
      console.log("🚀 ~ onOpenHandler ~ error:", error);
    }
  }, [keyword]);

  useEffect(() => {
    const keydown = (e: any) =>
      handleKeydown(
        e,
        filteredOptions?.length ? filteredOptions?.length : 0,
        calendarConfig.element_ids.calendar_modal.label_prefix,
        () => callbackHandler(undefined, undefined)
      );
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [filteredOptions?.length, handleKeydown, currentMode]);

  if (currentMode === "Create") {
    return (
      <ModalContainerCustom
        fade={false}
        show={true}
        isOpen={true}
        onOpened={fetchTasksHandler}
        id={calendarConfig.element_ids.calendar_modal.parent}
        toggle={() => callbackHandler(undefined)}
        shouldCloseOnClickOutside={true}
      >
        <ModalHeaderComp
          header={calendarConfig.ui.calendar_modal.header.title}
          className={calendarConfig.ui.calendar_modal.header.className}
        />
        <ModalBody className={calendarConfig.ui.calendar_modal.body.className}>
          <ModalInput
            onChange={handleChange}
            value={keyword}
            placeholder={
              calendarConfig.ui.calendar_modal.body.input_placeholder
            }
            autofocus={true}
          />
          <ModalListContainer
            handleMouseMove={handleMouseMove}
            id={calendarConfig.element_ids.calendar_modal.list_container}
            className={
              calendarConfig.ui.calendar_modal.list_container.className
            }
          >
            {filteredOptions.length > 0 ? (
              filteredOptions?.map((item: ITask, index: number) => (
                <ModalRowElementContainer
                  key={
                    calendarConfig.element_ids.calendar_modal.label_prefix +
                    index
                  }
                  onMouseEnter={() => handleMouseEnter(index)}
                  handleMouseLeave={handleMouseLeave}
                  onClick={() => enterHandler(index)}
                  id={
                    calendarConfig.element_ids.calendar_modal.label_prefix +
                    index
                  }
                  index={index}
                  commandRef={elRef}
                  isSelected={selectedIndex === index}
                >
                  <div className="space-x-1 w-full inline-block items-start justify-normal">
                    <span className="font-normal text-text-light-gray w-full line-clamp-2">
                      {item.ticketNumber}&nbsp;
                      <span className="text-white-black font-medium">
                        {item.title}
                      </span>
                    </span>
                  </div>
                </ModalRowElementContainer>
              ))
            ) : (
              <ModalRowElementContainer
                key={`el-${0}`}
                onMouseEnter={() => handleMouseEnter(0)}
                handleMouseLeave={handleMouseLeave}
                onClick={() => enterHandler(0)}
                id={calendarConfig.element_ids.calendar_modal.label_prefix + 0}
                index={0}
                commandRef={elRef}
                isSelected={selectedIndex === 0}
              >
                <span>
                  Create task &quot;{keyword}&quot; and add to calendar
                </span>
              </ModalRowElementContainer>
            )}
          </ModalListContainer>
        </ModalBody>
      </ModalContainerCustom>
    );
  } else {
    return (
      <DueDateModal
        mode={"Update"}
        closeHandler={(callback, reset) => {
          //Man it sucks when duedate modal returns the current date when we press escape for some reason.
          callbackHandler(undefined, {
            date: callback ?? (reset ? undefined : undefined),
            task: selectedTask,
          });
        }}
      />
    );
  }
};

export default CalendarDueDateModal;
