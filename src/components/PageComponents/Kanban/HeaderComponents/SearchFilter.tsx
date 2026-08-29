import { IProject } from "@/models/model";
import { boardSearchAtom } from "@/store";
import React from "react";
import { Search, X } from "lucide-react";

import { useRecoilState } from "@/lib/state";

interface ISearchFilter {
  project: IProject;
  toggleFilter: (val: boolean) => void;
}

const SearchFilter = ({ project, toggleFilter }: ISearchFilter) => {
  // Keyword lives in Recoil so it survives navigating into a task and back.
  // The board filters at render off this value (see Homepage); nothing is
  // baked into the query cache here.
  const [boardSearch, setBoardSearch] = useRecoilState(boardSearchAtom);
  const keyword = boardSearch.projectId === project.id ? boardSearch.keyword : "";

  const onChangeCallback = (e: any) => {
    setBoardSearch((s) => ({
      ...s,
      open: true,
      keyword: e.target.value,
      projectId: project.id,
    }));
  };

  // Clicking a task leaves the filter in place; Escape and the X both close
  // it, so the whole search is reachable from the keyboard alone.
  const dismissSearch = () => {
    setBoardSearch({ open: false, keyword: "", projectId: null });
    toggleFilter(false);
  };

  return (
    <div
      className="flex gap-2 bg-inherit outline-none p-2 font-normal text-meta
    text-header-text rounded border-thin border-header-text items-center justify-center"
    >
      <Search size={14}  strokeWidth={1.75}/>
      <input
        className="outline-none bg-transparent text-white-black"
        onChange={onChangeCallback}
        id="search-tasks-filter-input"
        value={keyword}
        placeholder={`Find in view...`}
        onKeyDown={(e: any) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.target.blur();
            dismissSearch();
          }
        }}
      />

      <X className="cursor-pointer" onClick={dismissSearch} size={16}  strokeWidth={1.75}/>
    </div>
  );
};

export default SearchFilter;
