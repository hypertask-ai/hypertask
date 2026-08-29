"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import { IoIosArrowDown } from "react-icons/io";

import { summaryTeaser } from "@/utils/summaryTeaser";

const CommentTldr = ({ summary }: { summary: string }) => {
  const [open, setOpen] = useState(false);
  const teaser = summaryTeaser(summary);

  if (!summary.trim()) return null;

  return (
    <div className="mb-2 border-b border-light-black-border-1 pb-2 text-[13px] italic text-text-light-gray">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="group flex w-full min-w-0 items-center gap-1 bg-transparent text-left"
      >
        <span className="shrink-0 text-[11px] font-medium not-italic">TL;DR</span>
        {!open && <span className="line-clamp-1 min-w-0 flex-1">{teaser}</span>}
        <IoIosArrowDown
          aria-hidden="true"
          className={`shrink-0 transition-transform ${
            open
              ? "rotate-180 opacity-100"
              : "opacity-0 group-hover:opacity-100"
          }`}
          size={14}
        />
      </button>
      {open && (
        <div className="mt-1 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:m-0 [&_ul]:list-disc [&_ul]:pl-5">
          <Markdown>{summary}</Markdown>
        </div>
      )}
    </div>
  );
};

export default CommentTldr;
