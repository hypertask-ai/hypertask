"use client";

import { formatDistanceToNow } from "date-fns";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import toast from "react-hot-toast";
import OptionPickerModal from "@/components/Modals/OptionPicker";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7309_PAGES_SCREENS_FLAG } from "@/lib/flags/definitions/htpr-7309-pages-screens";
import { HTPR_7298_STANDALONE_PAGES_FLAG } from "@/lib/flags/definitions/htpr-7298-standalone-pages";
import { listBrowserPages, changePageLink, type BrowserPage } from "@/lib/pages/browser";

import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { createPageReturnHref } from "@/lib/navigation/pageReturn";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useTaskPages } from "./TaskPagesContext";

const DescriptionPages = () => {
  const router = useRouter();
  const { editMode, currentTask } = useTaskContext();
  const { pages, loading, hasPages, createAndOpenPage, refetch } = useTaskPages();
  const screens = useFlag(HTPR_7309_PAGES_SCREENS_FLAG);
  const standalone = useFlag(HTPR_7298_STANDALONE_PAGES_FLAG);
  const pagesEnabled = screens && standalone;
  const [pageOptions, setPageOptions] = useState<BrowserPage[] | null>(null);
  const openLinkPicker = useCallback(async () => {
    try {
      setPageOptions(await listBrowserPages());
    } catch {
      toast.error("Could not load pages");
    }
  }, []);
  useEffect(() => {
    if (!pagesEnabled) return;
    const link = () => { void openLinkPicker(); };
    const create = () => { void createAndOpenPage(); };
    window.addEventListener("pages-link-page", link);
    window.addEventListener("pages-new-page", create);
    return () => {
      window.removeEventListener("pages-link-page", link);
      window.removeEventListener("pages-new-page", create);
    };
  }, [createAndOpenPage, openLinkPicker, pagesEnabled]);
  const linkPage = async (publicId: string) => {
    if (!currentTask) return;
    setPageOptions(null);
    try {
      await changePageLink({ publicId, taskId: currentTask.id });
      refetch();
      toast.success("Page linked");
    } catch {
      toast.error("Could not link page");
    }
  };

  const openPage = (event: MouseEvent<HTMLAnchorElement>, publicId: string) => {
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

  const linkPicker = pageOptions && <OptionPickerModal header="Link page to ticket"
        options={pageOptions.filter((page) => !pages.some((linked) => linked.id === page.id)).map((page) => ({ id: page.publicId, label: page.title || "Untitled", hint: page.project.title }))}
        onClose={() => setPageOptions(null)}
        onSelect={(option) => { if (typeof option.id === "string") void linkPage(option.id); }} />;

  if (
    loading ||
    editMode === "description" ||
    editMode === "description-ai"
  ) {
    return null;
  }

  if (!hasPages) return linkPicker;

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        taskDetailSpacing.mobile.descriptionContainer
      )}
    >
      {linkPicker}
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
        {pagesEnabled && <button type="button" onClick={() => void openLinkPicker()}
          className="min-h-11 text-meta hover:text-white-black">+ Link page</button>}
      </div>
    </div>
  );
};

export default DescriptionPages;
