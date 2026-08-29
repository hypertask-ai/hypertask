/**
 * @fileoverview
 * Task Detail Constants
 * Re-exports from taskDetail.config.ts for backward compatibility
 * @deprecated Use taskDetailConfig from @/lib/configs/taskDetail.config directly
 */

import taskDetailConfig from "@/lib/configs/taskDetail.config";

// Re-export for backward compatibility
export const descriptionContainerId = taskDetailConfig.elementIds.descriptionContainer;

/**
 * How close two presses must be for us to treat them as a deliberate
 * double-click that opens an editor (comments and the description alike).
 *
 * We cannot trust the browser's own `dblclick`: the OS double-click speed is
 * user-configurable (Windows goes up to ~900ms), so two clicks the user means
 * as separate still arrive as one `dblclick` and the editor pops open on what
 * felt like a single click (HTPR-4659).
 */
export const DELIBERATE_DOUBLE_CLICK_MS = 500;

// Export the config object for new usage
export { taskDetailConfig };
export default taskDetailConfig;
