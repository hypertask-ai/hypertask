"use client";

import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import { useRecoilValue } from "@/lib/state";
import type { CalendarSavedView } from "@/models/Calendar/model";
import { currentUserAtom } from "@/store";
import type { ViewVisibility } from "@prisma/client";
import { ArrowLeft, Lock, Settings, Trash2, X } from "lucide-react";
import { useState, type ComponentProps, type KeyboardEvent } from "react";
import toast from "react-hot-toast";
import { ModalBody } from "reactstrap";

const handleRowKeyDown = (
  event: KeyboardEvent<HTMLLIElement>,
  action: () => void,
) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
};

type CalendarViewRowProps = Omit<
  ComponentProps<typeof ModalRowElementContainer>,
  "onClick" | "onKeyDown" | "tabIndex"
> & { onClick: () => void };

const CalendarViewRow = ({
  onClick,
  className,
  ...props
}: CalendarViewRowProps) => (
  <ModalRowElementContainer
    {...props}
    role="button"
    onClick={onClick}
    tabIndex={0}
    onKeyDown={(event) => handleRowKeyDown(event, onClick)}
    className={`focus:bg-active-modal-element focus:outline-none ${
      className ?? ""
    }`}
  />
);

const CalendarViewsModal = ({
  mode,
  toggle,
}: {
  mode: "save" | "manage";
  toggle: () => void;
}) => {
  const {
    appliedCalendarViewId,
    calendarViews,
    deleteCalendarView,
    everythingTitle,
    renameCalendarView,
    renameEverything,
    resetCalendarView,
    resetEverything,
    saveCalendarView,
  } = useCalendarContext();
  const currentUser = useRecoilValue(currentUserAtom);
  const appliedView = calendarViews.find(
    (view) => view.id === appliedCalendarViewId,
  );
  const [selectedView, setSelectedView] = useState<
    CalendarSavedView | "everything" | null
  >(null);
  const [title, setTitle] = useState("");
  const [saveVisibility, setSaveVisibility] = useState<ViewVisibility | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const editingEverything = selectedView === "everything";
  const selectedSavedView = editingEverything ? null : selectedView;
  const titleLength = title.trim().length;
  const validTitle =
    titleLength >= (editingEverything ? 1 : 2) && titleLength <= 60;

  const saveNew = async () => {
    if (!saveVisibility) return;
    if (!validTitle || saving) return;
    setSaving(true);
    const saved = await saveCalendarView(title, false, saveVisibility);
    setSaving(false);
    if (!saved) return;
    toast.success("Calendar view saved");
    toggle();
  };

  const saveCurrent = async () => {
    if (saving) return;
    setSaving(true);
    const saved = await saveCalendarView(
      appliedView?.title ?? everythingTitle,
      true,
      appliedView?.visibility ?? "Private",
    );
    setSaving(false);
    if (!saved) return;
    toast.success(appliedView ? "Calendar view updated" : "Everything updated");
    toggle();
  };

  const saveEverything = async (close = true) => {
    if (saving) return;
    setSaving(true);
    const saved = await saveCalendarView(title, true, "Private");
    setSaving(false);
    if (!saved) return;
    toast.success("Everything updated");
    if (close) toggle();
  };

  const rename = async () => {
    if (!selectedView || !validTitle || saving) return;
    setSaving(true);
    const renamed =
      selectedView === "everything"
        ? await renameEverything(title)
        : await renameCalendarView(selectedView.id, title);
    setSaving(false);
    if (!renamed) return;
    toast.success("Calendar view renamed");
    setSelectedView(null);
    setTitle("");
  };

  const remove = async () => {
    if (!selectedSavedView || saving) return;
    setSaving(true);
    const deleted = await deleteCalendarView(selectedSavedView.id);
    setSaving(false);
    setConfirmDelete(false);
    if (!deleted) return;
    toast.success("Calendar view deleted");
    setSelectedView(null);
    setTitle("");
  };

  const reset = async () => {
    if (saving) return;
    setSaving(true);
    const didReset = await resetEverything();
    setSaving(false);
    setConfirmReset(false);
    if (!didReset) return;
    toast.success("Everything reset to default");
    setSelectedView(null);
    setTitle("");
  };

  if (confirmReset) {
    return (
      <ConfirmDialog
        id="confirm-reset-calendar-everything"
        message={
          <>
            Reset the calendar view{" "}
            <span className="font-medium">&quot;{everythingTitle}&quot;</span>{" "}
            to default?
          </>
        }
        confirmLabel="Reset to default"
        loadingLabel="Resetting…"
        loading={saving}
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
        footerVerb="reset"
      />
    );
  }

  if (confirmDelete && selectedSavedView) {
    return (
      <ConfirmDialog
        id="confirm-delete-calendar-view"
        icon={Trash2}
        message={
          <>
            Delete the calendar view{" "}
            <span className="font-medium">
              &quot;{selectedSavedView.title}&quot;
            </span>
            ?
          </>
        }
        confirmLabel="Delete view"
        loadingLabel="Deleting…"
        loading={saving}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
        footerVerb="delete"
      />
    );
  }

  const editing = mode === "manage" && selectedView !== null;
  const namingNewView = mode === "save" && saveVisibility !== null;

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      shouldCloseOnClickOutside
      id="calendar-views-modal"
      toggle={toggle}
      className="paletteModalSizing sm:min-w-[560px] sm:top-[24%] sm:max-h-[450px]"
    >
      <ModalHeaderComp
        header={
          mode === "save"
            ? namingNewView
              ? saveVisibility === "Public"
                ? "Save as new view for team"
                : "Save as view for me only"
              : "Save this view"
            : editing
              ? "Edit calendar view"
              : "Manage calendar views"
        }
      >
        {(editing || namingNewView) && (
          <button
            type="button"
            aria-label="Back to calendar views"
            className="cursor-pointer border-0 bg-transparent p-0 text-text-light-gray hover:text-white-black focus:outline-none focus-visible:text-white-black"
            onClick={() => {
              if (namingNewView) {
                setSaveVisibility(null);
                setTitle("");
                return;
              }
              setSelectedView(null);
              setTitle("");
            }}
          >
            <ArrowLeft size={18} strokeWidth={1.75} />
          </button>
        )}
        {!editing && !namingNewView && (
          <button
            type="button"
            aria-label="Close calendar views"
            className="cursor-pointer rounded-sm border-0 bg-transparent p-1 text-text-light-gray transition hover:text-white-black focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white-black"
            onClick={toggle}
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </ModalHeaderComp>
      <ModalBody className="p-0">
        {(namingNewView || editing) && (
          <div className="border-b border-light-black-border-1">
            <ModalInput
              value={title}
              maxLength={60}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (mode === "save") void saveNew();
                else void rename();
              }}
              placeholder="Name your view"
            />
          </div>
        )}
        <ModalListContainer id="calendar-views-modal-list">
          {mode === "save" ? (
            namingNewView ? (
              <CalendarViewRow
                onClick={() => void saveNew()}
                isSelected
                className={
                  !validTitle || saving ? "pointer-events-none opacity-40" : ""
                }
              >
                <span>{saving ? "Saving…" : "Save view"}</span>
              </CalendarViewRow>
            ) : (
              <>
                <CalendarViewRow
                  onClick={() => void saveCurrent()}
                  isSelected
                  className={saving ? "pointer-events-none opacity-40" : ""}
                >
                  <span>{saving ? "Saving…" : "Save as current view"}</span>
                </CalendarViewRow>
                <CalendarViewRow
                  onClick={() => setSaveVisibility("Public")}
                  isSelected={false}
                >
                  <span>Save as additional view for team</span>
                </CalendarViewRow>
                <CalendarViewRow
                  onClick={() => setSaveVisibility("Private")}
                  isSelected={false}
                >
                  <span>Save as view for me only</span>
                </CalendarViewRow>
                <CalendarViewRow
                  onClick={() => {
                    resetCalendarView();
                    toggle();
                  }}
                  isSelected={false}
                >
                  <span>Reset View</span>
                </CalendarViewRow>
              </>
            )
          ) : editing ? (
            <>
              {editingEverything && appliedCalendarViewId === null && (
                <CalendarViewRow
                  onClick={() => void saveEverything(false)}
                  isSelected={false}
                  className={saving ? "pointer-events-none opacity-40" : ""}
                >
                  <span>
                    {saving
                      ? "Saving…"
                      : "Update Everything (current state becomes the default)"}
                  </span>
                </CalendarViewRow>
              )}
              <CalendarViewRow
                onClick={() => void rename()}
                isSelected
                className={
                  !validTitle || saving ? "pointer-events-none opacity-40" : ""
                }
              >
                <span>{saving ? "Saving…" : "Rename view"}</span>
              </CalendarViewRow>
              {editingEverything ? (
                <CalendarViewRow
                  onClick={() => setConfirmReset(true)}
                  isSelected={false}
                >
                  <span>Reset to default</span>
                </CalendarViewRow>
              ) : (
                <CalendarViewRow
                  onClick={() => setConfirmDelete(true)}
                  isSelected={false}
                >
                  <span>Delete view</span>
                  <Trash2 size={14} strokeWidth={1.75} />
                </CalendarViewRow>
              )}
            </>
          ) : (
            <>
              <CalendarViewRow
                onClick={() => {
                  setSelectedView("everything");
                  setTitle(everythingTitle);
                }}
                aria-label={`Edit ${everythingTitle}`}
                isSelected={appliedCalendarViewId === null}
              >
                <span>{everythingTitle}</span>
                <Settings
                  size={16}
                  strokeWidth={1.75}
                  className="shrink-0 text-text-light-gray"
                  aria-hidden
                />
              </CalendarViewRow>
              {calendarViews.map((view) => (
                <CalendarViewRow
                  key={view.id}
                  onClick={() => {
                    if (view.userId !== currentUser?.id) {
                      toast.error(
                        "Only the owner can rename or delete this view",
                      );
                      return;
                    }
                    setSelectedView(view);
                    setTitle(view.title);
                  }}
                  aria-label={
                    view.userId === currentUser?.id
                      ? `Edit ${view.title}`
                      : `${view.title}, only its owner can edit it`
                  }
                  aria-disabled={view.userId !== currentUser?.id}
                  title={
                    view.userId === currentUser?.id
                      ? "Edit calendar view"
                      : "Only the owner can edit this view"
                  }
                  className={
                    view.userId === currentUser?.id ? "" : "cursor-not-allowed"
                  }
                  isSelected={view.id === appliedCalendarViewId}
                >
                  <span>
                    {view.title}
                    {view.visibility === "Public" ? " · team" : ""}
                  </span>
                  {view.userId === currentUser?.id ? (
                    <Settings
                      size={16}
                      strokeWidth={1.75}
                      className="shrink-0 text-text-light-gray"
                      aria-hidden
                    />
                  ) : (
                    <Lock
                      size={14}
                      strokeWidth={1.75}
                      className="shrink-0 text-text-light-gray"
                      aria-hidden
                    />
                  )}
                </CalendarViewRow>
              ))}
            </>
          )}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default CalendarViewsModal;
