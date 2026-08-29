import {
  INotification,
  ISplitTitle,
} from "@/models/InteractiveOnboarding/model";
import React from "react";

type Props = {
  notifications: INotification[];
  splitTitles: ISplitTitle[];
};

const SplitTitle = ({ notifications, splitTitles }: Props) => {
  return (
    <div className="hidden sm:flex items-baseline  sm:gap-8 w-100  h-full  inbox_title overflow-x-auto scrollbar-none no-scrollbar">
      <div className="flex flex-wrap grow">
        <>
          {notifications.length > 0 ? (
            splitTitles.map((splitTitle: ISplitTitle, index: number) => (
              <div
                key={`splitTitle-${index}`}
                className={
                  "relative group sm:h-8 justify-start whitespace-nowrap footer_tags_main items-center sm:px-[10px] lg:px-[15px] text-subheading  flex  gap-1 "
                }
              >
                <div className="flex items-baseline gap-1">
                  <h2
                    className={`footer_tags ${
                      !splitTitle.active
                        ? "text-text-light-gray"
                        : "text-white-black"
                    }`}
                  >
                    {splitTitle.title}
                  </h2>
                  <p className="font-normal footer_tags text-meta text-text-light-gray">
                    {index === 0 ? notifications.length : splitTitle.count}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <></>
          )}
        </>
      </div>
    </div>
  );
};

export default SplitTitle;
