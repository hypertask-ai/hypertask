import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
} from "@/components/Common/CommonModalComponents";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import React from "react";
import styles from "@/styles/linksModal.module.scss";
import { ModalBody } from "reactstrap";
import { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import formatDateDifference from "@/utils/generateTime";
import TutorialTooltip from "../TutorialTip";

const DueDateModal = () => {
  const {
    activeScene,
    activeModalIndex,
    handleRemindMeModalInput,
    remindMeModalInput,
    filteredOptions,
  } = useTutorialContext();

  return (
    <ModalContainerCustom
      id="dueDateModal"
      isOpen={activeScene.index === 17}
      toggle={() => undefined}
      className={`${styles.links_modal} relative`}
    >
      <>
      {activeScene.index === 17 && (
          <TutorialTooltip
            text="Type 'tomorrow' to set the reminder!"
            top={60}
            left={-135}
            className="w-[129px]"
          />
        )}
      <ModalHeaderComp header="Remind Me" />
      <ModalBody className=" p-0 rounded-b-[4px]  ">
        <div className=" p-0 rounded-[4px]">
          <ModalInput
            onChange={handleRemindMeModalInput}
            value={remindMeModalInput}
            placeholder="e.g. 5 July 2pm, 8pm tomorrow, next thursday"
          />
        </div>

        <ul
          id="users-list"
          className="rounded-b-[4px] max-h-default-modal text-emphasis font-medium  text-white-black  overflow-y-auto no-scrollbar"
        >
          {filteredOptions?.map(
            (option: DisplayDate | undefined, index: number) => (
              <div
                id={`option-${index}`}
                key={index}
                className={`${
                  activeModalIndex === index ? "bg-active-modal-element" : ""
                }
                           text-emphasis font-medium py-[20px] px-[24px]  flex h-[60px] justify-between gap-3`}
              >
                <span>{option?.display}</span>
                {option?.date && (
                  <span>{formatDateDifference(option?.date, true)}</span>
                )}
              </div>
            )
          )}
        </ul>
      </ModalBody>
      </>
    </ModalContainerCustom>
  );
};

export default DueDateModal;
