"use client";

import { formatDistanceToNow } from "date-fns";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { createPageReturnHref } from "@/lib/navigation/pageReturn";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useTaskPages } from "./TaskPagesContext";

const DescriptionPages = () => {
  const router = useRouter();
  const { editMode, currentTask } = useTaskContext();
  const { pages, loading, hasPages, createAndOpenPage } = useTaskPages();

  const openPage = (event: MouseEvent<HTMLAnchorElement>, publicId: string) => {
    // Keep modified clicks as ordinary links. A new tab has no task entry to
    // return through, so its Page control intentionally uses the safe fallback.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !currentTask
    ) {
      return;
    }

    event.preventDefault();
    const taskHref = `/detail/project-${currentTask.projectId}/${currentTask.uniqueIndex}`;
    const pageHref = createPageReturnHref({
      pageHref: `/page/${publicId}`,
      taskHref,
      sourceHref: window.location.href,
      currentOrigin: window.location.origin,
      storage: window.sessionStorage,
      runtime: window,
      nonce: window.crypto.randomUUID(),
    });
    router.push(pageHref);
  };

  if (
    loading ||
    !hasPages ||
    editMode === "description" ||
    editMode === "description-ai"
  ) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        taskDetailSpacing.mobile.descriptionContainer
      )}
    >
      <span className="text-[#8E9093] text-meta font-normal mt-3">
        Pages ({pages.length})
      </span>

      {pages.map((page) => (
        <div
          key={page.id}
          className="inline-flex gap-2 items-center w-full"
        >
          <FileText
            className="text-white-black min-w-fit mt-[2px] align-top justify-self-start"
            size={12}
            color="#696b6e"
            strokeWidth={1.75}
          />
          <Link
            href={`/page/${page.publicId}`}
            onClick={(event) => openPage(event, page.publicId)}
            className="w-full block text-meta text-[#8E9093] font-medium items-start justify-normal group hover:underline cursor-pointer"
          >
            <span className="text-white-black group-hover:underline w-fit">
              {page.title}
            </span>
            {page.updatedAt && (
              <span className="w-fit text-nowrap font-normal">
                &nbsp;· edited {formatDistanceToNow(new Date(page.updatedAt))} ago
              </span>
            )}
          </Link>
        </div>
      ))}

      <div className="flex items-center text-text-light-gray text-meta justify-between">
        <span
          onClick={() => void createAndOpenPage()}
          className="w-fit inline-flex items-center hover:text-white-black mt-2 mb-3 group cursor-pointer relative"
        >
          <Plus size={8} className="mr-1" strokeWidth={1.75} />
          New page
        </span>
      </div>
    </div>
  );
};

export default DescriptionPages;
