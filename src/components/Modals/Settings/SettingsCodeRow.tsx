"use client";

import { useState } from "react";
import toast from "react-hot-toast";

const SettingsCodeRow = ({
  copyValue,
  value,
}: {
  copyValue?: string;
  value: string;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(copyValue ?? value);
    setCopied(true);
    toast.success("Copied to clipboard");
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-start gap-3 rounded-[5px] bg-cardBackground px-3 py-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-meta font-medium leading-relaxed text-white-black">
        {value}
      </code>
      <button
        className="shrink-0 rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
        onClick={copy}
        type="button"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
};

export default SettingsCodeRow;
