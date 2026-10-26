export const AI_CHIP_SIGNAL = "ht:ai-chip";
export const AI_CHIP_TEXT_LIMIT = 200;
export const AI_CHIP_MAX_CHIPS = 12;

export const AI_CHIP_SURFACES = ["welcome-board", "welcome-ticket", "welcome-edit", "welcome-demo", "welcome-board-build", "new-ticket-questions"] as const;
export const AI_CHIP_TYPES = ["suggested", "ticket-prompt", "generated-question", "edit-prompt", "board-example", "demo-prompt", "ask-all", "summary-action"] as const;
export const AI_CHIP_EVENTS = ["shown", "clicked", "ignored", "next_typed"] as const;

export type AiChipSurface = (typeof AI_CHIP_SURFACES)[number];
export type AiChipType = (typeof AI_CHIP_TYPES)[number];
export type AiChipEventName = (typeof AI_CHIP_EVENTS)[number];

export type AiChipSignal =
  | { kind: "shown"; surface: AiChipSurface; chipType: AiChipType; chips: string[]; projectId?: number | null; taskId?: number | null; controls?: { chipType: AiChipType; label: string }[] }
  | { kind: "dismiss"; surface: AiChipSurface }
  | { kind: "clicked"; text: string; index: number; label?: string; chipType?: AiChipType }
  | { kind: "send"; text: string };

export type AiChipEventPayload = {
  event: AiChipEventName;
  surface: AiChipSurface;
  chipType: AiChipType;
  chips: string[];
  chipIndex?: number;
  chipText?: string;
  typedText?: string;
  typedLength?: number;
  projectId?: number | null;
  taskId?: number | null;
};

type ActiveChips = {
  surface: AiChipSurface;
  chipType: AiChipType;
  chips: string[];
  projectId: number | null;
  taskId: number | null;
  resolved: boolean;
};

const clip = (text: string) => text.slice(0, AI_CHIP_TEXT_LIMIT);
const sameChips = (left: string[], right: string[]) => left.length === right.length && left.every((chip, index) => chip === right[index]);

export function createAiChipRecorder(emit: (payload: AiChipEventPayload) => void) {
  let active: ActiveChips | null = null;
  let lastClickedText: string | null = null;

  const base = (chips: ActiveChips) => ({
    surface: chips.surface,
    chipType: chips.chipType,
    chips: chips.chips,
    projectId: chips.projectId,
    taskId: chips.taskId,
  });

  const ignore = (typed?: string) => {
    if (!active || active.resolved) return;
    active.resolved = true;
    emit({ event: "ignored", ...base(active) });
    if (typed !== undefined) emit({ event: "next_typed", ...base(active), typedText: clip(typed), typedLength: typed.length });
  };

  return {
    handle(signal: AiChipSignal) {
      if (signal.kind === "shown") {
        const chips = signal.chips.slice(0, AI_CHIP_MAX_CHIPS).map(clip);
        if (!chips.length) return;
        const projectId = signal.projectId ?? null;
        const taskId = signal.taskId ?? null;
        if (active && active.surface === signal.surface && active.chipType === signal.chipType && active.projectId === projectId && active.taskId === taskId && sameChips(active.chips, chips)) return;
        ignore();
        active = { surface: signal.surface, chipType: signal.chipType, chips, projectId, taskId, resolved: false };
        emit({ event: "shown", ...base(active) });
        for (const control of signal.controls ?? []) {
          emit({ event: "shown", ...base(active), chipType: control.chipType, chips: [clip(control.label)] });
        }
        return;
      }
      if (signal.kind === "dismiss") {
        if (!active || active.surface !== signal.surface) return;
        ignore();
        active = null;
        lastClickedText = null;
        return;
      }
      if (signal.kind === "dismiss") return typeof signal.surface === "string";
  if (signal.kind === "clicked") {
        if (!active || active.resolved) return;
        active.resolved = true;
        lastClickedText = signal.text;
        emit({
          event: "clicked",
          ...base(active),
          chipType: signal.chipType ?? active.chipType,
          chipIndex: signal.index,
          chipText: clip(signal.label ?? signal.text),
        });
        return;
      }
      if (lastClickedText !== null && signal.text === lastClickedText) {
        lastClickedText = null;
        return;
      }
      lastClickedText = null;
      ignore(signal.text);
    },
    leave() {
      ignore();
    },
  };
}

export function isAiChipSignal(value: unknown): value is AiChipSignal {
  if (!value || typeof value !== "object") return false;
  const signal = value as Record<string, unknown>;
  if (signal.kind === "send") return typeof signal.text === "string";
  if (signal.kind === "dismiss") return typeof signal.surface === "string";
  if (signal.kind === "clicked") return typeof signal.text === "string" && typeof signal.index === "number";
  if (signal.kind === "shown") return Array.isArray(signal.chips) && typeof signal.surface === "string" && typeof signal.chipType === "string";
  return false;
}
