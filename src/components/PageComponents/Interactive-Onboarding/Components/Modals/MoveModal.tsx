import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
} from "@/components/Common/CommonModalComponents";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import React from "react";
import { ModalBody } from "reactstrap";
import styles from "@/styles/linksModal.module.scss";

const MoveModal = () => {
  const {
    activeScene,
    moveTaskModalInput,
    handleMoveTaskInput,
    filterMoveColumnsOptions,
    activeModalIndex,
  } = useTutorialContext();
  return (
    <ModalContainerCustom
      id="MoveModal"
      isOpen={activeScene.index === 25}
      toggle={() => undefined}
      className={`${styles.links_modal}`}
    >
      <ModalHeaderComp header="Move task to column" />

      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput
          id="linksModal"
          placeholder="Search Column"
          value={moveTaskModalInput}
          onChange={handleMoveTaskInput}
        />
        <ul
          id="users-list"
          className="rounded-b-[4px]  text-white-black max-h-[450px] sm:max-h-[270px] overflow-y-auto no-scrollbar "
          aria-labelledby="assignDelayButton"
        >
          {filterMoveColumnsOptions.map((title, index: number) => (
            <li
              id={`task_${title}`}
              key={index}
              className={`text-modalSmall font-medium py-[20px] px-[24px]  flex h-[60px] items-center gap-3 cursor-pointer  ${
                styles.list_container
              } ${index === activeModalIndex ? "bg-active-modal-element" : ""}`}
            >
              <span className={`${styles.links_list}`}>{title}</span>
            </li>
          ))}
        </ul>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default MoveModal;
