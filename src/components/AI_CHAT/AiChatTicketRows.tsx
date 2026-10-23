"use client";

import { useState } from "react";
import type { ChatTicketGroup } from "@/models/model";
import { TableTicketCell, TableTitleCell, TableStatusCell } from "@/components/PageComponents/Kanban/TableView/TableTaskRow";
import { renderAssigneeAvatars, LABEL_CLASS } from "@/components/PageComponents/Kanban/TableView/tableViewShared";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";

export default function AiChatTicketRows({ groups, onNavigate }: { groups: ChatTicketGroup[]; onNavigate: (url: string) => void }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  return (
    <div className="my-2 w-full min-w-0 space-y-3">
      {groups.map((group, index) => {
        const visible = expanded.has(index) ? group.tasks : group.tasks.slice(0, 5);
        const hidden = group.tasks.length - visible.length;
        return (
          <div key={index} className="min-w-0">
            {group.label && <SplitTitle tab={{ idx: index, project: group.label, length: group.tasks.length, hasUnseen: false }} isSelected={false} onClick={undefined} />}
            <ul className="m-0 list-none !p-0">
              {visible.map((task) => (
                <li key={task.id} className="min-w-0 border-b border-border-light-gray-thin last:border-b-0">
                  <a href={task.url} onClick={(event) => {
                    event.stopPropagation();
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onNavigate(task.url);
                  }} className="grid grid-cols-[78px_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 rounded-md px-1 py-2 text-dense !no-underline hover:bg-hover-active focus-visible:bg-active-elementBg">
                    <TableTicketCell ticket={task.ticketNumber || `#${task.uniqueIndex}`} className="overflow-hidden text-ellipsis text-[11px]" />
                    <span className="col-span-2 min-w-0"><TableTitleCell task={task} compact /></span>
                    <span className="flex min-w-0 items-center">{renderAssigneeAvatars(task)}</span>
                    <TableStatusCell section={task.section} />
                    {task.priority && <PriorityLabelComponent priority={task.priority} flexBasis={false} fontSize={11} fontWeight={500} className={LABEL_CLASS} />}
                  </a>
                </li>
              ))}
              {hidden > 0 && (
                <li>
                  <button type="button" onClick={() => setExpanded((previous) => new Set(previous).add(index))} className="cursor-pointer rounded-md px-[20px] py-[8px] text-dense text-text-light-gray hover:bg-hover-active" aria-label={`Show ${hidden} more${group.label ? ` in ${group.label}` : ""}`}>
                    +{hidden} more
                  </button>
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
