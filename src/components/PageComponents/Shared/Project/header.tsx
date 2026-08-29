/* eslint-disable @next/next/no-img-element */
import { IProject } from "@/models/model";
import React, { Suspense, useContext, useState } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import HeaderDivider from "../../Kanban/HeaderComponents/HeaderDivider";
import ReadOnlySearchFilter from "./ReadOnlySearchFilter";
import SearchTasksHeader from "../../Kanban/HeaderComponents/SearchFilterIcon";
import HeaderIconWrapper from "../../Kanban/HeaderComponents/HeaderIconWrapper";
import { Share2 } from "lucide-react";
import { toast } from "react-hot-toast";
import UserAvatar from "@/components/Common/UserAvatar";

interface Props {
  project: IProject;
  searchKeyword: string;
  onSearchChange: (keyword: string) => void;
  routeToInvitePage: () => void;
}

const ReadOnlyHeader = ({
  project,
  searchKeyword,
  onSearchChange,
  routeToInvitePage,
}: Props) => {
  const isMbl = useContext(MobileViewContext);
  const [showSearch, setShowSearch] = useState(false);

  return (
    <div
      id="header"
      className={`fixed z-20 top-0 border-b-[1.3px] border-light-black-border-1 bg-containerBackground`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "48px",
        padding: "0px 20px",
        width: "100%",
      }}
    >
      <div className="flex items-center flex-grow scrollbar-none flex-wrap">
        <div
          className="kanban-header-title flex items-center gap-1 text-white-black text-subheading lg:text-heading"
          style={{ marginLeft: "8px" }}
        >
          <span className="text-white-black font-medium text-emphasis leading-[20px] cursor-default">
            {project?.title ?? project?.name}
          </span>
          {/* {hasUserSelectedView && (
              <>
                <FaChevronRight size={10} />
                <span
                  onClick={onViewClickHandler}
                  className="cursor-pointer font-normal text-subheading leading-[24.2px]"
                >
                  {hasUserSelectedView.title}
                </span>
              </>
            )} */}
        </div>

        {/* ================= invite people ================== */}
        <Suspense
          fallback={<div className="text-white"> loading header...</div>}
        >
          <HeaderDivider />
          <div
            style={{
              flexDirection: "row",
              display: "flex",
              alignItems: "center",
              cursor: "default",
            }}
          >
            {project.owner && (
              <UserAvatar
                alt={project.owner.displayName || "Board owner"}
                name={project.owner.displayName || project.owner.email}
                photoURL={project.owner.photoURL}
                size={isMbl ? 20 : 24}
                title={project.owner.displayName || project.owner.email}
              />
            )}
            {!isMbl
              ? project.members?.length > 0 && (
                  <>
                    {project.members.slice(0, 5).map((member) => (
                      <UserAvatar
                        key={member.id}
                        className="w-[30px] h-[30px] dark:border-[#212429] border-[#f7f7f7] border-[3px]  ml-[-8px] rounded-[600px]  overflow-hidden "
                        alt={member.agent?.displayName ?? member.user?.displayName ?? "Board member"}
                        name={member.agent?.displayName ?? member.user?.displayName ?? member.user?.email}
                        photoURL={member.agent?.photoURL ?? member.user?.photoURL}
                        size={30}
                        title={member.agent?.displayName ?? member.user?.displayName ?? member.user?.email}
                      />
                    ))}
                    {project.members.length > 5 && (
                      <div
                        key="extra-members"
                        className="w-[30px] h-[30px] dark:border-[#212429] border-[#f7f7f7] bg-[#4F5765]  border-[3px]  ml-[-8px] rounded-[600px]  overflow-hidden flex items-center justify-center text-micro leading-[10.98px] font-normal text-white"
                      >
                        +{project.members.length - 5}
                      </div>
                    )}
                  </>
                )
              : project.members.length > 0 && (
                  <div
                    key="extra-members"
                    className="w-[24px] h-[24px] dark:border-[#212429] border-[#f7f7f7] bg-[#4F5765]  border-[3px]  ml-[-8px] rounded-[600px]  overflow-hidden flex items-center justify-center text-micro font-normal text-white"
                  >
                    +{project.members.length}
                  </div>
                )}
          </div>
          <HeaderDivider />
          <div className={`flex ${isMbl ? "gap-2" : "gap-3"}`}>
            <SearchTasksHeader
              readOnly={true}
              onClick={() => setShowSearch(true)}
            />
            <HeaderIconWrapper
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast.success("Read only view link copied");
              }}
              // className="mr-3"
            >
              <Share2
                size={14}
                className={`text-white-black group-hover:text-header-hover-text`}
               strokeWidth={1.75}/>
            </HeaderIconWrapper>
          </div>
        </Suspense>
      </div>
      <div
        className={`transition-all duration-300 ${
          showSearch ? "scale-100" : "scale-0 hidden pointer-events-none"
        }`}
      >
        <ReadOnlySearchFilter
          onSearchChange={onSearchChange}
          toggleFilter={setShowSearch}
        />
      </div>
      <div className="flex items-center gap-2 text-content text-[#8E9093]">
        Part of the team? You&apos;re almost there to begin working in Hypertask
        <div
          className="flex items-center border-2 border-border-active-modal-element rounded cursor-pointer text-content bg-inherit hover:bg-active-modal-element px-2 py-1 font-medium text-[#8E9093] hover:text-white"
          onClick={routeToInvitePage}
        >
          Sign up or Login
        </div>
      </div>
    </div>
  );
};

export default ReadOnlyHeader;
