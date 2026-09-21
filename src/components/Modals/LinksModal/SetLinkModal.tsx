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
import React, { useEffect, useState } from "react";
import { ModalBody } from "reactstrap";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom } from "@/store";

const prefixId = "label-htc-option-";
interface ISetLinkModal {
  closeHandler: () => void;
  callbackHandler: (task?: any, keyword?: string) => void;
}

const SetLinkModal: React.FC<ISetLinkModal> = ({
  closeHandler,
  callbackHandler,
}) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const [keyword, setKeyword] = useState<string>("");
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });
  const [filteredOptions, setFilteredOptions] = useState<ITask[]>([]);
  const [defaultTasks, setDefaultTasks] = useState<ITask[]>([]);

  function enterHandler(index: number) {
    if (filteredOptions.length === 0) {
      callbackHandler(undefined, keyword);
    } else {
      callbackHandler(filteredOptions[index]);
    }
  }

  const fetchTasksHandler = async (searchParam: string = "all") => {
    try {
      const params = new URLSearchParams({
        param: searchParam,
        projectId: currentProject?.id?.toString() ?? "",
      });

      const response = await fetch(
        `/api/tasks/searchByParam?${params.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (response.ok) {
        const result: any = await response.json();

        // Filter to only show tasks (type: "task"), exclude peopleHeading, name, projectHeading, project
        const tasks = Array.isArray(result)
          ? result.filter((item: any) => item && item.type === "task")
          : [];

        // Map to ITask format
        const mappedTasks: ITask[] = tasks.map(
          (item: any) =>
            ({
              id: item.id,
              title: item.name,
              ticketNumber: item.ticketNumber,
              projectId: item.project_id,
              uniqueIndex: item.index,
            } as ITask)
        );

        setFilteredOptions(mappedTasks);
        if (defaultTasks.length === 0) setDefaultTasks(mappedTasks);
      }
    } catch (error) {
      console.log("🚀 ~ fetchTasksHandler ~ error:", error);
    }
  };

  const debounceSearch = useDebounce(() => {
    const searchParam = keyword.length > 0 ? keyword : "all";
    fetchTasksHandler(searchParam);
  }, 150);

  const handleChange = (e: any) => {
    setKeyword(e.target.value);
    if (e.target.value.length === 0) {
      setFilteredOptions(defaultTasks);
    } else {
      debounceSearch();
    }
    setSelectedIndex(0);
    document
      .getElementById(`${prefixId}${0}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      onOpened={() => fetchTasksHandler("all")}
      id="editor-link-modal"
      toggle={() => closeHandler()}
      shouldCloseOnClickOutside={true}
      className="font-bold"
    >
      <ModalHeaderComp
        header={"Link to a task or external URL"}
        className="px-[20px]"
      />
      <ModalBody className="p-0">
        <ModalInput
          onChange={handleChange}
          value={keyword}
          placeholder="Search for a task or enter an external URL"
          autofocus={true}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="editor-link-modal-list-container"
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
              onClick={() => callbackHandler(undefined, keyword)}
              id={`${prefixId}${0}`}
              index={0}
              commandRef={elRef}
              isSelected={selectedIndex === 0}
            >
              <span>Link to &quot;{keyword}&quot;</span>
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
export default SetLinkModal;
