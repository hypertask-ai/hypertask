import { createContext } from "react";

export const FeatureFlagsContext = createContext<{ values: Record<string, boolean>; seeded: boolean; fallback: boolean }>({ values: {}, seeded: false, fallback: true });
