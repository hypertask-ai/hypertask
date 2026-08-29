// Left offset for anything `position: fixed` that has to sit next to the app
// shell rail. The rail's width changes when it expands (48px -> 130px), so
// hardcoding a number leaves the element buried under the expanded rail.
export const APP_SHELL_RAIL_OFFSET = "calc(var(--app-shell-rail-w, 48px) + 8px)";
