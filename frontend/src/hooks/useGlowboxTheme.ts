import { useTheme } from "@emotion/react";

// Every glowbox core takes its own colour bundle, 'dark' | 'light' | 'auto'. 'auto'
// would follow prefers-color-scheme on its own, but so does our theme (Root.tsx), so
// pass ours: one source of truth, and it still works if a manual toggle lands later.
const useGlowboxTheme = (): "dark" | "light" => (useTheme().mode === "light" ? "light" : "dark");

export default useGlowboxTheme;
