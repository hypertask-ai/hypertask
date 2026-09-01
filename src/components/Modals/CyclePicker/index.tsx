"use client";

import { useEffect, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { Check } from "lucide-react";
import { ModalBody } from "reactstrap";
import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import type { ICycle } from "@/models/model";
import { cycleDateRange } from "@/lib/cycles";

const CYCLE_API_PATH = "/api/tasks/cycle";

interface CycleListResponse {
  assignedCycle: ICycle | null;
  cycles: ICycle[];
  enabled: boolean;
}

interface CycleMutationResponse {
  cycle?: ICycle | null;
  error?: string;
}

export default function CyclePicker({
  assignedCycle,
  closeHandler,
  onChange,
  taskId,
}: {
  assignedCycle: ICycle | null;
  closeHandler: () => void;
  onChange: (cycle: ICycle | null) => void;
  taskId: number;
}) {
  const [cycles, setCycles] = useState<ICycle[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ taskId: String(taskId) });
        if (keyword.trim()) params.set("query", keyword.trim());
        const response = await fetch(`${CYCLE_API_PATH}?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Unable to load cycles");
        const body = (await response.json()) as CycleListResponse;
        setCycles(body.cycles);
        setEnabled(body.enabled);
      } catch (error) {
        if ((error as Error).name !== "AbortError") toast.error("Unable to load cycles");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, keyword ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, taskId]);

  const assign = async (cycle: ICycle | null) => {
    if (saving || (cycle && !cycle.assignable)) return;
    setSaving(true);
    try {
      const response = await fetch(CYCLE_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, cycleId: cycle?.id ?? null }),
      });
      const body = (await response.json().catch(() => null)) as CycleMutationResponse | null;
      if (!response.ok) throw new Error(body?.error ?? "Unable to update cycle");
      onChange(body?.cycle ?? null);
      closeHandler();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update cycle");
    } finally {
      setSaving(false);
    }
  };

  let cycleList: ReactNode;
  if (loading) {
    cycleList = <p className="px-3 py-2 text-dense text-text-light-gray">Loading cycles…</p>;
  } else if (cycles.length === 0) {
    cycleList = <p className="px-3 py-2 text-dense text-text-light-gray">No cycles found.</p>;
  } else {
    cycleList = cycles.map((cycle, index) => (
      <ModalRowElementContainer
        id={`cycle-${cycle.id}`}
        index={index + 1}
        isSelected={assignedCycle?.id === cycle.id}
        key={cycle.id}
        onClick={() => assign(cycle)}
        className={cycle.assignable ? "" : "cursor-default opacity-60"}
      >
        <span className="min-w-0 flex-1">
          <strong className="block truncate font-medium">Cycle {cycle.number}</strong>
          <small className="text-meta text-text-light-gray">
            {cycleDateRange(cycle)}{cycle.assignable ? "" : " · history"}
          </small>
        </span>
        {assignedCycle?.id === cycle.id && <Check size={16} strokeWidth={1.75} />}
      </ModalRowElementContainer>
    ));
  }

  return (
    <ModalContainerCustom
      id="cycle-picker"
      isOpen
      autoFocus={false}
      shouldCloseOnClickOutside
      toggle={closeHandler}
      className="paletteModalSizing sm:min-w-[480px] sm:top-[24%] sm:max-h-fit shadow-xl"
    >
      <ModalHeaderComp header="Set cycle" />
      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput
          autofocus
          onChange={(event) => {
            setLoading(true);
            setKeyword(event.target.value);
          }}
          placeholder="Search cycles"
          value={keyword}
        />
        <ModalListContainer id="cycle-list" className="max-h-[364px]">
          <ModalRowElementContainer
            id="cycle-none"
            index={0}
            isSelected={assignedCycle === null}
            onClick={() => assign(null)}
          >
            <span className="flex-1">No cycle</span>
            {assignedCycle === null && <Check size={16} strokeWidth={1.75} />}
          </ModalRowElementContainer>
          {!enabled && (
            <p className="px-3 py-2 text-dense text-text-light-gray">
              Cycles are disabled. You can clear this task’s existing cycle.
            </p>
          )}
          {cycleList}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
}
