import { ArchiveNotificationIcon } from "@/lib/IconsLocal";
import { INotification } from "@/models/InteractiveOnboarding/model";
import React from "react";
import { Circle, Clock } from "lucide-react";
import InboxZeroState from "@/components/Common/InboxZeroState";

type Props = {
  notifications: INotification[];
  activeNotification: number;
};

const NotificationsList = ({ notifications, activeNotification }: Props) => {
  return (
    <div
      style={{
        flex: 1,
        display: `flex`,
        width: "100%",
        flexDirection: "column",
        overflowY: "auto",
      }}
      className="flex flex-col-reverse relative sm:mt-4"
    >
      {notifications.length === 0 ? (
        <InboxZeroState className="w-full" />
      ) : (
        <>
          {notifications.map((notification: INotification, index: number) => (
          <>
            <div
              key={`notification-${index}`}
              className={`flex  sm:space-x-8  py-[8px]  sm:border-l-4 px-[20px] sm:px-2 rounded-md ${
                activeNotification === index
                  ? "sm:bg-active-elementBg border-l-selected-item-border"
                  : "sm:border-l-transparent  bg-transparent"
              } justify-between w-full flex-col md:flex-row`}
            >
              <div className="flex sm:space-x-6 sm:min-w-[15%]">
                <div className="flex justify-between w-100">
                  <div className="gap-1 flex" style={{ fontSize: 14 }}>
                    <span className="flex sm:gap-[10px] items-center">
                      <div
                        className="xs:w-0 group sm:w-new-notification xs:left-[-14px] sm:left-0"
                        style={{
                          position: "relative",
                          marginRight: "-2%",
                        }}
                      >
                        {notification.showDot ? (
                          <>
                            <Circle size={7}
                              className={`fill-current ${
                                false
                                  ? "text-hypertasks-green"
                                  : "text-[#5896F1]"
                              }  w-new-notification`}
                             strokeWidth={1.75} fill="currentColor"/>
                          </>
                        ) : (
                          <></>
                        )}
                      </div>

                      <span className="text-white-black">
                        {notification.user}
                      </span>
                    </span>
                    <span className="text-[#8E9093] mx-1">
                      ({notification.task.count})
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-grow gap-2 items-baseline sm:items-center sm:w-[40%] flex-col sm:flex-row">
                {/* ============ title =================  */}
                <div
                  suppressHydrationWarning
                  className={"truncate flex-1 flex-column sm:flex-initial"}
                >
                  <span
                    className="flex items-center truncate justify-start gap-1 xs:flex-wrap md:flex-nowrap"
                    style={{
                      fontSize: 14,
                    }}
                  >
                    {/* ================== priority label ============== */}
                    {notification.priority && (
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                        className={` flex gap-2 items-center h-labelComponent border-[1px] bg-inherit border-border-labelComponent rounded-sm px-[6px] py-[1px] w-fit text-label-component`}
                      >
                        <span className={`rounded-sm`}>
                          {notification.priority.Priority_Value}
                        </span>
                      </div>
                    )}

                    {/* ===================== task labels ================= */}
                    <>
                      {notification.tags.map(
                        (tag, tagIndex) =>
                          tag && (
                            <div
                              key={`notification-tag-${tagIndex}`}
                              className={`flex gap-2 items-center h-labelComponent border-[1px] bg-inherit  border-border-labelComponent rounded-sm px-[6px] py-[1px] text-label-component`}
                            >
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                {tag}
                              </span>
                            </div>
                          )
                      )}
                    </>

                    <div className={`xs:inline sm:flex gap-1 `}>
                      <span className="text-icon-dark-gray">
                        {notification.task.identifier + " "}
                      </span>
                      <span className="xs:whitespace-pre-wrap sm:whitespace-nowrap text-white-black">
                        {notification.task.title}
                      </span>
                    </div>
                  </span>
                </div>

                {/* ============ notification content =========== */}
                <div
                  suppressHydrationWarning
                  className="flex-1 truncate text-[#8E9093] flex-column sm:min-w-[160px]"
                >
                  <span
                    suppressHydrationWarning
                    className="truncate line-clamp-1 xs:max-w-[92vw] sm:max-w-full xs:whitespace-pre-wrap sm:whitespace-nowrap"
                    style={{
                      color: "#8E9093",
                      fontSize: 14,
                    }}
                  >
                    {notification.task.message}
                  </span>
                </div>
              </div>

              <>
                <span
                  className="hidden sm:block sm:min-w-[57px]"
                  suppressHydrationWarning
                  style={{
                    color: "#8E9093",
                    fontSize: 14,
                  }}
                >
                  {notification.date}
                </span>
              </>
              <div
                className={`sm:flex sm:items-center gap-[10px]  hidden min-w-[48px] ${
                  activeNotification === index ? "sm:block" : "sm:block"
                }`}
              >
                <button className="relative group">
                  <ArchiveNotificationIcon height={18} width={18} show={true} />
                </button>
                <>
                  <button
                    className={` ${
                      activeNotification === index
                        ? "sm:block relative group flex items-center gap-1"
                        : "hidden"
                    }`}
                  >
                    <Clock
                      className={`text-[${"#696b6e"}] hover:text-[#95999e] h-[${18}px] w-[${18}px]`}
                     strokeWidth={1.75}/>
                  </button>
                </>
              </div>
            </div>
            <div className="message_divider block sm:hidden"> </div>
          </>
        ))}
        </>
      )}
    </div>
  );
};

export default NotificationsList;
