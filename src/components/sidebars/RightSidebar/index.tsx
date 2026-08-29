import useClickOutside from "@/hooks/MultiPages/useClickOutside";

import React, { useRef } from "react";
import { useRecoilState } from "@/lib/state";

import { showShortcutsAtom, showSidebarAtom, showMcpTokenModalAtom } from "@/store";

import BackDropContainer from "../BackDropContainer";
import SectionWrapper from "./SectionWrapper";
import {
  KeyboardShortcutsInSidebar,
  TutorialVideos,
  ToggleQuickTips,
  BookCoaching,
  ToggleDarkAndLightMode,
  Contact,
  SendFeedback,
  HelpCenter,
  Docs,
  McpTokenLink,
  MCPTutorial,
} from "./Single section items";
import { SidebarContextProvider } from "@/lib/contexts/Sidebars/SidebarProvider";
import Signout from "./Signout";
import BottomBarInSidebar from "./BottomBar";
import ManageAccountSection from "./ManageAccountSection";
import CurrentUserSidebar from "./CurrentUserSidebar";
import EmailNotificationSidebar from "./Notifications Sidebar/EmailNotificationsSidebar";
import PushNotificationSidebar from "./Notifications Sidebar/PushNotificationSidebar";
import UserPreferenceSidebar from "./UserPreference";
import ScrollButton from "./ScrollButton";
import MentionNotificationSidebar from "./Notifications Sidebar/MentionNotificationsSidebar";

interface IProps {
  _appHandler?: () => void;
}

const RightSidebar: React.FC<IProps> = ({ _appHandler }) => {
  const sidebarRef = useRef<any>(null);
  const [_showShortcuts] = useRecoilState(showShortcutsAtom);
  const [_showSidebar, setShowSidebar] = useRecoilState(showSidebarAtom);
  const [, setShowMcpTokenModal] = useRecoilState(showMcpTokenModalAtom);
  
  const toggleSidebar = () => {
    setShowSidebar(false);
  };
  useClickOutside(null, toggleSidebar, "settings");

  return (
    <>
      <BackDropContainer>
        <div
          style={{ zIndex: "99999" }}
          id="settings"
          ref={sidebarRef}
          className={`right-sidebar-flyout fixed shadow-customshadow-2 pl-8 pr-7 pt-[max(1rem,env(safe-area-inset-top))] pb-4 bg-sidebar overflow-y-auto flex flex-col gap-4  w-[90%] sm:w-[480px]  h-SVH-full top-0 right-0 text-white-black`}
        >
          <SidebarContextProvider _appHandler={_appHandler}>
            <div className="h-fit overflow-y-auto scrollbar-none flex flex-col gap-4 bg-inherit">
              {/* <CurrentUserSidebar/> */}
              <div className="flex items-center justify-between sticky top-0 z-1 bg-inherit">
                <span className="text-content font-semibold text-white-black">
                  Settings
                </span>
                <CurrentUserSidebar toggleSideBar={toggleSidebar} />
              </div>
              <LearnHypertasks />
              <MyAccount showMcpTokenModal={(show) => setShowMcpTokenModal(show)} toggleSidebar={toggleSidebar} />
              <Notifications />
              <GetInTouch />
            </div>
            <div className="flex flex-col justify-end gap-2 flex-grow py-1">
              <Signout />
              <BottomBarInSidebar />
            </div>
          </SidebarContextProvider>
        </div>
      </BackDropContainer>
    </>
  );
};

export default RightSidebar;

const LearnHypertasks = () => {
  return (
    <SectionWrapper sectionTitle="Learn Hypertask">
      <KeyboardShortcutsInSidebar />
      <TutorialVideos />
      <MCPTutorial />
      <ToggleQuickTips />
      <BookCoaching />
      <HelpCenter />
      <Docs />
    </SectionWrapper>
  );
};

const MyAccount = ({ showMcpTokenModal, toggleSidebar }: { showMcpTokenModal: (show: boolean) => void; toggleSidebar: () => void }) => {
  return (
    <SectionWrapper sectionTitle="My Account">
      <ToggleDarkAndLightMode />
      <UserPreferenceSidebar />
      <ScrollButton />
      <McpTokenLink onClick={() => { toggleSidebar(); showMcpTokenModal(true); }} />
      <ManageAccountSection />
    </SectionWrapper>
  );
};

const GetInTouch = () => {
  return (
    <SectionWrapper sectionTitle="Get in touch">
      <Contact />
      <SendFeedback />
    </SectionWrapper>
  );
};

const Notifications = () => {
  return (
    <SectionWrapper sectionTitle="Notifications">
      <MentionNotificationSidebar/>
      <EmailNotificationSidebar />
      <PushNotificationSidebar />
    </SectionWrapper>
  );
};

// another approach could be creating a sections array of object, each section containing its correspodning jsx elements in an array.
// but might lead to limitations, only time will tell. doing a simple one so YOU can deal with it with ease too, not just me
// I;m not dealing with this :'
