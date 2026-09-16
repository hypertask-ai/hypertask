import {
  parseMyTasksViewConfig,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";

/**
 * Resolve the config JSON for a My Tasks view PATCH.
 * `configPatch.defaultBoardId` is the only writer of that field; full `config`
 * bodies keep the database value so a stale Save cannot wipe a newer quick-add
 * default (and the reverse cannot drop unrelated view edits mid-flight).
 */
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
