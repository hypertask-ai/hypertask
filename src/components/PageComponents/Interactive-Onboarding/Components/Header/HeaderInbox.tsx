import { ITutorialAtom } from "@/models/InteractiveOnboarding/model";
import React from "react";

const HeaderInbox = ({
  activeScene,
  activeBoard,
  inboxCount,
}: {
  activeScene: ITutorialAtom;
  activeBoard: number;
  inboxCount: number;
}) => {
  return (
    <div
      className="group relative"
      style={{
        marginLeft: 16,
        height: 40,
        borderRadius: 20,
        padding: "5.2px 14px",
        display: "flex",
        alignItems: "center",
      }}
    >
      {/* <FaCircle className={`text-[#5896F1] w-new-notification`} /> */}

      <p
        className="px-1 text-white-black mt-[1px]"
        style={{ fontSize: "14px" }}
      >
        Inbox
      </p>

      {(activeScene.index < 18 && activeBoard === 0) || activeBoard > 0 ? (
        <span
          className={`text-white bg-[#e34e25]  text-micro pt-[2px] pb-[1px] px-[6px] rounded-[4px] font-bold`}
          style={{ fontWeight: 700 }}
        >
          {inboxCount}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default HeaderInbox;
