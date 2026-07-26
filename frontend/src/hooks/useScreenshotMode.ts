import { useEffect, useState } from "react";

const isEnabled = (): boolean =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");

export const anonymize = (real: string, prefix: string): string => {
  let h = 0;
  for (let i = 0; i < real.length; i++) h = (h * 31 + real.charCodeAt(i)) | 0;
  return `${prefix} ${(Math.abs(h) % 1000).toString().padStart(3, "0")}`;
};

const useScreenshotMode = () => {
  const [enabled, setEnabled] = useState(isEnabled);

  useEffect(() => {
    const onChange = () => setEnabled(isEnabled());
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);

  return enabled;
};

export default useScreenshotMode;
