import {
  ModalContainerCustom,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  DEFAULT_TABLE_COLUMNS,
  normalizeTableVisibleColumns,
  seedMissingCustomFieldColumns,
  TABLE_COLUMN_KEYS,
  tableVisibleColumnsAtom,
  tableColumnWidthsAtom,
  TableColumnKey,
  customFieldColumnKey,
  isCustomFieldColumnKey,
  LOCKED_TABLE_COLUMNS,
  currentProjectAtom,
} from "@/store";
import { Check, Menu } from "lucide-react";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ModalBody } from "reactstrap";
import { DragDropContext, Draggable, Droppable, DropResult } from "@hello-pangea/dnd";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

type TableColumnsPickerProps = {
  closeHandler: () => void;
  projectId?: number;
};

type CustomField = { id: string; name: string; showInTable?: boolean | null };

const columnLabels: Record<TableColumnKey, string> = {
  ticket: "Ticket",
  title: "Title",
  status: "Status",
  priority: "Priority",
  size: "Size",
  due: "Due",
  inColumn: "In column",
  noComment: "No comment",
  onBoard: "On board",
  time: "Time",
  created: "Created",
  updated: "Updated",
  assignee: "Assignee",
};

const lockedColumns = LOCKED_TABLE_COLUMNS;

const TableColumnsPicker = ({ closeHandler, projectId }: TableColumnsPickerProps) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const showTimeTotals = Boolean(
    currentProject?.id === projectId && currentProject?.showTimeTotals,
  );
  const [storedColumns, setStoredColumns] = useRecoilState(tableVisibleColumnsAtom);
  const [columnWidths, setColumnWidths] = useRecoilState(tableColumnWidthsAtom);
  const { data: customFields = [] } = useQuery<CustomField[]>({
    queryKey: ["customFields", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => (await axios.get(`/api/customFields?projectId=${projectId}`)).data,
  });
  // A field with showInTable=false (set in the manage-custom-fields modal) is
  // removed from the table everywhere, including here — it must not be an
  // option a user can re-toggle on per-view.
  const tableEligibleFields = useMemo(
    () => customFields.filter((field) => field.showInTable !== false),
    [customFields]
  );
  const customFieldKeys = useMemo(
    () => tableEligibleFields.map((field) => customFieldColumnKey(field.id)),
    [tableEligibleFields]
  );
  const labelFor = (column: string) =>
    isCustomFieldColumnKey(column)
      ? customFields.find((field) => customFieldColumnKey(field.id) === column)?.name ?? "Custom field"
      : columnLabels[column as TableColumnKey];
  const eligibleKeySet = useMemo(() => new Set(customFieldKeys), [customFieldKeys]);
  const visibleColumns = normalizeTableVisibleColumns(storedColumns).filter(
    (key) =>
      (key !== "time" || showTimeTotals) &&
      (!isCustomFieldColumnKey(key) || eligibleKeySet.has(key))
  );
  // Visible columns first (stored/dragged order), then the rest in canonical order.
  const displayOrder = useMemo(() => {
    const visibleSet = new Set(visibleColumns);
    const eligibleBuiltIns = TABLE_COLUMN_KEYS.filter(
      (key) => key !== "time" || showTimeTotals,
    );
    return [...visibleColumns, ...[...eligibleBuiltIns, ...customFieldKeys].filter((key) => !visibleSet.has(key))];
  }, [visibleColumns, customFieldKeys, showTimeTotals]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pickerRef.current?.focus();
  }, []);

  const toggleColumn = (column: string) => {
    if (lockedColumns.has(column)) return;

    setStoredColumns((current) => {
      const normalized = normalizeTableVisibleColumns(current);
      if (normalized.includes(column)) return normalized.filter((key) => key !== column);
      return [...normalized, column];
    });
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;

    const reordered = [...displayOrder];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const visibleSet = new Set(visibleColumns);
    setStoredColumns(normalizeTableVisibleColumns(reordered.filter((key) => visibleSet.has(key))));
  };

  // Custom fields reset to visible too, appended after the built-ins.
  const resetToDefault = () =>
    setStoredColumns(
      seedMissingCustomFieldColumns(
        showTimeTotals
          ? [...DEFAULT_TABLE_COLUMNS, "time"]
          : DEFAULT_TABLE_COLUMNS,
        customFieldKeys,
      ),
    );
  // Drops every drag-resize override (HTPR-4993): title goes back to auto-flex,
  // every other column back to its default width.
  const resetWidths = () => setColumnWidths({});

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      closeHandler();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      setSelectedIndex((current) => (current + 1) % displayOrder.length);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      setSelectedIndex((current) => (current - 1 + displayOrder.length) % displayOrder.length);
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggleColumn(displayOrder[selectedIndex]);
    }
  };

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="tableColumnsPicker"
      toggle={closeHandler}
      shouldCloseOnClickOutside={true}
      keyboard={false}
      autoFocus={false}
      className="paletteModalSizing font-medium sm:min-w-[420px] sm:top-[24%]"
      contentClassName="border-0 rounded-[5px] overflow-hidden bg-modalBackground"
    >
      <ModalHeaderComp header="Configure table columns" className="px-5" />
      <ModalBody className="p-0">
        <div
          ref={pickerRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="outline-none"
        >
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="tableColumns">
              {(provided) => (
                <ul
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="max-h-default-modal overflow-y-auto rounded-b-[4px] pb-1.5 text-dense text-white-black no-scrollbar"
                >
                  {displayOrder.map((column, index) => {
                    const isLocked = lockedColumns.has(column);
                    const isChecked = visibleColumns.includes(column);
                    const isSelected = selectedIndex === index;

                    return (
                      <Draggable key={column} draggableId={column} index={index} isDragDisabled={isLocked}>
                        {(dragProvided) => (
                          <li
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            role="checkbox"
                            aria-checked={isChecked}
                            aria-disabled={isLocked}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onClick={() => toggleColumn(column)}
                            className={`mx-1.5 flex h-9 cursor-pointer items-center justify-between rounded-sm px-3 transition-colors ${
                              isSelected ? "bg-active-modal-element" : ""
                            } ${isLocked ? "cursor-default opacity-50" : ""}`}
                          >
                            <span className="flex items-center gap-2">
                              {!isLocked && (
                                <span
                                  {...dragProvided.dragHandleProps}
                                  className="cursor-move text-text-light-gray no-drag-style"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Menu size={13} strokeWidth={1.75} />
                                </span>
                              )}
                              <span>{labelFor(column)}</span>
                            </span>
                            <span
                              aria-hidden="true"
                              className={`flex h-4 w-4 items-center justify-center rounded-sm ${
                                isChecked ? "bg-hypertasks-purple text-white" : "bg-containerBackground"
                              }`}
                            >
                              {isChecked && <Check size={12} strokeWidth={2} className="keep-stroke" />}
                            </span>
                          </li>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </ul>
              )}
            </Droppable>
          </DragDropContext>
          <div className="mx-1.5 flex h-9 items-center gap-4 border-t border-light-black-border-1 px-3">
            <button
              type="button"
              onClick={resetToDefault}
              className="text-dense text-text-light-gray hover:text-white-black transition-colors"
            >
              Reset to default
            </button>
            <button
              type="button"
              onClick={resetWidths}
              className="text-dense text-text-light-gray hover:text-white-black transition-colors"
            >
              Reset column widths
            </button>
          </div>
        </div>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default TableColumnsPicker;
