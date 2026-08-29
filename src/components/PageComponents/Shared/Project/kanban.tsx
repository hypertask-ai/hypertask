"use client";
import { IProject, ISection } from "@/models/model";
import { currentProjectAtom, isXScrollOnKanbanAtom } from "@/store";
import { useRecoilState, useSetRecoilState } from "@/lib/state";
import { useContext, useEffect, useRef, useState, useMemo } from "react";
import ReadOnlyHeader from "./header";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { ReadOnlySection } from "./section";
import { getAppliedSearchedTasks } from "@/utils/helperFunctions/Views/SearchFilterHelperFunction";
import { useRouter } from "next/navigation";

const ReadOnlyKanban = ({ project, inviteKey }: { project: IProject, inviteKey: string }) => {
  const [__, setRecoilCurrentProject] = useRecoilState(currentProjectAtom);
  const _mbl = useContext(MobileViewContext);
  const [searchKeyword, setSearchKeyword] = useState("");
  const router = useRouter();

  useEffect(() => {
    setRecoilCurrentProject(project);
  }, [project, setRecoilCurrentProject]);

  const setHasHorizontalScrollbar = useSetRecoilState(isXScrollOnKanbanAtom);
  const kanbanContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Board name first, bullet separator; re-run on board switch.
    const title = `${project?.title} • Hypertask`;
    document.title = title;
  }, [project?.title]);

  useEffect(() => {
    const checkScrollbar = () => {
      if (kanbanContainerRef.current) {
        const hasScroll =
          kanbanContainerRef.current.scrollWidth >
          kanbanContainerRef.current.clientWidth;
        setHasHorizontalScrollbar(hasScroll);
      }
    };

    checkScrollbar();

    const resizeObserver = new ResizeObserver(() => {
      checkScrollbar();
    });

    if (kanbanContainerRef.current) {
      resizeObserver.observe(kanbanContainerRef.current);
    }

    window.addEventListener("resize", checkScrollbar);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkScrollbar);
    };
  }, []);

  // Filter sections based on search keyword
  const filteredSections = useMemo(() => {
    if (searchKeyword && searchKeyword.length > 0) {
      return getAppliedSearchedTasks(project.sections || [], searchKeyword);
    }
    return project.sections || [];
  }, [project.sections, searchKeyword]);

  const handleSearchChange = (keyword: string) => {
    setSearchKeyword(keyword);
  };

  const routeToInvitePage = () => {
    router.push(`/invite?key=${inviteKey}&project=${project.name}&id=${project.id}`);
  };

  return (
    <>
      <div id="kanban-page-container" className=" flex flex-col gap-[16px]">
        <div className="h-[48px] relative">
          <ReadOnlyHeader
            project={project}
            searchKeyword={searchKeyword}
            onSearchChange={handleSearchChange}
            routeToInvitePage={routeToInvitePage}
          />
        </div>

        <div
          ref={kanbanContainerRef}
          id="kanban-sections-container"
          className="bg-pageBackground homepage-container-tag flex-col gap-4 flex items-center"
        >
          <div
            id="sectionsContainer"
            className={`
            ${
              _mbl
                ? "flex gap-[12px] max-w-[98%] min-w-[90%]"
                : `gap-[16px] w-[97%] scrollbar-none  m-auto grid grid-flow-col auto-cols-[minmax(322px,535px)] ${
                    filteredSections && filteredSections.length === 3
                      ? "[justify-content:safe_center]"
                      : "justify-start"
                  }`
            } sectionsContainer
            `}
          >
            {filteredSections.map((section: ISection, index: number) => (
              <ReadOnlySection
                active={false}
                index={index}
                key={`section-${index}`}
                section={section}
                currentProject={project}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default ReadOnlyKanban;
