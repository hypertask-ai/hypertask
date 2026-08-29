import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import globalConstants from "@/lib/constants";
import { IPrioritiesConstants } from "@/lib/constants/constants";
import styles from "@/styles/linksModal.module.scss";
import { ChangeEvent, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { ModalBody } from "reactstrap";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { usePriorityModal } from "@/hooks/MultiPages/Tasks/usePriorityModal";
import PriorityLabelComponent from "./PriorityLabelComponent";

type Props = {
  closeHandler: any;
  mode: "Task" | "Filter" | "TaskModalGlobally" | "Filter-Calendar";
};

const SetPriorityModal = (props: Props) => {
  const { closeHandler, mode } = props;

  const [keyword, setKeyword] = useState("");
  const [filteredPriorities, setFilteredPriorities] = useState<
    IPrioritiesConstants[]
  >(globalConstants.PriorityConstants);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const { handleMouseEnter, handleMouseLeave } = useHandleMouseGlobal({
    setSelectedIndex,
  });
  const { checkedPriorities, EnterOnClickHandler } = usePriorityModal(
    mode,
    closeHandler
  );

  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setKeyword(text);
    const filteredPriorities_ =
      text.length > 0
        ? globalConstants.PriorityConstants.filter(
            (priority) =>
              priority.Priority_Value.toLowerCase().indexOf(
                text.toLowerCase()
              ) > -1
          )
        : globalConstants.PriorityConstants;
    setFilteredPriorities(filteredPriorities_);
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
      EnterOnClickHandler(globalConstants.PriorityConstants[parseInt(e.key)]);
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
  }, [document.activeElement, keyword, selectedIndex, filteredPriorities]);

  return (
    <ModalContainerCustom
      id="priority-modal"
      isOpen={true}
      autoFocus={false}
      shouldCloseOnClickOutside={true}
      forceRenderOnlyChildren={mode === "Filter" ? true : false}
      toggle={closeHandler}
      className={`paletteModalSizing sm:min-w-[560px] sm:top-[24%] sm:max-h-fit ${styles.links_modal}`}
    >
      <ModalHeaderComp header="Set Priority">
        {mode === "Filter" ? (
          <span className="text-content text-text-light-gray whitespace-nowrap">
            SHIFT+ESC to go back
          </span>
        ) : (
          ""
        )}
      </ModalHeaderComp>

      <ModalBody className=" p-0 rounded-b-[4px]  ">
        <ModalInput
          onChange={onKeyChange}
          value={keyword}
          placeholder={mode === "Filter" ? "Change Filter" : "Change Priority"}
          autofocus={true}
        />
        <ModalListContainer id="users-list" className="max-h-[364px]">
          {filteredPriorities.map((priority, index: number) => (
            <ModalRowElementContainer
              id={`task_${priority.priority_index}`}
              index={index}
              onMouseLeave={handleMouseLeave}
              onMouseEnter={() => handleMouseEnter(index)}
              key={`user-${index}`}
              onClick={() => EnterOnClickHandler(priority)}
              className="gap-3"
              isSelected={selectedIndex === index}
            >
              <div className="flex-grow flex space-x-4 items-center">
                <PriorityLabelComponent priority={priority} />
              </div>
              {checkedPriorities.includes(priority.priority_index) ? (
                <Check size={16} strokeWidth={1.75} />
              ) : null}
              <span className="mx-1 font-medium">
                {priority.priority_index}
              </span>
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default SetPriorityModal;
