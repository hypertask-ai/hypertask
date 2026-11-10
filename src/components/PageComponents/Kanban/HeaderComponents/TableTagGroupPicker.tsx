"use client";
import { ModalBody } from "reactstrap";
import { useMemo, useState } from "react";
import { GripVertical } from "lucide-react";
import SelectionCheckbox from "@/components/Common/selection-checkbox";
import { ModalContainerCustom, ModalFooterComp, ModalHeaderComp, ModalInput, ModalListContainer } from "@/components/Common/CommonModalComponents";
import { countTableTags, getActiveTableGroupingFromProject } from "@/lib/table-view/tableGroupByTag";
import type { IProject } from "@/models/model";
import { useFlag } from "@/hooks/useFlag";
const ACTION = "inline-flex min-h-7 items-center rounded-[4px] border-0 px-2 py-1 text-meta font-medium text-white-black hover:bg-hover-active";
const TableTagGroupPicker = ({ project, onClose, onApply }: { project: IProject; onClose: () => void; onApply: (tagIds: string[]) => void }) => {
  const enabled = useFlag("htpr-8974-table-group-modes");
  const counts = useMemo(
    () => countTableTags(project.filteredSections?.length ? project.filteredSections : project.sections ?? []),
    [project.filteredSections, project.sections],
  );
  const [selected, setSelected] = useState<string[]>(() => {
    const grouping = getActiveTableGroupingFromProject(project);
    const available = new Set(counts.map((tag) => tag.id));
    return grouping.allTags ? [...available] : grouping.tagIds.filter((id) => available.has(id));
  });
  const [keyword, setKeyword] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(counts.map((tag) => [tag.id, tag])), [counts]);
  const rows = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const selectedRows = selected.map((id) => ({ id, title: byId.get(id)?.title ?? id, count: byId.get(id)?.count ?? 0, selected: true }));
    const rest = counts.filter((tag) => !selected.includes(tag.id)).map((tag) => ({ ...tag, selected: false }));
    return [...selectedRows, ...rest].filter((row) => !query || row.title.toLowerCase().includes(query));
  }, [byId, counts, selected, keyword]);
  const toggle = (id: string) =>
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId || !selected.includes(targetId)) return;
    setSelected((current) => {
      const next = current.filter((id) => id !== dragId);
      next.splice(next.indexOf(targetId), 0, dragId);
      return next;
    });
  };
  return enabled ? <ModalContainerCustom id="table-tag-group-picker" isOpen toggle={onClose} shouldCloseOnClickOutside className="xs:max-h-full sm:min-w-[480px] sm:top-[24%] sm:max-h-[520px]">
      <ModalHeaderComp header="Group by tags" />
      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput id="table-tag-group-search" value={keyword} placeholder="Search tags…" onChange={(event) => setKeyword(event.target.value)} />
        <ModalListContainer id="table-tag-group-list" className="max-h-[364px]">
          {rows.map((row) => (
            <li key={row.id} draggable={row.selected} onDragStart={() => setDragId(row.id)} onDragEnd={() => setDragId(null)} onDragOver={(event) => row.selected && event.preventDefault()} onDrop={() => dropOn(row.id)} className="mx-1.5 flex h-[36px] items-center gap-3 rounded-[4px] px-3 text-dense hover:bg-hover-active">
              <button type="button" aria-pressed={row.selected} onClick={() => toggle(row.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <SelectionCheckbox isChecked={row.selected} onClick={() => toggle(row.id)} />
                <span className="truncate">{row.title}</span>
              </button>
              <span className="text-micro text-text-light-gray">{row.count}</span>
              {row.selected && <GripVertical size={14} strokeWidth={1.75} className="cursor-grab text-text-light-gray" aria-hidden />}
            </li>
          ))}
          {rows.length === 0 && <li className="px-6 py-3 text-content text-text-light-gray">No tags with tickets in this view</li>}
        </ModalListContainer>
      </ModalBody>
      <ModalFooterComp className="m-0 justify-end px-5 pb-4 pt-0">
        <button type="button" className={ACTION} onClick={onClose}>Cancel</button>
        <button type="button" className={ACTION} onClick={() => onApply(selected)}>Apply</button>
      </ModalFooterComp>
    </ModalContainerCustom> : null;
};

export default TableTagGroupPicker;
