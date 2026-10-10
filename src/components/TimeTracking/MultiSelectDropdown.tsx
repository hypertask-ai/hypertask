"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

const MultiSelectDropdown = ({
  ariaLabel,
  options,
  selected,
  onChange,
  allLabel = "All",
  disabled = false,
}: {
  ariaLabel: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  allLabel?: string;
  disabled?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const selectedSet = new Set(selected);
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label ?? "1 selected"
        : `${selected.length} selected`;

  const toggleValue = (value: string) => {
    onChange(
      selectedSet.has(value)
        ? selected.filter((candidate) => candidate !== value)
        : [...selected, value]
    );
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-full min-w-0 items-center justify-between gap-2 border-x-0 border-t-0 border-b border-border bg-containerBackground px-3 text-left text-[14px] text-white-black outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-text-light-gray" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-full overflow-y-auto rounded-[5px] bg-modalBackground py-1 shadow-md"
        >
          <label className="flex h-9 cursor-pointer items-center gap-2 px-3 text-[14px] hover:bg-hover-active">
            <input
              type="checkbox"
              checked={selected.length === 0}
              onChange={() => onChange([])}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
                  event.preventDefault();
                  onChange([]);
                }
              }}
              className="h-4 w-4 accent-hypertasks-purple"
            />
            <span>{allLabel}</span>
          </label>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex h-9 cursor-pointer items-center gap-2 px-3 text-[14px] hover:bg-hover-active"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(option.value)}
                onChange={() => toggleValue(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    toggleValue(option.value);
                  }
                }}
                className="h-4 w-4 accent-hypertasks-purple"
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default MultiSelectDropdown;
