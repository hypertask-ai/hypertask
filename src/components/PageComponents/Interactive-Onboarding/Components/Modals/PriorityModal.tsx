import {
  ModalContainerCustom,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import React from "react";
import styles from "@/styles/linksModal.module.scss";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import { ModalBody } from "reactstrap";
import { priorities } from "@/lib/constants/InteractiveOnboarding/constants";
import TutorialTooltip from "../TutorialTip";

const PriorityModal = () => {
  const {
    activeScene,
    activeModalIndex,
    filterPriorityOptions,
    handlePriorityInput,
    priorityModalInput,
  } = useTutorialContext();

  return (
    <ModalContainerCustom
      id="priorityModal"
      isOpen={activeScene.index === 10}
      autoFocus={false}
      shouldCloseOnClickOutside={false}
      toggle={() => undefined}
      className={`sm:max-h-fit ${styles.links_modal} relative`}
    >
      <>
        {activeScene.index === 10 && (
          <TutorialTooltip
            text="Type 'Urgent' or you can use arrow keys for selection."
            top={60}
            left={-205}
            className="w-[189px]"
          />
        )}
        <ModalHeaderComp header="Set Priority" />
        <ModalBody className=" p-0 rounded-b-[4px]  ">
          <input
            autoFocus
            className="py-2 px-6 text-subheading sm:text-heading h-[60px]  text-white-black bg-inherit border-0 outline-none font-medium"
            onChange={handlePriorityInput}
            value={priorityModalInput}
            placeholder={"Change Priority"}
          />
          <ul
            id="users-list"
            className="rounded-b-[4px] text-text-modalSmall font-medium  text-white-black  max-h-full overflow-y-auto no-scrollbar"
          >
            {filterPriorityOptions.map((priority, index) => (
              <li
                key={`priority_modal_${priority.index}`}
                id={`task_prior_${priority.index}`}
                className={`${
                  activeModalIndex === index ? "bg-active-modal-element" : ""
                } sm:text-text-modalSmall xs:text-inherit font-medium py-[20px] px-[24px] flex h-[60px] items-center gap-3`}
              >
                <div className="flex-grow flex space-x-4 items-center">
                  <p className="font-medium ">{priority.title}</p>
                </div>
                <span className="mx-1 font-medium">{priority.index}</span>
              </li>
            ))}
          </ul>
        </ModalBody>
      </>
    </ModalContainerCustom>
  );
};

export default PriorityModal;
