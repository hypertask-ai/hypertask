import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useSubTask from "@/hooks/SubTask/useSubTask";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import React, { useEffect } from "react";
import { Check } from "lucide-react";
import { ModalBody } from "reactstrap";
interface ISubTaskSettings {
  toggle: (val?: boolean) => void;
}

const subTaskOptions: { title: string; value: TBoardSubtaskSetting }[] = [
  {
    title: "Hide on board, show on task page",
    value: "None",
  },
  {
    title: "Show as card property and flattened list combined",
    value: "Flattened_Card",
  },
  {
    title: "Show as flattened list",
    value: "Flattened",
  },
  {
    title: "Show only parents",
    value: "Parent",
  },
  {
    title: "Show as card property",
    value: "Card",
  },
];

const SubtaskSettings: React.FC<ISubTaskSettings> = ({ toggle }) => {
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });
  const { currentSetting, updateSubTaskSetting } = useSubTask();

  async function enterHandler(index: any) {
    if (currentSetting !== subTaskOptions[index].value) {
      updateSubTaskSetting(subTaskOptions[index].value)
      toggle(true);
    }
    toggle();
  }

  useEffect(() => {
    const keydown = (e: KeyboardEvent) =>
      handleKeydown(e, subTaskOptions.length, "label-htc-option-", toggle);
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [handleKeydown]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="subTaskSettingsModal"
      toggle={() => toggle()}
      shouldCloseOnClickOutside={true}
      className="font-bold"
    >
      <ModalHeaderComp
        header={`Sub-task Settings`}
        className="px-[20px]"
      ></ModalHeaderComp>
      <ModalBody className="p-0">
        <ModalListContainer
          className="max-h-full"
          handleMouseMove={handleMouseMove}
          id="subtask-settings-modal-container"
        >
          {/* ============== ALL Project View Elements ============ */}
          {subTaskOptions?.map((option, index) => (
            <ModalRowElementContainer
              key={`el-${index}`}
              onMouseEnter={() => handleMouseEnter(index)}
              handleMouseLeave={handleMouseLeave}
              onClick={() => enterHandler(index)}
              id={`label-htc-option-${index}`}
              index={index}
              commandRef={elRef}
              isSelected={selectedIndex === index}
            >
              <SubTaskOptionTitle option={option} />
              {currentSetting === option.value && <Check strokeWidth={1.75} size={14} />}
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default SubtaskSettings;

const SubTaskOptionTitle = ({ option }: { option: any }) => {
  return (
    <div className="flex items-center gap-2">
      <span>{option.title}</span>
    </div>
  );
};
