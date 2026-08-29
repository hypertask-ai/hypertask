/* eslint-disable @next/next/no-img-element */
import dynamic from "next/dynamic";
import { IMember, IProject, IUser } from "@/models/model";
import React, { Suspense, useCallback, useContext, useEffect } from "react";
import { PanelLeft, Circle, Timer } from "lucide-react";
import { kanbanRunningOnlyAtom, openBoardByClickAtom } from "@/store";
import { useRecoilState } from "@/lib/state";

import Link from "next/link";
import Tooltip from "@/components/Common/Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useTrialModal from "@/hooks/MultiPages/Route/useTrialModal";
import { SaveView } from "./SaveViewHeaderKanban";
import TitleKanbanHeader from "./TitleKanbanHeader";
import ViewsHeaderKanban from "./ViewsHeaderKanban";
import SearchFilter from "./SearchFilter";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
import SearchTasksHeader from "./SearchFilterIcon";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { InviteTeamButton } from "./InviteTeamButton";
import HeaderDivider from "./HeaderDivider";
import { useAiChatMainContentLayout } from "@/hooks/MultiPages/AIChat/useAiChatMainContentLayout";
import { CLASS_NAME_CONSTANTS } from "@/lib/configs/general.config";
import CalendarIcon from "./CalendarIcon";
import HeaderIconWrapper from "./HeaderIconWrapper";
import { useBoardRunningTimers } from "@/hooks/Task Detail/useTimeTracking";
import NotificationCountBadge from "@/components/Global/NotificationCountBadge";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchInboxQuery } from "@/hooks/Inbox/useGetNotifications";

const PriorityHeaderKanban = dynamic(() => import("./PriorityHeaderKanban"), {
  ssr: false,
});
const HiddenColumns = dynamic(() => import("./HiddenColumnsHeaderKanban"), {
  ssr: false,
});
const FilterHeader = dynamic(() => import("./FilterHeaderKanban"), {
  ssr: false,
});
const InviteNewMembers = dynamic(() => import("./InviteHeaderKanban"), {
  ssr: false,
});
const TrialModal = React.lazy(
  () => import("../../../Modals/TrialPlan/TrialModal"),
);

interface Props {
  currentUser: IUser;
  project: IProject | null;
  currentProject: IProject;
  members: IMember[];
  notificationsCount: number | undefined;
  notificationsUnseen: number | undefined;
  openBoardManager: () => void;
  owner?: IUser;
}

const Header = ({
  project,
  currentProject,
  members = [],
  notificationsCount = 0,
  notificationsUnseen = 0,
  openBoardManager,
  owner,
  currentUser,
}: Props) => {
  const [_, setIsOpenByClick] = useRecoilState(openBoardByClickAtom);
  const [runningOnly, setRunningOnly] = useRecoilState(kanbanRunningOnlyAtom);
  const { timers: runningTimers } = useBoardRunningTimers(currentProject.id);
  // honestly i shouldn't have to handle this logic separately, but i dont have the resources(brain power, and TIME) to think of a better solution
  // fuck it, create a hook.
  const isApple = useDeviceContext();
  const { setShowTrial, redirectToManageSubscriptions, showTrial } =
    useTrialModal(project);
  const { toggleSearchTasks, showSearchTasks } = useKanbanModalStatesContext();
  const { mainContentWidth } = useAiChatMainContentLayout();
  const isMbl = useContext(MobileViewContext);
  const queryClient = useQueryClient();
  const prefetchInbox = useCallback(() => {
    void prefetchInboxQuery(queryClient, currentUser.id);
  }, [currentUser.id, queryClient]);

  // Determine if user is trial user (trialStatus === false means eligible for trial/free user)
  // trialStatus === true means user has redeemed trial (paid user)
  const isTrialUser = !currentUser.UserSetting.trialStatus;

  useEffect(() => {
    setRunningOnly(false);
  }, [currentProject.id, setRunningOnly]);

  // =============== redirect to manage subscriptions page

  // ================================================= HEADER COMPONENT
  return (
    <>
      <div
        id="header"
        className={`fixed z-20 top-0 border-b-[1.3px] border-light-black-border-1 bg-containerBackground`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "48px",
          padding: "0px 20px",
          width: mainContentWidth,
        }}
      >
        <div className="flex items-center flex-grow scrollbar-none flex-wrap">
          <div className="relative group ">
            <PanelLeft size={18}
              onClick={() => {
                openBoardManager();
                setIsOpenByClick(true);
              }}
              className={`board-header-icon board-header-outline-icon cursor-pointer text-white-black min-w-[16px] md:min-w-[18px]`}
              style={{
                width: isMbl ? "16px" : "18px",
                height: isMbl ? "16px" : "18px",
              }}
             strokeWidth={1.75}/>

            <Tooltip
              left={-10}
              bottom={-40}
              text="Your Kanban boards"
              keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, "B"]}
            />
          </div>

          {project && <TitleKanbanHeader project={project} />}

          {/* ================= invite people ================== */}
          <Suspense
            fallback={<div className="hidden text-white md:block"> loading header...</div>}
          >
            <div className="hidden md:contents">
              <HeaderDivider />
              <InviteNewMembers
                currentProject={currentProject}
              />
              <HeaderDivider />

              {/* ======================= BOARD FEATURES ====================== */}
              <div className="flex gap-3">
                <PriorityHeaderKanban _currentProject={currentProject} />
                <FilterHeader currentProject={currentProject} />
                {currentProject.timeTrackingEnabled && (
                  <HeaderIconWrapper
                    className={runningOnly ? "board-header-icon-active text-[#51A4F1]" : undefined}
                    onClick={() => setRunningOnly((value) => !value)}
                  >
                    <Timer
                      size={16}
                      strokeWidth={1.75}
                      className={runningOnly ? "text-[#51A4F1]" : "group-hover:text-header-hover-text"}
                    />
                    <span style={{ fontSize: 11 }}>{runningTimers.size}</span>
                    <Tooltip
                      left={-10}
                      bottom={-40}
                      text="Show only tasks with a running timer"
                      keyCombination={[]}
                    />
                  </HeaderIconWrapper>
                )}
                <HiddenColumns currentProject={currentProject} />
                <ViewsHeaderKanban currentProject={currentProject} />
                <CalendarIcon />
                <SearchTasksHeader />
              </div>

              <HeaderDivider />
              {/* ==================== INVITE TEAM BUTTON ============= */}
              <InviteTeamButton
                isTrialUser={isTrialUser}
                isMobile={isMbl}
              />
              <SaveView project={currentProject} />
            </div>
          </Suspense>
        </div>

        {/* ==================== inbox ============= */}
        <div
          className={`transition-transform duration-150 ${
            showSearchTasks
              ? "hidden scale-100 md:block"
              : "hidden scale-0 pointer-events-none"
          }`}
        >
          <SearchFilter
            toggleFilter={toggleSearchTasks}
            project={currentProject}
          />
        </div>
        <div
          className={`transition-transform duration-150
            ${
              showSearchTasks
                ? "hidden scale-0 pointer-events-none"
                : "hidden scale-100 md:block"
            } ${CLASS_NAME_CONSTANTS.inboxButton}
          }`}
        >
          <Link
            tabIndex={-1}
            className="group relative"
            href={`/inbox`}
            onPointerEnter={prefetchInbox}
            onFocus={prefetchInbox}
            onTouchStart={prefetchInbox}
            style={{
              cursor: "pointer",
              // marginLeft: 16,
              height: 40,
              borderRadius: 20,
              padding: "5.2px 14px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {notificationsUnseen > 0 && (
              <Circle size={7} className="fill-current inbox-indicator-dot text-[#51A4F1] w-new-notification"  strokeWidth={1.75} fill="currentColor"/>
            )}

            <p
              className="px-1 text-white-black mt-[1px]"
              style={{ fontSize: "14px" }}
            >
              Inbox
            </p>

            <NotificationCountBadge
              hasUnseen={notificationsUnseen > 0}
              count={notificationsCount}
            />

            <Tooltip
              left={-94}
              bottom={-30}
              text="Go to inbox"
              keyCombination={["G", null, "I"]}
            />
          </Link>
        </div>
      </div>
      {showTrial && (
        <Suspense fallback={null}>
          <TrialModal closeCallback={() => setShowTrial(false)} />
        </Suspense>
      )}
    </>
  );
};

export default Header;
