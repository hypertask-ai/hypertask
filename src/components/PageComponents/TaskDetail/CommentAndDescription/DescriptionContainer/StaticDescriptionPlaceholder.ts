import { createContext, type ReactNode } from "react";

// HTPR-7091: while the lazily loaded editor is still starting up, its panels
// show this node (the static description) instead of the other static layout.
export const StaticDescriptionPlaceholderContext = createContext<ReactNode>(null);
