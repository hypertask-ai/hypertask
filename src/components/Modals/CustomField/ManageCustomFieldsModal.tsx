"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DragDropContext,
  Draggable,
  Droppable,
  DropResult,
} from "@hello-pangea/dnd";
import { Menu, Trash2 } from "lucide-react";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import { CustomFieldType } from "@prisma/client";
import {
  ModalContainerCustom,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import { ModalBody, ModalFooter } from "reactstrap";
import ConfirmModal from "../Common Modals/ConfirmActionModal";
import { cn } from "@/utils/undoActions/helperFuncs";

// Mirrors CUSTOM_FIELDS_PER_PROJECT_MAX in src/utils/controllers/customFields
// (a server-only module — importing it here would pull prisma into the client bundle).
const CUSTOM_FIELDS_PER_PROJECT_MAX = 50;

type FieldRow = {
  id: string;
  name: string;
  type: CustomFieldType;
  showInRail: boolean | null;
  showInTable: boolean | null;
  valueCount: number;
};

type Props = {
  closeHandler: () => void;
  projectId?: number;
};

const ManageCustomFieldsModal = ({ closeHandler, projectId }: Props) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const boardName = currentProject?.title ?? currentProject?.name;
  const queryClient = useQueryClient();
  const queryKey = ["customFields", projectId];

  const { data } = useQuery<FieldRow[]>({
    queryKey,
    enabled: Boolean(projectId),
    queryFn: async () =>
      (await axios.get(`/api/customFields?projectId=${projectId}`)).data,
  });
  const fields = data ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [deletingField, setDeletingField] = useState<FieldRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const setFields = (updater: (current: FieldRow[]) => FieldRow[]) => {
    queryClient.setQueryData<FieldRow[]>(queryKey, (current) =>
      updater(current ?? [])
    );
  };

  const startRename = (field: FieldRow) => {
    setEditingId(field.id);
    setEditingValue(field.name);
  };

  const saveRename = async (field: FieldRow) => {
    const nextName = editingValue.trim();
    setEditingId(null);
    if (!nextName || nextName === field.name) return;
    setFields((current) =>
      current.map((f) => (f.id === field.id ? { ...f, name: nextName } : f))
    );
    try {
      await axios.patch("/api/customFields", { fieldId: field.id, name: nextName });
    } catch (err: any) {
      setFields((current) =>
        current.map((f) => (f.id === field.id ? { ...f, name: field.name } : f))
      );
      toast.error(err?.response?.data?.error || "Couldn't rename the field");
    }
  };

  const toggleVisibility = async (
    field: FieldRow,
    key: "showInRail" | "showInTable"
  ) => {
    const checked = field[key] !== false;
    const nextValue = !checked;
    setFields((current) =>
      current.map((f) => (f.id === field.id ? { ...f, [key]: nextValue } : f))
    );
    try {
      await axios.patch("/api/customFields", { fieldId: field.id, [key]: nextValue });
    } catch (err: any) {
      setFields((current) =>
        current.map((f) => (f.id === field.id ? { ...f, [key]: field[key] } : f))
      );
      toast.error(err?.response?.data?.error || "Couldn't update visibility");
    }
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination || !projectId) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;

    const previous = fields;
    const reordered = [...fields];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    queryClient.setQueryData(queryKey, reordered);

    try {
      const { data: updated } = await axios.post("/api/customFields/reorder", {
        projectId,
        orderedFieldIds: reordered.map((f) => f.id),
      });
      queryClient.setQueryData(queryKey, updated);
    } catch {
      queryClient.setQueryData(queryKey, previous); // rollback to pre-drag order
      toast.error("Couldn't reorder fields");
    }
  };

  const confirmDelete = async () => {
    if (!deletingField) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/customFields?fieldId=${deletingField.id}`);
      setFields((current) => current.filter((f) => f.id !== deletingField.id));
      setDeletingField(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Couldn't delete the field");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ModalContainerCustom
      isOpen
      fade={false}
      toggle={closeHandler}
      show
      autoFocus={false}
      id="manage-custom-fields"
      className="paletteModalSizing sm:min-w-[560px] sm:top-[20%] max-h-[480px]"
    >
      <ModalHeaderComp
        header={boardName ? `Custom fields · ${boardName}` : "Custom fields"}
      />
      <ModalBody className="bg-modalBackground px-0 text-dense">
        <p className="px-5 pb-2 text-micro text-text-light-gray">
          Fields agents create via API appear here automatically, visible by default.
        </p>
        {fields.length === 0 ? (
          <p className="px-5 py-4 text-dense text-text-light-gray">
            No custom fields yet — use Ctrl+K, then &quot;Create custom field&quot; to add one.
          </p>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="custom-fields-list">
              {(dropProvided) => (
                <ul
                  ref={dropProvided.innerRef}
                  {...dropProvided.droppableProps}
                  className="max-h-[340px] overflow-y-auto no-scrollbar px-0"
                >
                  {fields.map((field, index) => (
                    <Draggable key={field.id} draggableId={field.id} index={index}>
                      {(dragProvided) => (
                        <li
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className="flex h-[40px] items-center gap-3 px-5 text-dense hover:bg-hover-active"
                        >
                          <span
                            {...dragProvided.dragHandleProps}
                            className="cursor-move text-text-light-gray no-drag-style"
                          >
                            <Menu size={13} strokeWidth={1.75} />
                          </span>

                          {editingId === field.id ? (
                            <input
                              ref={editInputRef}
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => saveRename(field)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveRename(field);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              className="min-w-0 flex-1 border-0 border-b border-light-black-border-1 bg-transparent text-white-black outline-none"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => startRename(field)}
                              className="min-w-0 flex-1 truncate text-left text-white-black hover:underline"
                            >
                              {field.name}
                            </button>
                          )}

                          <span className="shrink-0 rounded-sm bg-hover-active px-2 py-[2px] text-micro text-text-light-gray">
                            {field.type}
                          </span>

                          <InlineToggle
                            checked={field.showInRail !== false}
                            label="Rail"
                            onToggle={() => toggleVisibility(field, "showInRail")}
                          />
                          <InlineToggle
                            checked={field.showInTable !== false}
                            label="Table"
                            onToggle={() => toggleVisibility(field, "showInTable")}
                          />

                          <button
                            type="button"
                            onClick={() => setDeletingField(field)}
                            className="shrink-0 text-text-light-gray hover:text-red-400"
                            aria-label={`Delete ${field.name}`}
                          >
                            <Trash2 size={14} strokeWidth={1.75} />
                          </button>
                        </li>
                      )}
                    </Draggable>
                  ))}
                  {dropProvided.placeholder}
                </ul>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </ModalBody>
      <ModalFooter className="border-t border-border-light-gray-thin bg-modalBackground px-5 py-2 text-micro text-text-light-gray">
        {fields.length} of {CUSTOM_FIELDS_PER_PROJECT_MAX} fields
      </ModalFooter>

      {deletingField && (
        <ConfirmModal
          header={`Delete "${deletingField.name}"?`}
          content={
            deletingField.valueCount > 0
              ? `${deletingField.valueCount} ${
                  deletingField.valueCount === 1 ? "ticket carries" : "tickets carry"
                } a value for this field. Deleting it removes those values permanently.`
              : "No tickets carry a value for this field yet."
          }
          confirmButtonContent={deleting ? "Deleting…" : `Delete "${deletingField.name}"`}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeletingField(null)}
          onTaskPage
          customClassName="sm:min-w-[440px] xs:max-h-[600px] z-[90000000] relative sm:top-[10px]"
        />
      )}
    </ModalContainerCustom>
  );
};

function InlineToggle({
  checked,
  label,
  onToggle,
  disabled,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex shrink-0 items-center gap-1.5 text-micro text-text-light-gray disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cn(
          "relative h-[14px] w-[26px] shrink-0 rounded-full transition-colors",
          checked ? "bg-hypertasks-green" : "bg-hover-active"
        )}
      >
        <span
          className={cn(
            "absolute left-[2px] top-[2px] h-[10px] w-[10px] rounded-full bg-white transition-transform",
            checked && "translate-x-3"
          )}
        />
      </span>
      <span className={checked ? "text-white-black" : undefined}>{label}</span>
    </button>
  );
}

export default ManageCustomFieldsModal;
