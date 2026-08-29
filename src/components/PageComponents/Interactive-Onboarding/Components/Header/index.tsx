import React from "react";
import { IBoardHeader } from "@/models/InteractiveOnboarding/model";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import HeaderInbox from "./HeaderInbox";
import UpgradeToAi from "./UpgradeToAI";
import HeaderOptions from "./HeaderOptions";

type Props = {
  content: IBoardHeader;
};

const LandingHeaderContainer = ({ content }: Props) => {
  const { activeScene, activeBoard } = useTutorialContext();
  const { title, ownerImg, memberImgs, inboxCount } = content;

  return (
    <div className="h-[48px] relative">
      <div
        id="header"
        className="fixed z-20 top-0 border-b-[1.3px] border-light-black-border-1 bg-containerBackground"
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          height: "48px",
          padding: "0px 20px",
        }}
      >
        <HeaderOptions
          title={title}
          ownerImg={ownerImg}
          memberImgs={memberImgs}
        />
        <HeaderInbox
          inboxCount={inboxCount}
          activeScene={activeScene}
          activeBoard={activeBoard}
        />
      </div>
    </div>
  );
};

export default LandingHeaderContainer;
