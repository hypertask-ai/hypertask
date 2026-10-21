import {
  parseMyTasksViewConfig,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";

export function mergeMyTasksViewConfigUpdate(args: {
  existingConfig: unknown;
  fullConfig?: unknown;
  configPatch?: { defaultBoardId?: unknown } | null;
}): MyTasksViewConfig {
  const existing = parseMyTasksViewConfig(args.existingConfig);

  if (args.configPatch && Object.prototype.hasOwnProperty.call(args.configPatch, "defaultBoardId")) {
    return parseMyTasksViewConfig({
      ...existing,
      defaultBoardId: args.configPatch.defaultBoardId,
    });
  }

  if (args.fullConfig !== undefined) {
    const incoming = parseMyTasksViewConfig(args.fullConfig);
    const merged: MyTasksViewConfig = { ...incoming };
    if (Object.prototype.hasOwnProperty.call(existing, "defaultBoardId")) {
      merged.defaultBoardId = existing.defaultBoardId;
    } else {
      delete merged.defaultBoardId;
    }
    return parseMyTasksViewConfig(merged);
  }

  return existing;
}
