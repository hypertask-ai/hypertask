import React from "react";
import { ArrowLeft } from "lucide-react";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import SplitTitle from "./SplitTitle";
import NotificationsList from "./NotificationsList";
import InboxZeroState from "@/components/Common/InboxZeroState";

const InboxPage = () => {
  const { activeScene, activeNotification, splitTitles, notifications } =
    useTutorialContext();

  return (
    <div className="flex items-center justify-center flex-col w-full min-h-fit bg-taskDetailPage">
      <div
        className={`search_inbox_container min-h-screen inbox_tag_mobile_view py-9 xs:px-6 sm:px-5 md:px-8 lg:px-12 flex flex-col items-start  bg-containerBackground`}
      >
        <div className={`fixed inset-0 z-0 transition-all duration-700 ease-in-out ${activeScene.index === 18 ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}>
          <InboxZeroState className="w-full h-full" showContent={true} />
        </div>
        {/**---------------------Split title*/}
        <SplitTitle notifications={notifications} splitTitles={splitTitles} />

        {/**------------------------------- Notifications List */}

        {activeScene.index < 17 && (
          <NotificationsList
            notifications={notifications}
            activeNotification={activeNotification}
          />
        )}
      </div>
      {/**------------------------------- Back Button */}
      <div
        className="relative group goback_btn hidden sm:left-[10px] shadow-md xl:left-[40px] sm:block bg-back-button"
        style={{
          position: "absolute",
          zIndex: 3,
          top: 40,
          width: 40,
          height: 40,
          borderRadius: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ArrowLeft className="text-button-arrow"  strokeWidth={1.75}/>
      </div>
    </div>
  );
};

export default InboxPage;
