/**
 * @fileoverview
 * Task Detail Constants
 * Re-exports from taskDetail.config.ts for backward compatibility
 * @deprecated Use taskDetailConfig from @/lib/configs/taskDetail.config directly
 */

import taskDetailConfig from "@/lib/configs/taskDetail.config";

export const descriptionContainerId = taskDetailConfig.elementIds.descriptionContainer;

export const DELIBERATE_DOUBLE_CLICK_MS = 500;

export { taskDetailConfig };
export default taskDetailConfig;
