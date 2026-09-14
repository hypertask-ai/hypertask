"use client";

import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { useFlag } from "@/hooks/useFlag";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { MY_TASKS_VIEWS_FLAG } from "@/lib/flags/keys";
import type { MyTasksSavedView } from "@/models/MyTasksView";
import { House, MoreHorizontal, Plus } from "lucide-react";
import { useRef, useState } from "react";

interface Props {
  views: MyTasksSavedView[];
  activeViewId: number | null;
  dirty: boolean;
  busy: boolean;
  onSelect: (viewId: number | null) => void;
  onSave: () => void;
  onReset: () => void;
  onSaveAs: (name: string) => void;
  onRename: (viewId: number, name: string) => void;
  onDelete: (viewId: number) => void;
  onSetDefault: (viewId: number) => void;
}

const MyTasksViewTabs = ({
  views,
  activeViewId,
  dirty,
  busy,
  onSelect,
  onSave,
  onReset,
  onSaveAs,
  onRename,
  onDelete,
  onSetDefault,
}: Props) => {
  const myTasksViewsEnabled = useFlag(MY_TASKS_VIEWS_FLAG);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  useClickOutside(actionsRef, () => setActionsOpen(false));
  const activeView = views.find((view) => view.id === activeViewId);

  const saveAs = () => {
    const name = window.prompt("Name this view")?.trim();
    if (name) onSaveAs(name);
  };

  const rename = () => {
    if (!activeView) return;
    const name = window.prompt("Rename view", activeView.name)?.trim();
    if (name && name !== activeView.name) onRename(activeView.id, name);
    setActionsOpen(false);
  };

  const remove = () => {
    if (!activeView || !window.confirm(`Delete “${activeView.name}”?`)) return;
    onDelete(activeView.id);
    setActionsOpen(false);
  };

  return myTasksViewsEnabled ? (
    <div className="pills-row relative flex w-full min-w-0 items-center gap-2">
      <div
        id="my-tasks-view-tabs-bar"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
      >
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`flex items-center gap-1 whitespace-nowrap rounded-[4px] px-3 py-1.5 text-dense leading-none transition-colors ${
            activeViewId === null
              ? "bg-containerBackground font-semibold text-white-black"
              : "font-medium text-header-text hover:bg-hover-active"
          }`}
        >
          All
        </button>
        {views.map((view) => {
          const active = view.id === activeViewId;
          return (
            <button
              key={view.id}
              type="button"
              title={view.name}
              onClick={() => onSelect(view.id)}
              className={`flex items-center gap-1 whitespace-nowrap rounded-[4px] px-3 py-1.5 text-dense leading-none transition-colors ${
                active
                  ? "bg-containerBackground font-semibold text-white-black"
                  : "font-medium text-header-text hover:bg-hover-active"
              }`}
            >
              {view.isDefault && <House size={14} strokeWidth={1.5} />}
              {view.name}
            </button>
          );
        })}
      </div>

      {dirty && (
        <div className="flex shrink-0 items-center gap-1 text-meta">
          <button
            type="button"
            disabled={busy}
            onClick={onReset}
            className="rounded-[4px] px-2 py-1 text-text-light-gray hover:bg-hover-active hover:text-white-black disabled:opacity-50"
          >
            Reset
          </button>
          {activeView && (
            <button
              type="button"
              disabled={busy}
              onClick={onSave}
              className="rounded-[4px] bg-shadcn-primary px-2 py-1 font-medium text-primary-foreground hover:opacity-80 disabled:opacity-50"
            >
              Save
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={saveAs}
        className={`${MOBILE_TARGET} h-7 gap-1 rounded-[4px] px-2 text-content text-text-light-gray hover:bg-hover-active hover:text-white-black disabled:opacity-50 @md:min-h-0 @md:min-w-0`}
      >
        <Plus size={14} strokeWidth={1.5} />
        <span className="hidden @md:inline">Save as view</span>
      </button>

      {activeView && (
        <div ref={actionsRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="View actions"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((open) => !open)}
            className={`${MOBILE_TARGET} h-7 w-7 rounded-[4px] text-text-light-gray hover:bg-hover-active hover:text-white-black @md:min-h-0 @md:min-w-0`}
          >
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </button>
          {actionsOpen && (
            <div className="absolute right-0 top-full z-40 mt-1 min-w-[170px] rounded-[5px] bg-modalBackground py-1 text-content shadow-md">
              <button
                type="button"
                onClick={rename}
                className="w-full px-3 py-2 text-left text-white-black hover:bg-hover-active"
              >
                Rename
              </button>
              {!activeView.isDefault && (
                <button
                  type="button"
                  onClick={() => {
                    onSetDefault(activeView.id);
                    setActionsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-white-black hover:bg-hover-active"
                >
                  Set as default
                </button>
              )}
              <button
                type="button"
                onClick={remove}
                className="w-full px-3 py-2 text-left text-destructive hover:bg-hover-active"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;
};

export default MyTasksViewTabs;
