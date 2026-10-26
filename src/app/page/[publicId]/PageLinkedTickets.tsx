"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_7309_PAGES_SCREENS_FLAG } from "@/lib/flags/keys";
import SearchTasks from "@/components/Modals/commands/searchTasks";
import { changePageLink, type LinkedPageTicket } from "@/lib/pages/browser";
import type { ITask } from "@/models/model";

export default function PageLinkedTickets({
  publicId,
  tickets,
  beforeNavigate,
}: {
  publicId: string;
  tickets: LinkedPageTicket[];
  beforeNavigate: () => Promise<void>;
}) {
  const router = useRouter();
  const pagesEnabled = useFlag(HTPR_7309_PAGES_SCREENS_FLAG);
  const [picking, setPicking] = useState(false);
  const [changing, setChanging] = useState(false);
  const openPicker = useCallback(() => setPicking(true), []);

  useEffect(() => {
    window.addEventListener("pages-link-ticket", openPicker);
    return () => window.removeEventListener("pages-link-ticket", openPicker);
  }, [openPicker]);

  const linkTicket = async (task: ITask) => {
    try {
      await changePageLink({ publicId, taskId: task.id });
      setPicking(false);
      router.refresh();
      toast.success("Ticket linked");
    } catch {
      toast.error("Could not link ticket");
    }
  };

  const unlinkTicket = async (taskId: number) => {
    if (changing) return;
    setChanging(true);
    try {
      await changePageLink({ publicId, taskId, remove: true });
      router.refresh();
      toast.success("Ticket unlinked");
    } catch {
      toast.error("Could not unlink ticket");
    } finally {
      setChanging(false);
    }
  };

  return pagesEnabled ? (
    <section aria-label="Linked tickets" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-text-light-gray">
      <span>Linked tickets ({tickets.length})</span>
      {tickets.map((task) => (
        <span key={task.id} className="inline-flex min-w-0 max-w-full items-center gap-2">
          <Link href={`/detail/project-${task.projectId}/${task.uniqueIndex}`}
            onClick={(event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              void beforeNavigate().then(() => router.push(`/detail/project-${task.projectId}/${task.uniqueIndex}`));
            }} className="min-h-11 truncate py-3 hover:text-white-black hover:underline">
            {task.ticketNumber ?? task.title}
          </Link>
          <button type="button" aria-label={`Unlink ${task.ticketNumber ?? task.title}`} disabled={changing}
            onClick={() => void unlinkTicket(task.id)} className="min-h-11 hover:text-white-black disabled:opacity-50">Unlink</button>
        </span>
      ))}
      <button type="button" onClick={openPicker} className="min-h-11 hover:text-white-black">+ Link ticket</button>
      {picking && <SearchTasks header="Link ticket to page" closeHandler={() => setPicking(false)} onSelect={linkTicket} />}
    </section>
  ) : null;
}
