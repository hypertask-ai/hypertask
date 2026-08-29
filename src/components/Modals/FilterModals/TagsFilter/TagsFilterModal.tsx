/* eslint-disable react-hooks/exhaustive-deps */
import { ILabel } from "@/models/model";
import {
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import { ModalBody } from "reactstrap";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { Check, Sparkles } from "lucide-react";
import { useTagsModal } from "@/hooks/MultiPages/Tasks/useTagsModal";
import MatchModeToggle from "../MatchModeToggle";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";
import type { CalendarLabelSummary } from "@/lib/calendarSync/contract";

type CalendarLabelOption = ILabel | CalendarLabelSummary;

type Props = {
  closeHandler: (param?: CalendarLabelOption) => Promise<void>;
  calendarTags?: CalendarLabelSummary[];
  view: "Kanban" | "Calendar";
};

const TagsFilterModal: React.FC<Props> = ({
  closeHandler,
  calendarTags,
  view,
}) => {
  const {
    keyword,
    onKeyChange,
    selectedIndex,
    setSelectedIndex,
    filteredLabels,
    enterHandler,
  } = useTagsModal(closeHandler, view, calendarTags);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  return (
    <>
      <ModalHeaderComp header="Tags filters">
        <MatchModeToggle type="Labels" noun="tags" view={view} />
      </ModalHeaderComp>
      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput
          id="filter-input"
          value={keyword}
          placeholder="Enter to (un)select"
          onChange={onKeyChange}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="filteredCommandsList"
        >
          {filteredLabels?.map((label, index) => (
            <ModalRowElementContainer
              key={index}
              onMouseEnter={() => handleMouseEnter(index)}
              handleMouseLeave={handleMouseLeave}
              onClick={enterHandler}
              id={`label-htc-option-${index}`}
              index={index}
              commandRef={elRef}
              isSelected={selectedIndex === index}
            >
              <div className="flex-grow flex gap-2 items-center">
                <TaskLabelComponent labelValue={label.value} />
                {"ai_prompt" in label && label.ai_prompt ? (
                  <Sparkles
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-hypertasks-ai-purple"
                    aria-label="Smart label"
                  />
                ) : null}
              </div>
              {"check" in label && label.check ? (
                <Check size={16} strokeWidth={1.75} />
              ) : null}
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </>
  );
};

export default TagsFilterModal;
