import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
import { IProject } from "@/models/model";
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import React from "react";
import { ChevronRight } from "lucide-react";

const TitleKanbanHeader = ({ project }: { project: IProject }) => {
  const { hasUserSelectedView, resetView } = useKanbanViews(project);
  const { toggleViewsModal } = useKanbanModalStatesContext();
  const onViewClickHandler = () => {
    toggleViewsModal();
  };

  const onTitleClick = () => {
    const activeView = getViewFromProject(project);
    if (activeView && activeView.type === "Default") onViewClickHandler();
    else resetView("ResetToDefault");
  };

  return (
    <div
      className="kanban-header-title flex min-w-0 items-center gap-1 text-white-black text-subheading lg:text-heading"
      style={{ marginLeft: "8px" }}
    >
      <span
        className="truncate text-white-black font-medium text-emphasis leading-[20px] cursor-pointer"
        onClick={onTitleClick}
      >
        {project?.title ?? project?.name}
      </span>
      {hasUserSelectedView && (
        <>
          <ChevronRight size={10}  strokeWidth={1.75}/>
          <span
            onClick={onViewClickHandler}
            className="cursor-pointer font-medium text-emphasis leading-[20px]"
          >
            {hasUserSelectedView.title}
          </span>
        </>
      )}
    </div>
  );
};

export default TitleKanbanHeader;
