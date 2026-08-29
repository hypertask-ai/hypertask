/**
 * Bare key that collapses / expands the app-shell rail. Cleared by Valentin
 * 2026-08-02 (HTPR-4890); its former redundant focus-left duty was removed in
 * `useHandleKeyDownOperations.ts` (ArrowLeft/H still cover that).
 *
 * Lives in a leaf module on purpose: AllCommands.ts and shortcuts.ts are loaded
 * by the jiti-based tests, which cannot parse the React graph a hook import
 * drags in (state.tsx broke 7 test files when this constant lived in
 * useAppShellSurfaceShortcuts.ts).
 */
export const RAIL_TOGGLE_KEY = "[";
