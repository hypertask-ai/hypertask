import styles from "@/styles/tiptap.module.scss";
import { ReactNode, useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { CreatedAtCard } from "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentOptions";
import CreatedBy from "@/components/PageComponents/TaskDetail/CommentAndDescription/Common/CreatedBy";
import { tutorialUsers } from "@/lib/constants/InteractiveOnboarding/constants";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";

interface IProp {
  type: "assign" | "move" | "priority";
}

const TutorialTaskActivity = ({ type }: IProp) => {
  const _mbl = useContext(MobileViewContext);

  const {currentUser} = useTutorialContext()
  return (
    <div
      className={` 
            sm:px-[16px] xs:px-[8px] ${styles.stackedContainer} font-normal
              
            ${_mbl ? "block" : "flex justify-between "}
             
            text-white-black-black`}
    >
      <span className="text-content mr-2 sm:mr-0 sm:text-content text-text-light-gray flex items-center gap-1 flex-wrap">
        {type === "move" ? (
          <>
            <TaskMovedActivity currentUser={currentUser} />
          </>
        ) : type === "assign" ? (
          <>
            <TaskAssignedActivity currentUser={currentUser} />
          </>
        ) : type === "priority" ? (
          <>
            <TaskPriorityActivity currentUser={currentUser} />
          </>
        ) : null}
      </span>
      {!_mbl && (
        <CreatedAtCard stacked={true} createdAt={new Date().toString()} />
      )}
    </div>
  );
};

const BoldElement = ({ children }: { children: ReactNode }) => {
  return <b className="text-white-black  font-normal">{children}</b>;
};

const CreatedByLocal = ({ name, pfp }: { name: string; pfp: string }) => {
  return <CreatedBy pfp={pfp ?? ""} name={name ?? ""} isStacked={false} />;
};

const TaskMovedActivity = ({ currentUser }: { currentUser: any }) => {
  return (
    <>
      <BoldElement>
        <CreatedByLocal
          name={currentUser?.displayName ?? ""}
          pfp={currentUser?.photoURL ?? ""}
        />
      </BoldElement>{" "}
      changed the status from <BoldElement>Todo</BoldElement> to{" "}
      <BoldElement>Doing</BoldElement>
    </>
  );
};

//This is tweaked a little to only handle assignments. Check OG Comment
const TaskAssignedActivity = ({ currentUser }: { currentUser: any }) => {
  return (
    <>
      <BoldElement>
        <CreatedByLocal
          name={currentUser?.displayName ?? ""}
          pfp={currentUser?.photoURL ?? ""}
        />
      </BoldElement>
      assigned <BoldElement>{tutorialUsers[1].name}.</BoldElement>
    </>
  );
};

// ======================= Priority Element
const TaskPriorityActivity = ({ currentUser }: { currentUser: any }) => {
  return (
    <>
      <BoldElement>
        <CreatedByLocal
          name={currentUser?.displayName ?? ""}
          pfp={currentUser?.photoURL ?? ""}
        />
      </BoldElement>{" "}
      prioritized this task to{" "}
      <>
        <PriorityLabelComponent
          fontSize={10}
          priority={{
            priority_index: 1,
            Priority_Value: "Urgent",
            colorCode: "#F88F9C",
          }}
        />
      </>
      .
    </>
  );
};

export default TutorialTaskActivity;
