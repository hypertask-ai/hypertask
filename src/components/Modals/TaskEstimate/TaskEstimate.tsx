import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import globalConstants from "@/lib/constants";
import { IEstimateConstants } from "@/lib/constants/constants";
import { ChangeEvent, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { ModalBody } from "reactstrap";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { useEstimateModal } from "@/hooks/MultiPages/Tasks/useEstimateModal";
import EstimateLabelComponent from "./EstimateLabelComponent";

const TaskEstimateModal = ({
  closeHandler,
  mode,
}: {
  closeHandler: any;
  mode: "Task" | "Filter" | "TaskModalGlobally" | "Filter-Calendar";
}) => {
  const [keyword, setKeyword] = useState("");
  const [filteredPriorities, setFilteredPriorities] = useState<
    IEstimateConstants[]
  >(globalConstants.EstimateConstants);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const { handleMouseLeave, handleMouseMove } = useHandleMouseGlobal({
    setSelectedIndex,
  });
  const { checkedEstimates, EnterOnClickHandler } = useEstimateModal(
    mode,
    closeHandler
  );
  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setKeyword(text);
    const filteredEstimates_ =
      text.length > 0
        ? globalConstants.EstimateConstants.filter(
            (estimate) =>
              estimate.estimate_full_value
                .toLowerCase()
                .indexOf(text.toLowerCase()) > -1 ||
              estimate.estimate_value
                .toLowerCase()
                .indexOf(text.toLowerCase()) > -1 ||
              estimate.estimate_index.toString().indexOf(text) > -1
          )
        : globalConstants.EstimateConstants;
    setFilteredPriorities(filteredEstimates_);
    setSelectedIndex(0);
    document
      .getElementById(`command-0`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.keyCode === KeyCodes.TAB) {
      e.preventDefault();
      return;
    }
    if (e.keyCode === KeyCodes.ENTER) {
      EnterOnClickHandler(filteredPriorities[selectedIndex]);
    }
    if (e.keyCode === KeyCodes.ARROW_DOWN) {
      if (
        selectedIndex === -1 ||
        selectedIndex === filteredPriorities.length - 1
      ) {
      } else {
        setSelectedIndex(selectedIndex + 1);
        document
          .getElementById(`command-${selectedIndex + 1}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      EnterOnClickHandler(globalConstants.EstimateConstants[parseInt(e.key)]);
    }

    if (e.keyCode === KeyCodes.ARROW_UP) {
      if (selectedIndex <= 0) {
      } else {
        setSelectedIndex(selectedIndex - 1);
        document
          .getElementById(`command-${selectedIndex - 1}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [keyword, selectedIndex, filteredPriorities]);

  return (
    <ModalContainerCustom
      id="estimate-modal"
      isOpen={true}
      forceRenderOnlyChildren={mode === "Filter" ? true : false}
      toggle={closeHandler}
      className="paletteModalSizing sm:min-w-[560px] sm:top-[24%] sm:max-h-fit"
    >
      <ModalHeaderComp header="Set task size">
        {mode === "Filter" ? (
          <span className="text-content text-text-light-gray whitespace-nowrap">
            SHIFT+ESC to go back
          </span>
        ) : (
          ""
        )}
      </ModalHeaderComp>

      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput
          placeholder="Set task size"
          onChange={onKeyChange}
          value={keyword}
        />

        <ModalListContainer
          className="max-h-[364px]"
          handleMouseMove={handleMouseMove}
          id="estimate-modal-list"
        >
          {filteredPriorities.map((estimate, index: number) => (
            <ModalRowElementContainer
              id={`task_${estimate.estimate_index}`}
              index={index}
              onMouseLeave={handleMouseLeave}
              onMouseEnter={() => setSelectedIndex(index)}
              key={`user-${index}`}
              className="gap-3"
              onClick={() => EnterOnClickHandler(estimate)}
              isSelected={selectedIndex === index}
            >
              <div className="flex-grow flex space-x-4 items-center gap-2">
                {estimate.estimate_index !== 0 && (
                  <p className="font-medium first-letter:capitalize">
                    {estimate.estimate_full_value}
                  </p>
                )}
                <EstimateLabelComponent estimate={estimate} />
              </div>
              {checkedEstimates?.includes(estimate.estimate_index) ? (
                <Check size={16} strokeWidth={1.75} />
              ) : null}
              <span className="mx-1 font-medium">{index}</span>
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default TaskEstimateModal;
