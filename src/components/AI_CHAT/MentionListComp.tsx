import { MentionItem } from "@/models/model";
import { cn } from "@/utils/undoActions/helperFuncs";
import React, { HTMLAttributes } from "react";

interface MentionListProps extends HTMLAttributes<HTMLElement> {
  isLoading: boolean;
  hasItems: boolean;
  noResults: boolean;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  ignoreItems: string[];
  items: MentionItem[];
  selectItem: (index: number) => void;
  id: string;
}

export function MentionListRows({
  isLoading,
  hasItems,
  noResults,
  selectedIndex,
  setSelectedIndex,
  ignoreItems,
  items,
  selectItem,
  id,
  className,
}: MentionListProps) {
  return (
    <div
      style={{ color: "#777C85", WebkitOverflowScrolling: "touch" }}
      className={cn(
        "mention_container bg-modalBackground text-content w-[18rem] max-h-[14rem] border-border-self-comment no-scrollbar scrollbar-none overflow-y-auto overscroll-contain touch-pan-y touch-manipulation p-2 rounded",
        className
      )}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      id={id}
    >
      {isLoading ? (
        <div className="item flex items-center gap-2 p-3">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-600" />
          <span>Loading mentions...</span>
        </div>
      ) : hasItems && !noResults ? (
        items.map((item: MentionItem, index: number) => (
          <React.Fragment key={index}>
            {ignoreItems.includes(item?.type) && (item.count ?? 0) > 0 ? (
              <h1
                className={`text-white-black mention_heading ${
                  index === 0 ? "mb-2" : "my-2"
                }`}
                id={`mention-button-${index}`}
              >
                {item.name}
              </h1>
            ) : (
              !ignoreItems.includes(item.type) && (
                <button
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`item ${
                    index === selectedIndex
                      ? "bg-[#ececec] dark:bg-active-modal-element"
                      : ""
                  }`}
                  onClick={() => selectItem(index)}
                  id={`mention-button-${index}`}
                >
                  {(item?.type === "name" || item?.type === "agent") && (
                    <span>{item?.name}</span>
                  )}
                  {item?.type === "task" && (
                    <div className="block space-x-1 gap-1">
                      <span className="text-icon-dark-gray whitespace-nowrap">
                        {item?.ticketNumber}
                      </span>
                      <span>{item?.name}</span>
                      {item?.status === "Archive" && (
                        <span className="text-white-black">(archived)</span>
                      )}
                    </div>
                  )}
                  {item?.type === "project" && (
                    <div className="block space-x-1 gap-1">
                      {item.uniqueIdentifier &&
                        item.uniqueIdentifier.length > 0 && (
                          <span className="text-icon-dark-gray whitespace-nowrap">
                            {item.uniqueIdentifier}
                          </span>
                        )}
                      <span>{item.name}</span>
                    </div>
                  )}
                </button>
              )
            )}
          </React.Fragment>
        ))
      ) : (
        <div className="item p-3 text-gray-500">No results found</div>
      )}
    </div>
  );
}
