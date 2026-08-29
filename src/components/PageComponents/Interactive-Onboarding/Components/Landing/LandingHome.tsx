import React from "react";
import { IBoardSection } from "@/models/InteractiveOnboarding/model";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import Commands from "@/components/Modals/commands/HTC/commands";
import MoveModal from "../Modals/MoveModal";
import AddColumnModal from "../Modals/AddColumnModal";
import Section from "./Section";
import LandingHeaderContainer from "../Header";
import TutorialTooltip from "../TutorialTip";

const LandingHomeContainer = () => {
  const { activeScene, activeBoard, board, handleCommandCallback } =
    useTutorialContext();

  return (
    <>
      <div
        className={`${
          activeScene.index < 2 ||
          activeScene.index === 13 ||
          activeScene.index === 12
            ? "blur-sm"
            : ""
        }`}
      >
        <LandingHeaderContainer content={board.header} />
        <div
          id="kanban-sections-container"
          className="bg-pageBackground homepage-container-tag flex-col gap-4 flex items-center"
        >
          {/*------------------------------------------SECTION CONTAINER */}
          <div
            id="sectionsContainer"
            className={`gap-[16px] w-[97%] scrollbar-none  m-auto grid grid-flow-col auto-cols-[minmax(404px,535px)] ${
              board.sections && board.sections.length === 3
                ? "[justify-content:safe_center]"
                : "justify-start"
            }`}
          >
            {board.sections.map((section: IBoardSection, index: number) => (
              <Section
                title={section.title}
                key={`section-${index}`}
                index={index}
                taskCount={section.tasks.length}
                showBottomButton={section.showBottomButton}
                tasks={section.tasks}
              />
            ))}
          </div>
        </div>
      </div>
      {/*------------------------------------------KANBAN MODALS */}
      {activeScene.index === 22 && (
        <Commands
          key={"modal-active-key"}
          isOpen={activeScene.index === 22}
          isInteractive={true}
          callback={handleCommandCallback}
        />
      )}
      {activeScene.index === 23 && <AddColumnModal />}
      {activeScene.index === 25 && <MoveModal />}
    </>
  );
};

export default LandingHomeContainer;
