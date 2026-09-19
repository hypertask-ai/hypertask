"use client";

import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { useFlag } from "@/hooks/useFlag";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { MY_TASKS_VIEWS_FLAG } from "@/lib/flags/keys";
import { MY_TASKS_OVERDUE_BADGES_FLAG } from "@/lib/flags/keys";
import type { MyTasksSavedView } from "@/models/MyTasksView";
import { House, MoreHorizontal, Plus, Settings2 } from "lucide-react";
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
  overdueAll?: number;
  overdueByViewId?: Record<number, number>;
  boardToolbar?: boolean;
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
  overdueAll = 0,
  overdueByViewId = {},
  boardToolbar = false,
}: Props) => {
  const myTasksViewsEnabled = useFlag(MY_TASKS_VIEWS_FLAG);
  const overdueBadgesEnabled = useFlag(MY_TASKS_OVERDUE_BADGES_FLAG);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  useClickOutside(actionsRef, () => setActionsOpen(false));
  const activeView = views.find((view) => view.id === activeViewId);
  const overdueBadge = (count: number) =>
    overdueBadgesEnabled && count > 0 ? (
      <span
        data-htpr-6459-my-tasks-overdue-badges=""
        className="text-micro font-semibold text-destructive"
      >
        {count}
      </span>
    ) : null;
  const overdueLabel = (name: string, count: number) =>
    overdueBadgesEnabled && count > 0 ? `${name}, ${count} overdue` : undefined;

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

  const activeViewActions = activeView ? (
    <>
      <button
        type="button"
        onClick={rename}
        className="w-full px-3 py-2 text-left text-white-black hover:bg-hover-active"
      >
        Rename
      </button>
      {!activeView.isDefault ? (
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
      ) : null}
      <button
        type="button"
        onClick={remove}
        className="w-full px-3 py-2 text-left text-destructive hover:bg-hover-active"
      >
        Delete
      </button>
    </>
  ) : null;

  if (myTasksViewsEnabled && boardToolbar) {
    return (
      <div className="pills-row relative flex min-w-0 flex-1 items-start">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <BoardViewButton
            active={activeViewId === null}
            label="All"
            count={overdueBadgesEnabled ? overdueAll : 0}
            onClick={() => onSelect(null)}
          />
          {views.map((view) => (
            <BoardViewButton
              key={view.id}
              active={view.id === activeViewId}
              label={view.name}
              count={overdueBadgesEnabled ? (overdueByViewId[view.id] ?? 0) : 0}
              isDefault={view.isDefault}
              onClick={() => onSelect(view.id)}
            />
          ))}
          <div ref={actionsRef} className="relative flex h-8 items-center">
            <button
              type="button"
              aria-label="Manage views"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((open) => !open)}
              className="group relative flex size-8 items-center justify-center text-text-light-gray hover:text-white-black"
            >
              <Settings2 size={14} strokeWidth={1.75} />
            </button>
            {actionsOpen && (
              <div className="absolute left-0 top-full z-40 mt-1 min-w-[180px] rounded-[5px] bg-modalBackground py-1 text-content shadow-md">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    saveAs();
                    setActionsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-white-black hover:bg-hover-active disabled:opacity-50"
                >
                  Save as new view
                </button>
                {activeViewActions}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return myTasksViewsEnabled ? (
    <div className="pills-row relative flex w-full min-w-0 items-center gap-2">
      <div
        id="my-tasks-view-tabs-bar"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
      >
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-label={overdueLabel("All", overdueAll)}
          className={`flex items-center gap-1 whitespace-nowrap rounded-[4px] px-3 py-1.5 text-dense leading-none transition-colors ${
            activeViewId === null
              ? "bg-containerBackground font-semibold text-white-black"
              : "font-medium text-header-text hover:bg-hover-active"
          }`}
        >
          All
          {overdueBadge(overdueAll)}
        </button>
        {views.map((view) => {
          const active = view.id === activeViewId;
          const overdueCount = overdueByViewId[view.id] ?? 0;
          return (
            <button
              key={view.id}
              type="button"
              title={view.name}
              onClick={() => onSelect(view.id)}
              aria-label={overdueLabel(view.name, overdueCount)}
              className={`flex items-center gap-1 whitespace-nowrap rounded-[4px] px-3 py-1.5 text-dense leading-none transition-colors ${
                active
                  ? "bg-containerBackground font-semibold text-white-black"
                  : "font-medium text-header-text hover:bg-hover-active"
              }`}
            >
              {view.isDefault && <House size={14} strokeWidth={1.5} />}
              {view.name}
              {overdueBadge(overdueCount)}
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
              {activeViewActions}
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;
};

const BoardViewButton = ({
  active,
  count,
  isDefault = false,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  isDefault?: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    title={label}
    onClick={onClick}
    className={`relative flex h-8 max-w-full min-w-0 items-center gap-1 whitespace-nowrap pr-4 text-content transition-opacity ${
      active
        ? "font-semibold text-white-black"
        : "text-text-light-gray opacity-90 hover:opacity-100"
    }`}
  >
    {isDefault ? <House size={13} strokeWidth={1.75} className="shrink-0" /> : null}
    <span className="max-w-[min(18rem,calc(100vw-8rem))] truncate">{label}</span>
    {count > 0 ? (
      <span className="text-micro font-semibold text-destructive">{count}</span>
    ) : null}
  </button>
);

export default MyTasksViewTabs;
