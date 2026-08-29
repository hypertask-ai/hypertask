import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
} from "@/components/Common/CommonModalComponents";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import React from "react";
import { ModalBody } from "reactstrap";
import styles from "@/styles/linksModal.module.scss";
import { getStyle } from "@/lib/constants/InteractiveOnboarding/constants";
import TutorialTooltip from "../TutorialTip";

const AssigneeModal = () => {
  const {
    activeScene,
    assigneeInput,
    filteredAssignees,
    activeModalIndex,
    handleAssigneeInput,
  } = useTutorialContext();

  return (
    <ModalContainerCustom
      id="assignModal"
      isOpen={activeScene.index === 8}
      toggle={() => undefined}
      className={`${styles.links_modal}`}
    >
      <>
        {activeScene.index === 8 && (
          <TutorialTooltip
            text="Type 'Kai Chen' or you can use arrow keys for selection."
            top={60}
            left={-205}
            className="w-[189px]"
          />
        )}
        <ModalHeaderComp header="Assign" />

        <ModalBody className=" p-0 rounded-[4px] ">
          <ModalInput
            onChange={handleAssigneeInput}
            value={assigneeInput}
            placeholder="Type user name"
            autofocus={true}
          />
          <ul
            id="users-list"
            className="rounded-b-[4px] sm:text-heading font-medium  text-white-black  max-h-[270px] overflow-y-auto no-scrollbar"
          >
            {filteredAssignees.map((user, index) => {
              return (
                <li
                  key={`assignee-tutorial-${index}`}
                  id={`task_assigneeguy`}
                  className={`${
                    index === activeModalIndex ? "bg-active-modal-element" : ""
                  } sm:text-modalSmall xs:text-inherit font-medium py-[20px] px-[24px]  flex h-[60px] items-center gap-3 `}
                >
                  <div className="flex-grow flex space-x-2 items-center ">
                    <div>
                      <img
                        src={user.pfp}
                        alt="pfp"
                        className="object-cover"
                        style={getStyle(user.pfp)}
                      />
                    </div>
                    <p className="font-medium ">{user.name}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </ModalBody>
      </>
    </ModalContainerCustom>
  );
};

export default AssigneeModal;
