import {
  AUTO_MODEL_OPTION_ID,
  getAiModelOptionById,
  toAutoModelOption,
  type TAiModelOption,
} from "@/lib/aiModelOptions";

export function taskWriterShowsAuto(
  storedPick: string | null | undefined,
  usesPlanDefault: boolean,
): boolean {
  if (storedPick === AUTO_MODEL_OPTION_ID) return true;
  return usesPlanDefault && !getAiModelOptionById(storedPick);
}

export function withTaskWriterAutoOption<T extends { id: string }>(
  options: readonly T[],
  base: TAiModelOption,
): T[] {
  const auto = toAutoModelOption(base);
  return [auto as T, ...options.filter((option) => option.id !== AUTO_MODEL_OPTION_ID)];
}

export function taskWriterPickerOption(
  modelOptionId: string | null | undefined,
  modelSelected: string | null | undefined,
  haiku55Enabled = false,
): TAiModelOption | "auto" | null {
  const id = modelOptionId?.trim() || modelSelected?.trim() || "";
  if (!id) return null;
  if (id === AUTO_MODEL_OPTION_ID) return "auto";
  return getAiModelOptionById(id, haiku55Enabled) ?? null;
}

export function autoModelPreferenceAllowed(
  surface: string,
  optionId: string,
  taskWriterAuto: boolean,
): boolean {
  if (optionId !== AUTO_MODEL_OPTION_ID) return false;
  if (surface === "aiChat") return true;
  return surface === "taskWriter" && taskWriterAuto;
}
