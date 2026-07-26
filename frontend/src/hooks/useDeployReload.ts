import { useEffect } from "react";

// The SPA and backend ship in one image, so a deploy replaces both. A wall panel
// left running then serves a stale bundle against a newer backend until someone
// touches it. Poll the build id emitted alongside the bundle (see the
// halo-emit-version plugin in vite.config.ts) and reload when it moves.
//
// Keyed off the image tag, not the crate semver: a plain `:main` rebuild — the
// usual deploy — never bumps a semver, so a semver poll would miss it.
const BUILD = import.meta.env.VITE_HALO_IMAGE_TAG as string | undefined;
const POLL_MS = 60_000;

const useDeployReload = () => {
  useEffect(() => {
    // Dev server and untagged local builds have nothing to compare against.
    if (!BUILD) return;

    const check = async () => {
      try {
        const res = await fetch("/version.json", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (build && build !== BUILD) location.reload();
      } catch {
        // Backend restarting or the panel is offline; retry on the next tick.
      }
    };

    const timer = setInterval(check, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
};

export default useDeployReload;
