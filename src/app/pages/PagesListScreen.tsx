"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { FileText, Plus, Search } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { z } from "zod";

import OptionPickerModal from "@/components/Modals/OptionPicker";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { listBrowserPages } from "@/lib/pages/browser";
import { useRecoilValue } from "@/lib/state";
import type { IProject, IUser } from "@/models/model";
import { appShellRailAtom, currentProjectAtom, showCommandsAtom } from "@/store";

const HypertasksCommands = dynamic(() => import("@/components/commands"), { ssr: false });
const createdPageSchema = z.object({ page: z.object({ publicId: z.string() }) });

export default function PagesListScreen({ currentUser }: { currentUser: IUser }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentProject = useRecoilValue(currentProjectAtom);
  const showRail = useRecoilValue(appShellRailAtom);
  const isMobile = useContext(MobileViewContext);
  const showCommands = useRecoilValue(showCommandsAtom);
  const { data: projects = [] } = useGetAllProjectsMinimal(["projectsAllMinimal"]);
  const availableProjects: IProject[] = Array.isArray(projects) ? projects : [];
  const projectId = Number(searchParams?.get("project_id")) || currentProject?.id;
  const requestedProject = searchParams?.get("project_id");
  const [boardOnly, setBoardOnly] = useState(Boolean(searchParams?.get("project_id")));
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [pickingBoard, setPickingBoard] = useState(false);
  const creating = useRef(false);
  const requestedNew = useRef(false);
  const railOn = showRail && !isMobile;
  const pagesQuery = useQuery({
    queryKey: ["browserPages", boardOnly ? projectId : null, archived, search],
    queryFn: ({ signal }) => listBrowserPages({ projectId: boardOnly ? projectId : undefined, archived, query: search, signal }),
  });

  useEffect(() => setBoardOnly(Boolean(requestedProject)), [requestedProject]);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const createPage = useCallback(async (boardId: number) => {
    if (creating.current) return;
    creating.current = true;
    setPickingBoard(false);
    try {
      const response = await fetch("/api/pages/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: boardId, title: "Untitled", content: "", content_type: "html" }),
      });
      if (!response.ok) throw new Error("Could not create page");
      const result = createdPageSchema.parse(await response.json());
      router.push(`/page/${result.page.publicId}`);
    } catch {
      toast.error("Could not create page");
    } finally {
      creating.current = false;
    }
  }, [router]);

  const newPage = useCallback(() => {
    if (boardOnly && projectId) void createPage(projectId);
    else setPickingBoard(true);
  }, [boardOnly, createPage, projectId]);

  useEffect(() => {
    if (searchParams?.get("new") !== "1") { requestedNew.current = false; return; }
    if (requestedNew.current) return;
    requestedNew.current = true;
    newPage();
    router.replace(boardOnly && projectId ? `/pages?project_id=${projectId}` : "/pages");
  }, [boardOnly, newPage, projectId, router, searchParams]);

  return (
    <>
      {railOn && <AppShellRail variant="global" currentUser={currentUser} />}
      {showCommands.show && <HypertasksCommands />}
      {pickingBoard && (
        <OptionPickerModal
          header="New page: choose board"
          options={availableProjects.map((project) => ({ id: project.id, label: project.title || "Untitled board" }))}
          onClose={() => setPickingBoard(false)}
          onSelect={(option) => { if (typeof option.id === "number") void createPage(option.id); }}
        />
      )}
      <main className={railOn ? "pl-[var(--app-shell-rail-w,48px)]" : ""} aria-label="Pages">
        <div className="flex min-h-screen w-full justify-center bg-pageBackground text-white-black">
          <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col items-start gap-4 bg-containerBackground px-4 pb-24 pt-24 md:px-8 lg:px-16 lg:pt-9">
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="flex gap-5" role="tablist" aria-label="Page status">
                {[false, true].map((value) => (
                  <button key={String(value)} type="button" role="tab" aria-selected={archived === value} onClick={() => setArchived(value)}
                    className={`border-b-2 pb-1 text-subheading ${archived === value ? "border-selected-item-border font-bold" : "border-transparent text-text-light-gray"}`}>
                    {value ? "Archived pages" : "Pages"}{archived === value && pagesQuery.data ? ` ${pagesQuery.data.length}` : ""}
                  </button>
                ))}
              </div>
              <button type="button" onClick={newPage} className="inline-flex min-h-11 items-center gap-1 text-content text-text-light-gray hover:text-white-black">
                <Plus size={14} strokeWidth={1.75} /> New page
              </button>
            </div>
            <div className="flex w-full flex-wrap items-center gap-3 text-meta">
              <button type="button" disabled={!projectId} onClick={() => setBoardOnly(true)} aria-pressed={boardOnly}
                className={`min-h-11 disabled:opacity-50 ${boardOnly ? "font-medium" : "text-text-light-gray"}`}>This board</button>
              <button type="button" onClick={() => setBoardOnly(false)} aria-pressed={!boardOnly}
                className={`min-h-11 ${!boardOnly ? "font-medium" : "text-text-light-gray"}`}>All boards</button>
              <label className="flex min-w-36 flex-1 items-center gap-2 rounded-[5px] bg-modalBackground px-3">
                <Search size={14} className="shrink-0 text-icon-dark-gray" />
                <input aria-label="Search pages" placeholder="Search pages…" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)}
                  className="min-h-11 min-w-0 flex-1 border-0 bg-transparent text-content outline-none placeholder:text-text-light-gray" />
              </label>
            </div>
            {pagesQuery.isPending && <p role="status" className="text-content text-text-light-gray">Loading pages…</p>}
            {pagesQuery.isError && <div role="alert" className="text-content"><p>Could not load pages.</p><button type="button" onClick={() => void pagesQuery.refetch()} className="min-h-11 underline">Try again</button></div>}
            {pagesQuery.data?.length === 0 && <p className="text-content text-text-light-gray">No pages found.</p>}
            <div className="w-full" aria-label="Page list">
              {pagesQuery.data?.map((page) => (
                <div key={page.id} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 border-b border-light-black-border-1 py-3 text-content">
                  <span className="w-36 shrink-0 truncate text-meta text-text-light-gray">{page.project.title}</span>
                  <Link href={`/page/${page.publicId}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 hover:underline">
                    <FileText size={14} strokeWidth={1.75} className="shrink-0 text-icon-dark-gray" />
                    <span className="truncate">{page.title || "Untitled"}</span>
                  </Link>
                  <span className="max-w-48 truncate text-meta text-text-light-gray" title={page.linkedTasks.map((task) => task.ticketNumber ?? task.title).join(", ")}>{page.linkedTasks.length} linked tickets</span>
                  <span className="text-meta text-text-light-gray">{page.updatedAt ? `edited ${formatDistanceToNow(new Date(page.updatedAt))} ago` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
