import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { IProject } from "@/models/model";
import React, { useState } from "react";
import { Search, X } from "lucide-react";


interface IReadOnlySearchFilter {
  onSearchChange: (keyword: string) => void;
  toggleFilter: (val: boolean) => void;
}

const ReadOnlySearchFilter = ({
  onSearchChange,
  toggleFilter,
}: IReadOnlySearchFilter) => {
  const [keyword, setKeyword] = useState("");

  const onChangeCallback = (e: any) => {
    const value = e.target.value;
    setKeyword(value);
    onSearchChange(value.trim());
  };

  const handleOutsideClickSearch = (force?: boolean) => {
    if (keyword.length === 0 || force) {
      onSearchChange("");
      setKeyword("");
      toggleFilter(false);
    }
  };
  useClickOutside(null, handleOutsideClickSearch, "readonly-search-tasks-filter-input");

  return (
    <div
      className="flex gap-2 bg-inherit outline-none p-2 font-normal text-meta
    text-header-text rounded border-thin border-header-text items-center justify-center"
    >
      <Search size={14}  strokeWidth={1.75}/>
      <input
        className="outline-none bg-transparent text-white-black"
        onChange={onChangeCallback}
        id="readonly-search-tasks-filter-input"
        value={keyword}
        autoFocus
        placeholder={`Find in view...`}
        onKeyDown={(e: any) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.target.blur();
            handleOutsideClickSearch(true);
          }
        }}
      />

      <X
        className={`${keyword.length > 0 ? "" : "opacity-0"} cursor-pointer`}
        onClick={() => handleOutsideClickSearch(true)}
        size={16}
       strokeWidth={1.75}/>
    </div>
  );
};

export default ReadOnlySearchFilter;
